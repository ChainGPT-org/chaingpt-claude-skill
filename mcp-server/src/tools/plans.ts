import { durableJson, withSigningLock, operationFingerprint } from '../lib/signing-journal.js';
import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
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

function planDir(): string {
  return process.env.CHAINGPT_PLAN_DIR?.trim() || DEFAULT_DIR;
}

function safeName(name: string): string {
  // Restrict to filesystem-safe chars
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw new Error('Plan name must be 1–100 safe characters, starting with a letter or digit.');
  return name;
}

function planPath(name: string): string {
  return join(planDir(), safeName(name) + '.json');
}

interface PersistedPlan {
  name: string;
  planId?: string;
  createdAt: string;
  updatedAt: string;
  type?: string;
  notes?: string;
  payload: unknown;
  /**
   * Execution journal for scheduled plans, keyed by step id. Lives OUTSIDE
   * payload so the original plan stays pristine. Written only by
   * chaingpt_strategy_mark_step — this is what makes scheduled runs
   * idempotent and crash-safe (a re-run sees the journal and skips).
   */
  executions?: Record<string, { ts: string; status: 'claimed' | 'done' | 'skipped'; operationId?: string; txHash?: string; note?: string }>;
}

/** A schedulable step inside payload.steps — id + atUnix are the contract. */
interface PlanStep {
  id: number | string;
  atUnix: number;
  [k: string]: unknown;
}

// Per-plan in-process mutex: mark_step is a read-modify-write on the plan
// file, and MCP clients can pipeline tool calls. Without this, two
// simultaneous ticks could both pass the idempotency check and both execute
// — the exact failure the journal exists to prevent. (Cross-PROCESS races
// are out of scope: run one scheduler per plan, as the skill instructs.)
async function withPlanLock<T>(planName: string, fn: () => Promise<T>): Promise<T> {
  safeName(planName);
  return withSigningLock(join(planDir(), 'plans.activity'), fn);
}

function planSteps(plan: PersistedPlan): PlanStep[] | null {
  const p = plan.payload as Record<string, unknown> | null;
  const steps = p && Array.isArray((p as any).steps) ? ((p as any).steps as unknown[]) : null;
  if (!steps) return null;
  const out: PlanStep[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const st = s as Record<string, unknown>;
    if (st && st.id !== undefined && Number.isFinite(Number(st.atUnix))) {
      const key = String(st.id);
      if (seen.has(key)) {
        // Duplicate ids would journal as ONE step while executing as two.
        // Fail loudly at read time instead of refusing mysteriously mid-run.
        throw new Error(`payload.steps contains duplicate id "${key}" — fix the plan before scheduling it.`);
      }
      seen.add(key);
      out.push({ ...(st as object), id: st.id as number | string, atUnix: Number(st.atUnix) });
    }
  }
  return out;
}

export const planTools: Tool[] = [
  {
    name: 'chaingpt_strategy_save_plan',
    description:
      'Save a strategy plan to local disk for later recall. Plans live in ~/.chaingpt-mcp/plans/ (or ' +
      '$CHAINGPT_PLAN_DIR). Use for multi-session strategies (DCA over weeks, grid rebalancing, etc.). ' +
      'No remote upload — plan stays on the user\'s machine. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
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
      type: 'object' as const,
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
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Optional filter — only return plans of this type.' },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_strategy_due_steps',
    description:
      'List the steps of a saved plan that are DUE now (atUnix has passed, within the lookahead window) and ' +
      'not yet executed. The heart of scheduled execution: a cron/scheduled agent calls this each tick, ' +
      'claims steps with claim=true before signing, passes the stable operationId to the signer, and records the hash. ' +
      'In-flight claims require reconciliation. Distinct IDs and external-wallet actions cannot be deduplicated automatically. ' +
      'Plans need payload.steps = [{ id, atUnix, ... }]. Read-only unless claim=true. 0 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Saved plan name.' },
        claim: { type: 'boolean', description: 'Atomically claim due steps before autonomous execution. Claimed steps carry a stable operationId and are never automatically retried as new actions.' },
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
    description:
      'Record that a plan step was executed (or deliberately skipped) in the plan\'s execution journal. ' +
      'Call IMMEDIATELY after the action lands, with the tx hash. Idempotent: a step already marked is ' +
      'refused; completed journal entries are immutable. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Saved plan name.' },
        stepId: { description: 'The step id from payload.steps / chaingpt_strategy_due_steps.' },
        status: { type: 'string', enum: ['done', 'skipped'], description: 'Default done.', default: 'done' },
        txHash: { type: 'string', description: 'Transaction hash / order id that executed this step.' },
        note: { type: 'string', description: 'Optional note (e.g. fill price, why skipped).' },
      },
      required: ['name', 'stepId'],
    },
  },
  {
    name: 'chaingpt_strategy_delete_plan',
    description:
      'Delete a saved strategy plan by name. Requires `confirm: true` since this is irreversible. ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        confirm: { type: 'boolean', description: 'Must be true. Safety gate against accidental deletion.' },
      },
      required: ['name'],
    },
  },
];

