/**
 * Strategy plan persistence tests.
 *
 * Uses a tmp directory via CHAINGPT_PLAN_DIR to avoid touching the user's
 * real ~/.chaingpt-mcp/plans/ during tests.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CHAINGPT_API_KEY = 'test-key';
const TMP_DIR = mkdtempSync(join(tmpdir(), 'chaingpt-plans-test-'));
process.env.CHAINGPT_PLAN_DIR = TMP_DIR;

import { planTools, handlePlanTool } from '../tools/plans.js';

describe('Plan tool definitions', () => {
  it('exposes 4 plan tools', () => {
    expect(planTools.map((t) => t.name)).toEqual([
      'chaingpt_strategy_save_plan',
      'chaingpt_strategy_load_plan',
      'chaingpt_strategy_list_plans',
      'chaingpt_strategy_delete_plan',
    ]);
  });

  it('delete_plan requires explicit confirm', () => {
    const t = planTools.find((t) => t.name === 'chaingpt_strategy_delete_plan')!;
    expect((t.inputSchema as any).properties.confirm).toBeDefined();
  });
});

describe('Plan persistence round-trip', () => {
  beforeEach(() => {
    // Clear tmp dir between tests
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('save → list → load → delete round-trips', async () => {
    const payload = { schedule: [{ ts: 1715000000, sizeUsd: 100 }, { ts: 1715086400, sizeUsd: 100 }] };

    // 1. Save
    const save = await handlePlanTool('chaingpt_strategy_save_plan', {
      name: 'btc-dca-q2',
      payload,
      type: 'dca',
      notes: 'BTC DCA $100/day',
    });
    expect(save.content[0].text).toContain('Saved plan "btc-dca-q2"');

    // 2. List
    const list = await handlePlanTool('chaingpt_strategy_list_plans', {});
    expect(list.content[0].text).toContain('btc-dca-q2');
    expect(list.content[0].text).toContain('[dca]');

    // 3. Load
    const load = await handlePlanTool('chaingpt_strategy_load_plan', { name: 'btc-dca-q2' });
    const t = load.content[0].text;
    expect(t).toContain('Plan: btc-dca-q2');
    expect(t).toContain('Type: dca');
    expect(t).toContain('"sizeUsd": 100');

    // 4. Delete (refuses without confirm)
    const deleteNoConfirm = await handlePlanTool('chaingpt_strategy_delete_plan', { name: 'btc-dca-q2' });
    expect(deleteNoConfirm.content[0].text).toContain('Refused');

    const deleteConfirm = await handlePlanTool('chaingpt_strategy_delete_plan', { name: 'btc-dca-q2', confirm: true });
    expect(deleteConfirm.content[0].text).toContain('Deleted plan "btc-dca-q2"');

    // 5. Verify gone
    const loadAfter = await handlePlanTool('chaingpt_strategy_load_plan', { name: 'btc-dca-q2' });
    expect(loadAfter.content[0].text).toContain('not found');
  });

  it('save refuses to overwrite without overwrite=true', async () => {
    await handlePlanTool('chaingpt_strategy_save_plan', { name: 'sol-grid', payload: { v: 1 }, type: 'grid' });
    const second = await handlePlanTool('chaingpt_strategy_save_plan', { name: 'sol-grid', payload: { v: 2 }, type: 'grid' });
    expect(second.content[0].text).toContain('already exists');
    // Confirm v=1 is still there
    const load = await handlePlanTool('chaingpt_strategy_load_plan', { name: 'sol-grid' });
    expect(load.content[0].text).toContain('"v": 1');
  });

  it('save with overwrite=true preserves createdAt', async () => {
    await handlePlanTool('chaingpt_strategy_save_plan', { name: 'eth-grid', payload: { v: 1 }, type: 'grid' });
    // Small delay so updatedAt differs from createdAt
    await new Promise((r) => setTimeout(r, 5));
    await handlePlanTool('chaingpt_strategy_save_plan', {
      name: 'eth-grid',
      payload: { v: 2 },
      type: 'grid',
      overwrite: true,
    });
    const load = await handlePlanTool('chaingpt_strategy_load_plan', { name: 'eth-grid' });
    const t = load.content[0].text;
    expect(t).toContain('"v": 2');
    // The createdAt should be the original, updatedAt the new one — they should differ
    const createdAtMatch = t.match(/Created: (\S+)/);
    const updatedAtMatch = t.match(/Updated: (\S+)/);
    expect(createdAtMatch).not.toBeNull();
    expect(updatedAtMatch).not.toBeNull();
    expect(createdAtMatch![1]).not.toBe(updatedAtMatch![1]);
  });

  it('list_plans filters by type', async () => {
    await handlePlanTool('chaingpt_strategy_save_plan', { name: 'a', payload: {}, type: 'dca' });
    await handlePlanTool('chaingpt_strategy_save_plan', { name: 'b', payload: {}, type: 'grid' });
    await handlePlanTool('chaingpt_strategy_save_plan', { name: 'c', payload: {}, type: 'grid' });

    const dcaList = await handlePlanTool('chaingpt_strategy_list_plans', { type: 'dca' });
    expect(dcaList.content[0].text).toContain('a');
    expect(dcaList.content[0].text).not.toContain('• b');
    expect(dcaList.content[0].text).not.toContain('• c');

    const gridList = await handlePlanTool('chaingpt_strategy_list_plans', { type: 'grid' });
    expect(gridList.content[0].text).toContain('b');
    expect(gridList.content[0].text).toContain('c');
    expect(gridList.content[0].text).not.toContain('• a');
  });

  it('safeName sanitizes path-traversal attempts', async () => {
    // Should not allow ../ to escape the dir
    const r = await handlePlanTool('chaingpt_strategy_save_plan', {
      name: '../../etc/passwd',
      payload: { evil: true },
    });
    expect(r.content[0].text).toContain('Saved plan');
    // Path traversal chars are replaced with underscores, so a file
    // exists, but inside TMP_DIR — not escaping it.
    const load = await handlePlanTool('chaingpt_strategy_load_plan', { name: '../../etc/passwd' });
    expect(load.content[0].text).toContain('Plan: ../../etc/passwd');
  });

  it('load returns friendly message for unknown plan', async () => {
    const r = await handlePlanTool('chaingpt_strategy_load_plan', { name: 'does-not-exist' });
    expect(r.content[0].text).toContain('not found');
  });
});
