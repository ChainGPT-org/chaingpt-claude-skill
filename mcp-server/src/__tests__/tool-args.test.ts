/** Tool arguments are validated against each tool's inputSchema before any handler runs. */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import './_setup.js';
import { toolArgsValidator } from '../lib/tool-args.js';

let tools: Array<{ name: string; inputSchema: any }> = [];
let argsError: ReturnType<typeof toolArgsValidator>;

beforeAll(async () => {
  const dir = join(__dirname, '..', 'tools');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const mod = await import(join(dir, f));
    for (const [k, v] of Object.entries(mod)) if (k.endsWith('Tools') && Array.isArray(v)) tools.push(...(v as any));
  }
  argsError = toolArgsValidator(tools);
}, 120_000); // imports every tool module, including the heavy Solana SDKs

describe('tool argument validation', () => {
  it('every shipped inputSchema compiles and accepts its own documented defaults', () => {
    expect(tools.length).toBeGreaterThanOrEqual(149);
    for (const t of tools) {
      const defaults = Object.fromEntries(Object.entries(t.inputSchema.properties ?? {})
        .filter(([, p]: any) => p.default !== undefined).map(([k, p]: any) => [k, p.default]));
      const required = t.inputSchema.required ?? [];
      // Only tools with no required args can be checked with defaults alone.
      if (required.length === 0) expect(argsError(t.name, defaults), t.name).toBeNull();
      else expect(argsError(t.name, {}), t.name).toMatch(/must have required property/);
    }
  }, 30_000);

  it('rejects a lowercase Polymarket side instead of building the opposite order', () => {
    const base = { maker: '0x' + '1'.repeat(40), tokenId: '1', price: '0.5', size: '10' };
    expect(argsError('chaingpt_pm_place_order_payload', { ...base, side: 'buy' })).toMatch(/must be equal to one of the allowed values/);
    expect(argsError('chaingpt_pm_place_order_payload', { ...base, side: 'BUY' })).toBeNull();
  });

  it('rejects string booleans for Hyperliquid order direction', () => {
    const order = { asset: 'ETH', isBuy: 'false', price: '3000', size: '1' };
    expect(argsError('chaingpt_hl_place_order_payload', order)).toMatch(/isBuy.*must be boolean/);
  });

  it('ignores unknown tool names (the router reports them)', () => {
    expect(argsError('chaingpt_not_a_tool', { anything: 1 })).toBeNull();
  });
});
