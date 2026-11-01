import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

function decision(tool, input = {}, raw) {
  const r = spawnSync(process.execPath, ['hooks/mainnet-guard.js'], {
    input: raw ?? JSON.stringify({ tool_name: `mcp__plugin_chaingpt__${tool}`, tool_input: input }),
    encoding: 'utf8', env: { PATH: process.env.PATH, CHAINGPT_GUARD: 'on' }, timeout: 5000,
  });
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision;
}
test('every shipped autonomous signer forces confirmation, including Tron', () => {
  const dir = 'mcp-server/src/tools';
  const names = readdirSync(dir).flatMap(f => [...readFileSync(`${dir}/${f}`, 'utf8').matchAll(/name: '(chaingpt_[^']+sign_and_send)'/g)].map(m => m[1]));
  assert.equal(names.length, 4);
  for (const name of names) assert.equal(decision(name), 'ask', name);
});
test('signed submissions and facilitator settlement force confirmation by default', () => {
  for (const tool of ['chaingpt_aa_submit_userop','chaingpt_hl_submit_signed_action','chaingpt_pm_submit_signed_order','chaingpt_dex_cow_submit_signed_order']) assert.equal(decision(tool), 'ask');
  assert.equal(decision('chaingpt_x402_facilitator', { action: 'settle' }), 'ask');
  assert.equal(decision('chaingpt_x402_facilitator', { action: 'verify' }), undefined);
});
test('reads pass and malformed hook input fails closed', () => {
  assert.equal(decision('chaingpt_wallet_balances'), undefined);
  for (const raw of ['{','{}','null','[]',JSON.stringify({ tool_name: 'chaingpt_wallet_balances', tool_input: [] })]) assert.equal(decision('', {}, raw), 'deny');
});
test('an unknown future agent-wallet signer still asks, and the Tron prompt describes the token transfer', () => {
  assert.equal(decision('chaingpt_agent_wallet_newchain_sign_and_send'), 'ask');
  const r = spawnSync(process.execPath, ['hooks/mainnet-guard.js'], {
    input: JSON.stringify({ tool_name: 'mcp__plugin_chaingpt__chaingpt_agent_wallet_tron_sign_and_send',
      tool_input: { kind: 'trc20_transfer', token: 'USDT', amount: '5000', to: 'TRecipient' } }),
    encoding: 'utf8', env: { PATH: process.env.PATH, CHAINGPT_GUARD: 'on' }, timeout: 5000,
  });
  const why = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(why, /5000 USDT \(TRC-20\) to TRecipient/);
  assert.doesNotMatch(why, /wei/);
  const call = spawnSync(process.execPath, ['hooks/mainnet-guard.js'], {
    input: JSON.stringify({ tool_name: 'mcp__plugin_chaingpt__chaingpt_agent_wallet_tron_sign_and_send',
      tool_input: { kind: 'contract_call', contract: 'TContract', functionSelector: 'transfer(address,uint256)', parameter: 'abcdef0123' } }),
    encoding: 'utf8', env: { PATH: process.env.PATH, CHAINGPT_GUARD: 'on' }, timeout: 5000,
  });
  assert.match(JSON.parse(call.stdout).hookSpecificOutput.permissionDecisionReason, /args=abcdef0123/);
});
