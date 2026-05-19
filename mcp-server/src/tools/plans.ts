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
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
}

function planPath(name: string): string {
  return join(planDir(), safeName(name) + '.json');
}

interface PersistedPlan {
  name: string;
  createdAt: string;
  updatedAt: string;
  type?: string;
  notes?: string;
  payload: unknown;
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

export async function handlePlanTool(
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
          if (prev?.createdAt) createdAt = prev.createdAt;
        } catch { /* ignore */ }
      }

      const persisted: PersistedPlan = {
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
