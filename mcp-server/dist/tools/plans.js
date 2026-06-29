import { mkdir, readFile, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
/**
 * Strategy plan persistence.
 *
 * The Tier-4 strategy tools (chaingpt_strategy_*) return plans as ad-hoc
 * text. For users running a strategy over hours/days/weeks (DCA across
 * months, grid that needs to be re-rebalanced), they want to save the plan
 * and reload it later without re-running the planner.
 *
 * These tools provide a thin file-backed store. Plans are saved as JSON
 * under ~/.chaingpt-mcp/plans/ (or $CHAINGPT_PLAN_DIR if set).
 *
 * No remote storage — the plan stays on the user's machine. This is
 * deliberate: plans can contain sensitive info (sizes, addresses, intent)
 * and uploading them anywhere is out of scope.
 */
const DEFAULT_DIR = join(homedir(), '.chaingpt-mcp', 'plans');
function planDir() {
    return process.env.CHAINGPT_PLAN_DIR?.trim() || DEFAULT_DIR;
}
function safeName(name) {
    // Restrict to filesystem-safe chars
    return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
}
function planPath(name) {
    return join(planDir(), safeName(name) + '.json');
}
// Per-plan in-process mutex: mark_step is a read-modify-write on the plan
// file, and MCP clients can pipeline tool calls. Without this, two
// simultaneous ticks could both pass the idempotency check and both execute
// — the exact failure the journal exists to prevent. (Cross-PROCESS races
// are out of scope: run one scheduler per plan, as the skill instructs.)
const planLocks = new Map();
async function withPlanLock(planName, fn) {
    const prev = planLocks.get(planName) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    planLocks.set(planName, next);
    try {
        await prev;
        return await fn();
    }
    finally {
        release();
        if (planLocks.get(planName) === next)
            planLocks.delete(planName);
    }
}
function planSteps(plan) {
    const p = plan.payload;
    const steps = p && Array.isArray(p.steps) ? p.steps : null;
    if (!steps)
        return null;
    const out = [];
    const seen = new Set();
    for (const s of steps) {
        const st = s;
        if (st && st.id !== undefined && Number.isFinite(Number(st.atUnix))) {
            const key = String(st.id);
            if (seen.has(key)) {
                // Duplicate ids would journal as ONE step while executing as two.
                // Fail loudly at read time instead of refusing mysteriously mid-run.
                throw new Error(`payload.steps contains duplicate id "${key}" — fix the plan before scheduling it.`);
            }
            seen.add(key);
            out.push({ ...st, id: st.id, atUnix: Number(st.atUnix) });
        }
    }
    return out;
}
export const planTools = [
    {
        name: 'chaingpt_strategy_save_plan',
        description: 'Save a strategy plan to local disk for later recall. Plans live in ~/.chaingpt-mcp/plans/ (or ' +
            '$CHAINGPT_PLAN_DIR). Use for multi-session strategies (DCA over weeks, grid rebalancing, etc.). ' +
            'No remote upload — plan stays on the user\'s machine. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Plan name (will be sanitized to filesystem-safe chars).' },
                payload: { description: 'The plan content — any JSON-serializable value.' },
                type: { type: 'string', description: 'Optional plan type (dca / grid / funding-arb / copy / other) for filtering in _list_plans.' },
                notes: { type: 'string', description: 'Optional notes — e.g. the underlying token, wallet address, intent.' },
                overwrite: { type: 'boolean', description: 'If true, overwrite an existing plan with the same name. Default false.', default: false },
            },
            required: ['name', 'payload'],
        },
    },
    {
        name: 'chaingpt_strategy_load_plan',
        description: 'Load a previously-saved strategy plan by name. Returns the full payload + metadata. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Plan name (must match exactly).' },
            },
            required: ['name'],
        },
    },
    {
        name: 'chaingpt_strategy_list_plans',
        description: 'List all saved strategy plans with metadata (name, type, created/updated dates, byte size). 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Optional filter — only return plans of this type.' },
            },
            required: [],
        },
    },
    {
        name: 'chaingpt_strategy_due_steps',
        description: 'List the steps of a saved plan that are DUE now (atUnix has passed, within the lookahead window) and ' +
            'not yet executed. The heart of scheduled execution: a cron/scheduled agent calls this each tick, ' +
            'executes what it returns, then records each with chaingpt_strategy_mark_step — so re-runs and crashes ' +
            'never double-execute. Plans need payload.steps = [{ id, atUnix, ... }] (chaingpt_strategy_dca_plan ' +
            'emits this shape). Read-only. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Saved plan name.' },
                lookaheadMinutes: {
                    type: 'number',
                    description: 'Also include steps due within the next N minutes (handles scheduler jitter). Default 10.',
                    default: 10,
                },
                limit: { type: 'number', description: 'Max due steps to return. Default 20.', default: 20 },
            },
            required: ['name'],
        },
    },
    {
        name: 'chaingpt_strategy_mark_step',
        description: 'Record that a plan step was executed (or deliberately skipped) in the plan\'s execution journal. ' +
            'Call IMMEDIATELY after the action lands, with the tx hash. Idempotent: a step already marked is ' +
            'refused unless overwrite: true. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Saved plan name.' },
                stepId: { description: 'The step id from payload.steps / chaingpt_strategy_due_steps.' },
                status: { type: 'string', enum: ['done', 'skipped'], description: 'Default done.', default: 'done' },
                txHash: { type: 'string', description: 'Transaction hash / order id that executed this step.' },
                note: { type: 'string', description: 'Optional note (e.g. fill price, why skipped).' },
                overwrite: { type: 'boolean', description: 'Replace an existing journal entry. Default false.', default: false },
            },
            required: ['name', 'stepId'],
        },
    },
    {
        name: 'chaingpt_strategy_delete_plan',
        description: 'Delete a saved strategy plan by name. Requires `confirm: true` since this is irreversible. ' +
            '0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                confirm: { type: 'boolean', description: 'Must be true. Safety gate against accidental deletion.' },
            },
            required: ['name'],
        },
    },
];
export async function handlePlanTool(name, args) {
    if (!args)
        return { content: [{ type: 'text', text: 'No arguments provided.' }] };
    try {
        const dir = planDir();
        await mkdir(dir, { recursive: true });
        if (name === 'chaingpt_strategy_save_plan') {
            const planName = String(args.name);
            const payload = args.payload;
            const type = args.type ? String(args.type) : undefined;
            const notes = args.notes ? String(args.notes) : undefined;
            const overwrite = Boolean(args.overwrite);
            if (!planName || payload === undefined) {
                return { content: [{ type: 'text', text: 'name and payload are required.' }] };
            }
            const path = planPath(planName);
            let exists = false;
            try {
                await stat(path);
                exists = true;
            }
            catch { /* ok — doesn't exist */ }
            if (exists && !overwrite) {
                return {
                    content: [{
                            type: 'text',
                            text: `Plan "${planName}" already exists at ${path}. Pass overwrite: true to replace it.`,
                        }],
                };
            }
            const now = new Date().toISOString();
            let createdAt = now;
            if (exists) {
                try {
                    const prev = JSON.parse(await readFile(path, 'utf8'));
                    if (prev?.createdAt)
                        createdAt = prev.createdAt;
                }
                catch { /* ignore */ }
            }
            const persisted = {
                name: planName,
                createdAt,
                updatedAt: now,
                type,
                notes,
                payload,
            };
            await writeFile(path, JSON.stringify(persisted, null, 2), 'utf8');
            return {
                content: [{
                        type: 'text',
                        text: `✓ Saved plan "${planName}" to ${path}${exists ? ' (overwritten)' : ''}.\nType: ${type ?? '(none)'}\nNotes: ${notes ?? '(none)'}`,
                    }],
            };
        }
        if (name === 'chaingpt_strategy_load_plan') {
            const planName = String(args.name);
            const path = planPath(planName);
            let raw;
            try {
                raw = await readFile(path, 'utf8');
            }
            catch {
                return { content: [{ type: 'text', text: `Plan "${planName}" not found at ${path}.` }] };
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                return { content: [{ type: 'text', text: `Plan "${planName}" exists but JSON parse failed.` }] };
            }
            const lines = [
                `Plan: ${parsed.name}`,
                `Type: ${parsed.type ?? '(none)'}`,
                `Created: ${parsed.createdAt}`,
                `Updated: ${parsed.updatedAt}`,
                `Notes: ${parsed.notes ?? '(none)'}`,
                '',
                '--- Payload ---',
                JSON.stringify(parsed.payload, null, 2),
            ];
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_strategy_list_plans') {
            const filterType = args.type ? String(args.type) : null;
            let files;
            try {
                files = await readdir(dir);
            }
            catch {
                return { content: [{ type: 'text', text: `Plan dir ${dir} not accessible.` }] };
            }
            const jsons = files.filter((f) => f.endsWith('.json'));
            const records = [];
            for (const f of jsons) {
                const path = join(dir, f);
                try {
                    const raw = await readFile(path, 'utf8');
                    const parsed = JSON.parse(raw);
                    if (filterType && parsed.type !== filterType)
                        continue;
                    records.push({
                        name: parsed.name,
                        type: parsed.type,
                        createdAt: parsed.createdAt,
                        updatedAt: parsed.updatedAt,
                        bytes: Buffer.byteLength(raw),
                    });
                }
                catch {
                    // skip malformed files
                }
            }
            // Sort newest first
            records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            const lines = [];
            lines.push(`Saved strategy plans${filterType ? ` (type=${filterType})` : ''} — ${records.length} found in ${dir}`);
            lines.push('');
            if (records.length === 0)
                lines.push('(no plans saved yet — use chaingpt_strategy_save_plan to create one)');
            for (const r of records) {
                lines.push(`• ${r.name}${r.type ? ` [${r.type}]` : ''}`);
                lines.push(`    Updated: ${r.updatedAt}    Created: ${r.createdAt}    Size: ${r.bytes}B`);
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_strategy_due_steps') {
            const planName = String(args.name);
            const lookaheadMin = Math.max(0, Number(args.lookaheadMinutes ?? 10));
            const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 100));
            const path = planPath(planName);
            let plan;
            try {
                plan = JSON.parse(await readFile(path, 'utf8'));
            }
            catch {
                return { content: [{ type: 'text', text: `Plan "${planName}" not found or unreadable at ${path}.` }] };
            }
            const steps = planSteps(plan);
            if (!steps || steps.length === 0) {
                return {
                    content: [{
                            type: 'text',
                            text: `Plan "${planName}" has no schedulable steps. Scheduled execution needs ` +
                                `payload.steps = [{ id, atUnix, ... }] — chaingpt_strategy_dca_plan emits this shape ` +
                                `(see its "Scheduled execution" section).`,
                        }],
                };
            }
            const journal = plan.executions ?? {};
            const nowSec = Math.floor(Date.now() / 1000);
            const horizon = nowSec + lookaheadMin * 60;
            const executed = steps.filter((s) => journal[String(s.id)]);
            const due = steps.filter((s) => !journal[String(s.id)] && s.atUnix <= horizon);
            const upcoming = steps
                .filter((s) => !journal[String(s.id)] && s.atUnix > horizon)
                .sort((a, b) => a.atUnix - b.atUnix);
            const lines = [];
            lines.push(`Plan "${planName}" — due steps (lookahead ${lookaheadMin}m)`);
            lines.push('');
            lines.push(`Total steps: ${steps.length}   Executed: ${executed.length}   Due now: ${due.length}   Upcoming: ${upcoming.length}`);
            lines.push('');
            if (due.length === 0) {
                lines.push('Nothing due. ✓');
                if (upcoming.length > 0) {
                    lines.push(`Next step ${upcoming[0].id} at ${new Date(upcoming[0].atUnix * 1000).toISOString()} (in ${Math.round((upcoming[0].atUnix - nowSec) / 60)} min).`);
                }
                else if (executed.length === steps.length) {
                    lines.push('Plan is COMPLETE — every step has a journal entry. The schedule driving it can be removed.');
                }
            }
            else {
                for (const s of due.slice(0, limit)) {
                    const ageMin = Math.round((nowSec - s.atUnix) / 60);
                    const { id: _id, atUnix: _at, ...detail } = s;
                    const when = ageMin >= 0 ? `${ageMin} min overdue` : `due in ${Math.abs(ageMin)} min (within lookahead)`;
                    lines.push(`• Step ${s.id} — scheduled ${new Date(s.atUnix * 1000).toISOString()} (${when})`);
                    lines.push(`    ${JSON.stringify(detail)}`);
                }
                if (due.length > limit)
                    lines.push(`(+${due.length - limit} more due — raise limit)`);
                lines.push('');
                lines.push('Execute each step (pre-flight + policy gates apply as always), then IMMEDIATELY:');
                lines.push(`  chaingpt_strategy_mark_step name=${planName} stepId=<id> txHash=<hash>`);
                lines.push('Steps left unmarked will be returned again next tick (no double-execution risk if you mark; duplicate risk if you forget).');
            }
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (name === 'chaingpt_strategy_mark_step') {
            const planName = String(args.name);
            return await withPlanLock(planName, async () => {
                const stepId = String(args.stepId);
                const status = (args.status === 'skipped' ? 'skipped' : 'done');
                const txHash = args.txHash ? String(args.txHash) : undefined;
                const note = args.note ? String(args.note) : undefined;
                const overwrite = Boolean(args.overwrite);
                const path = planPath(planName);
                let plan;
                try {
                    plan = JSON.parse(await readFile(path, 'utf8'));
                }
                catch {
                    return { content: [{ type: 'text', text: `Plan "${planName}" not found or unreadable at ${path}.` }] };
                }
                const steps = planSteps(plan) ?? [];
                if (!steps.some((s) => String(s.id) === stepId)) {
                    return { content: [{ type: 'text', text: `Step "${stepId}" does not exist in plan "${planName}". Known ids: ${steps.map((s) => s.id).join(', ') || '(none)'}` }] };
                }
                plan.executions = plan.executions ?? {};
                const existing = plan.executions[stepId];
                if (existing && !overwrite) {
                    return {
                        content: [{
                                type: 'text',
                                text: `⚠ Step ${stepId} is ALREADY marked (${existing.status} at ${existing.ts}${existing.txHash ? `, tx ${existing.txHash}` : ''}). ` +
                                    `Refusing to double-record — if this step really executed twice, something upstream double-fired. ` +
                                    `Pass overwrite: true only to correct a wrong entry.`,
                            }],
                    };
                }
                plan.executions[stepId] = { ts: new Date().toISOString(), status, txHash, note };
                plan.updatedAt = new Date().toISOString();
                await writeFile(path, JSON.stringify(plan, null, 2), 'utf8');
                const remaining = steps.filter((s) => !plan.executions[String(s.id)]).length;
                return {
                    content: [{
                            type: 'text',
                            text: `✓ Step ${stepId} marked ${status}${txHash ? ` (tx ${txHash})` : ''}. ${remaining} step(s) remaining in "${planName}".${remaining === 0 ? ' Plan COMPLETE.' : ''}`,
                        }],
                };
            });
        }
        if (name === 'chaingpt_strategy_delete_plan') {
            const planName = String(args.name);
            if (!args.confirm) {
                return {
                    content: [{
                            type: 'text',
                            text: `⚠ Refused: delete is irreversible. Pass confirm: true to delete plan "${planName}".`,
                        }],
                };
            }
            const path = planPath(planName);
            try {
                await unlink(path);
                return { content: [{ type: 'text', text: `✓ Deleted plan "${planName}" from ${path}.` }] };
            }
            catch (e) {
                return { content: [{ type: 'text', text: `Failed to delete "${planName}": ${e?.message ?? e}` }] };
            }
        }
        return { content: [{ type: 'text', text: `Unknown plan tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Plan error: ${message}`);
    }
}
