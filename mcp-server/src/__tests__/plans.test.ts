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

import './_setup.js';
const TMP_DIR = mkdtempSync(join(tmpdir(), 'chaingpt-plans-test-'));
process.env.CHAINGPT_PLAN_DIR = TMP_DIR;

import { planTools, handlePlanTool } from '../tools/plans.js';

describe('Plan tool definitions', () => {
  it('exposes 6 plan tools', () => {
    expect(planTools.map((t) => t.name)).toEqual([
      'chaingpt_strategy_save_plan',
      'chaingpt_strategy_load_plan',
      'chaingpt_strategy_list_plans',
      'chaingpt_strategy_due_steps',
      'chaingpt_strategy_mark_step',
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

  describe('scheduled execution (due_steps + mark_step)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      kind: 'dca',
      network: 'ethereum',
      outToken: '0xweth',
      steps: [
        { id: 1, atUnix: nowSec - 3600, action: 'buy', usd: 100 },  // 1h overdue
        { id: 2, atUnix: nowSec + 300, action: 'buy', usd: 100 },   // due within 10m lookahead
        { id: 3, atUnix: nowSec + 86_400, action: 'buy', usd: 100 }, // tomorrow
      ],
    };

    it('returns overdue + lookahead steps, not future ones', async () => {
      await handlePlanTool('chaingpt_strategy_save_plan', { name: 'sched', payload, type: 'dca' });
      const r = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'sched' });
      const t = r.content[0].text;
      expect(t).toContain('Due now: 2');
      expect(t).toContain('Step 1');
      expect(t).toContain('Step 2');
      expect(t).not.toContain('• Step 3');
      expect(t).toContain('Upcoming: 1');
    });

    it('journal lifecycle: mark → idempotency refusal → overwrite → skip → completion', async () => {
      await handlePlanTool('chaingpt_strategy_save_plan', { name: 'sched2', payload, type: 'dca' });

      // mark step 1 → no longer due
      const m = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 1, txHash: '0xabc' });
      expect(m.content[0].text).toContain('Step 1 marked done');
      let r = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'sched2' });
      expect(r.content[0].text).toContain('Due now: 1');
      expect(r.content[0].text).not.toContain('• Step 1');
      expect(r.content[0].text).toContain('Executed: 1');

      // idempotency: double-record refused, original preserved; overwrite allowed
      const again = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 1, txHash: '0xdef' });
      expect(again.content[0].text).toContain('ALREADY marked');
      expect(again.content[0].text).toContain('0xabc');
      const forced = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 1, txHash: '0xdef', overwrite: true });
      expect(forced.content[0].text).toContain('Step 1 marked done');

      // unknown step id
      const unknown = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 99 });
      expect(unknown.content[0].text).toContain('does not exist');

      // skip is a decision; completing every step reports COMPLETE
      await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 2, status: 'skipped', note: 'impact 2.3%' });
      const last = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'sched2', stepId: 3, txHash: '0x333' });
      expect(last.content[0].text).toContain('Plan COMPLETE');
      r = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'sched2' });
      expect(r.content[0].text).toContain('COMPLETE');
    });

    it('id 0 is a valid (falsy) step id', async () => {
      await handlePlanTool('chaingpt_strategy_save_plan', {
        name: 'zero-id',
        payload: { steps: [{ id: 0, atUnix: nowSec - 60, action: 'buy', usd: 10 }] },
      });
      const due = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'zero-id' });
      expect(due.content[0].text).toContain('Step 0');
      const m = await handlePlanTool('chaingpt_strategy_mark_step', { name: 'zero-id', stepId: 0, txHash: '0x0' });
      expect(m.content[0].text).toContain('Step 0 marked done');
      const again = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'zero-id' });
      expect(again.content[0].text).toContain('Due now: 0');
    });

    it('duplicate step ids fail loudly at read time', async () => {
      await handlePlanTool('chaingpt_strategy_save_plan', {
        name: 'dup-ids',
        payload: { steps: [{ id: 1, atUnix: nowSec }, { id: 1, atUnix: nowSec + 60 }] },
      });
      await expect(handlePlanTool('chaingpt_strategy_due_steps', { name: 'dup-ids' })).rejects.toThrow(/duplicate id/);
    });

    it('due_steps explains the required shape for non-schedulable plans', async () => {
      await handlePlanTool('chaingpt_strategy_save_plan', { name: 'freeform', payload: { anything: true } });
      const r = await handlePlanTool('chaingpt_strategy_due_steps', { name: 'freeform' });
      expect(r.content[0].text).toContain('no schedulable steps');
      expect(r.content[0].text).toContain('payload.steps');
    });
  });
});
