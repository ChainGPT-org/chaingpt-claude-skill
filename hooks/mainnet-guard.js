#!/usr/bin/env node
/**
 * PreToolUse mainnet guard.
 *
 * A deterministic confirmation layer OUTSIDE the model: even a fully
 * prompt-injected agent cannot acknowledge its own mainnet action, because
 * this hook forces Claude Code's permission prompt for the moments that
 * move (or arm) real funds:
 *
 *   1. chaingpt_agent_wallet_sign_and_send  — signs + broadcasts autonomously
 *   2. any tx-building / order tool called WITH acknowledgeMainnet: true
 *      (the unsigned tx is about to be handed to a wallet for signing)
 *
 * Everything else (reads, quotes, refused/ack-less calls) passes through
 * untouched, so the guard adds zero friction to research flows.
 *
 * Opt out: CHAINGPT_GUARD=off
 * Strict mode: CHAINGPT_GUARD=strict also asks on EIP-712 order-signing
 * payload builders (Hyperliquid / Polymarket / CoW) even without an ack flag.
 */

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let out = {};
  try {
    const mode = (process.env.CHAINGPT_GUARD || 'on').toLowerCase();
    if (mode === 'off') {
      process.stdout.write('{}');
      return;
    }
    const evt = JSON.parse(raw || '{}');
    const tool = String(evt.tool_name || '');
    const input = evt.tool_input || {};

    const isAgentSend = /chaingpt_agent_wallet_sign_and_send$/.test(tool);
    // NOTE: the EVM regex does NOT match the solana tool name — both tests are required.
    const isAgentSolanaSend = /chaingpt_agent_wallet_solana_sign_and_send$/.test(tool);
    const hasAck = input && input.acknowledgeMainnet === true;
    const isOrderSigner =
      /chaingpt_(hl_place_order_payload|hl_submit_signed_action|pm_place_order_payload|pm_submit_signed_order|dex_cow_create_order|dex_cow_submit_signed_order)$/.test(
        tool
      );

    let ask = false;
    let why = '';
    if (isAgentSolanaSend) {
      ask = true;
      why = `Agent wallet is about to SIGN AND BROADCAST a Solana transaction autonomously: memo=${input.memo || '(none)'}, tx=${String(input.txBase64 || '').length} base64 chars. The Solana policy gate (program allowlist + lamport caps) has its own checks; this prompt is the human layer on top.`;
    } else if (isAgentSend) {
      ask = true;
      const v = input.valueWei ? `${input.valueWei} wei` : 'contract call (no native value)';
      why = `Agent wallet is about to SIGN AND BROADCAST autonomously on ${input.chain || '?'}: to=${input.to || '?'}, value=${v}, memo=${input.memo || '(none)'}. The policy gate has its own checks; this prompt is the human layer on top.`;
    } else if (hasAck) {
      ask = true;
      why = `${tool.replace(/^.*__/, '')} was called with acknowledgeMainnet: true — the next step is signing real funds on mainnet. Confirm the asset, amount, and destination are what you intend.`;
    } else if (mode === 'strict' && isOrderSigner) {
      ask = true;
      why = `${tool.replace(/^.*__/, '')} builds/submits a real-money order payload (strict guard mode).`;
    }

    if (ask) {
      out = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: why,
        },
      };
    }
  } catch {
    // Never block on guard malfunction — fail open to Claude Code's own
    // permission system, which still governs every tool call.
    out = {};
  }
  process.stdout.write(JSON.stringify(out));
});