async function handlePlanToolUnlocked(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) return { content: [{ type: 'text', text: 'No arguments provided.' }] };

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
      } catch { /* ok — doesn't exist */ }

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
          const prev = JSON.parse(await readFile(path, 'utf8')) as PersistedPlan;
          if (Object.keys(prev.executions ?? {}).length) throw new Error('A journaled plan cannot be overwritten. Create a new plan name.');
          if (prev?.createdAt) createdAt = prev.createdAt;
        } catch (e: any) { throw new Error(`Cannot safely overwrite plan: ${e.message}`); }
      }

      const persisted: PersistedPlan = {
        name: planName,
        planId: randomUUID(),
        createdAt,
        updatedAt: now,
        type,
        notes,
        payload,
      };
      durableJson(path, persisted);
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
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        return { content: [{ type: 'text', text: `Plan "${planName}" not found at ${path}.` }] };
      }
      let parsed: PersistedPlan;
      try {
        parsed = JSON.parse(raw);
      } catch {
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
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        return { content: [{ type: 'text', text: `Plan dir ${dir} not accessible.` }] };
      }
      const jsons = files.filter((f) => f.endsWith('.json'));
      const records: Array<{ name: string; type?: string; createdAt: string; updatedAt: string; bytes: number }> = [];
      for (const f of jsons) {
        const path = join(dir, f);
        try {
          const raw = await readFile(path, 'utf8');
          const parsed = JSON.parse(raw) as PersistedPlan;
          if (filterType && parsed.type !== filterType) continue;
          records.push({
            name: parsed.name,
            type: parsed.type,
            createdAt: parsed.createdAt,
            updatedAt: parsed.updatedAt,
            bytes: Buffer.byteLength(raw),
          });
        } catch {
          // skip malformed files
        }
      }
      // Sort newest first
      records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const lines: string[] = [];
      lines.push(`Saved strategy plans${filterType ? ` (type=${filterType})` : ''} — ${records.length} found in ${dir}`);
      lines.push('');
      if (records.length === 0) lines.push('(no plans saved yet — use chaingpt_strategy_save_plan to create one)');
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
      let plan: PersistedPlan;
      try {
        plan = JSON.parse(await readFile(path, 'utf8')) as PersistedPlan;
      } catch {
        return { content: [{ type: 'text', text: `Plan "${planName}" not found or unreadable at ${path}.` }] };
      }
      const steps = planSteps(plan);
      if (!steps || steps.length === 0) {
        return {
          content: [{
            type: 'text',
            text:
              `Plan "${planName}" has no schedulable steps. Scheduled execution needs ` +
              `payload.steps = [{ id, atUnix, ... }] — chaingpt_strategy_dca_plan emits this shape ` +
              `(see its "Scheduled execution" section).`,
          }],
        };
      }
      const journal = plan.executions ?? {};
      const nowSec = Math.floor(Date.now() / 1000);
      const horizon = nowSec + lookaheadMin * 60;
      const claimed = steps.filter(s => journal[String(s.id)]?.status === 'claimed');
      const executed = steps.filter(s => journal[String(s.id)] && journal[String(s.id)].status !== 'claimed');
      const due = steps.filter((s) => !journal[String(s.id)] && s.atUnix <= horizon);
      const upcoming = steps
        .filter((s) => !journal[String(s.id)] && s.atUnix > horizon)
        .sort((a, b) => a.atUnix - b.atUnix);

      if (args.claim === true && due.length) {
        plan.executions = journal;
        for (const step of due.slice(0, limit)) {
          const operationId = `plan:${operationFingerprint({ id: plan.planId ?? plan.createdAt, name: plan.name, step: String(step.id) })}`;
          journal[String(step.id)] = { ts: new Date().toISOString(), status: 'claimed', operationId };
        }
        durableJson(path, plan);
      }
      const lines: string[] = [];
      for (const step of claimed) lines.push(`IN FLIGHT step ${step.id}: operationId=${journal[String(step.id)].operationId}. Reconcile; never execute with a new id.`);
      lines.push(`Plan "${planName}" — due steps (lookahead ${lookaheadMin}m)`);
      lines.push('');
      lines.push(`Total steps: ${steps.length}   Executed: ${executed.length}   Due now: ${due.length}   Upcoming: ${upcoming.length}`);
      lines.push('');
      if (due.length === 0) {
        lines.push('Nothing due. ✓');
        if (upcoming.length > 0) {
          lines.push(`Next step ${upcoming[0].id} at ${new Date(upcoming[0].atUnix * 1000).toISOString()} (in ${Math.round((upcoming[0].atUnix - nowSec) / 60)} min).`);
        } else if (executed.length === steps.length) {
          lines.push('Plan is COMPLETE — every step has a journal entry. The schedule driving it can be removed.');
        }
      } else {
        for (const s of due.slice(0, limit)) {
          const ageMin = Math.round((nowSec - s.atUnix) / 60);
          const { id: _id, atUnix: _at, ...detail } = s;
          const when = ageMin >= 0 ? `${ageMin} min overdue` : `due in ${Math.abs(ageMin)} min (within lookahead)`;
          lines.push(`• Step ${s.id} — scheduled ${new Date(s.atUnix * 1000).toISOString()} (${when})`);
          lines.push(`    ${JSON.stringify(detail)}`);
          if (args.claim === true) lines.push(`    operationId=${journal[String(s.id)].operationId} (pass unchanged to sign_and_send)`);
        }
        if (due.length > limit) lines.push(`(+${due.length - limit} more due — raise limit)`);
        lines.push('');
        lines.push('Execute each step (pre-flight + policy gates apply as always), then IMMEDIATELY:');
        lines.push(`  chaingpt_strategy_mark_step name=${planName} stepId=<id> txHash=<hash>`);
        lines.push('Steps left unmarked will be returned again next tick (no double-execution risk if you mark; duplicate risk if you forget).');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_strategy_mark_step') {
      const planName = String(args.name);
      const stepId = String(args.stepId);
      const status = (args.status === 'skipped' ? 'skipped' : 'done') as 'done' | 'skipped';
      const txHash = args.txHash ? String(args.txHash) : undefined;
      const note = args.note ? String(args.note) : undefined;
      const overwrite = Boolean(args.overwrite);
      const path = planPath(planName);
      let plan: PersistedPlan;
      try {
        plan = JSON.parse(await readFile(path, 'utf8')) as PersistedPlan;
      } catch {
        return { content: [{ type: 'text', text: `Plan "${planName}" not found or unreadable at ${path}.` }] };
      }
      const steps = planSteps(plan) ?? [];
      if (!steps.some((s) => String(s.id) === stepId)) {
        return { content: [{ type: 'text', text: `Step "${stepId}" does not exist in plan "${planName}". Known ids: ${steps.map((s) => s.id).join(', ') || '(none)'}` }] };
      }
      plan.executions = plan.executions ?? {};
      const existing = plan.executions[stepId];
      if (existing && existing.status !== 'claimed') {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Step ${stepId} is ALREADY marked (${existing.status} at ${existing.ts}${existing.txHash ? `, tx ${existing.txHash}` : ''}). ` +
              `Refusing to double-record — if this step really executed twice, something upstream double-fired. ` +
              `Execution journal entries are immutable. Reconcile before creating a replacement plan.`,
          }],
        };
      }
      if (status === 'done' && !txHash) throw new Error('A completed step requires its broadcast transaction hash.');
      plan.executions[stepId] = { ts: new Date().toISOString(), status, txHash, note, operationId: existing?.operationId };
      plan.updatedAt = new Date().toISOString();
      durableJson(path, plan);
      const remaining = steps.filter(s => !plan.executions![String(s.id)] || plan.executions![String(s.id)].status === 'claimed').length;
      return {
        content: [{
          type: 'text',
          text: `✓ Step ${stepId} marked ${status}${txHash ? ` (tx ${txHash})` : ''}. ${remaining} step(s) remaining in "${planName}".${remaining === 0 ? ' Plan COMPLETE.' : ''}`,
        }],
      };
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
        const plan = JSON.parse(await readFile(path, 'utf8')) as PersistedPlan;
        if (Object.values(plan.executions ?? {}).some(e => e.status === 'claimed')) throw new Error('Cannot delete a plan with in-flight claims. Reconcile first.');
        await unlink(path);
        return { content: [{ type: 'text', text: `✓ Deleted plan "${planName}" from ${path}.` }] };
      } catch (e: any) {
        return { content: [{ type: 'text', text: `Failed to delete "${planName}": ${e?.message ?? e}` }] };
      }
    }

    return { content: [{ type: 'text', text: `Unknown plan tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Plan error: ${message}`);
  }
}

export async function handlePlanTool(name: string, args: Record<string, unknown> | undefined) {
  if (args && (['chaingpt_strategy_save_plan','chaingpt_strategy_mark_step','chaingpt_strategy_delete_plan'].includes(name) || (name === 'chaingpt_strategy_due_steps' && args.claim === true))) {
    return withPlanLock(String(args.name), () => handlePlanToolUnlocked(name, args));
  }
  return handlePlanToolUnlocked(name, args);
}
