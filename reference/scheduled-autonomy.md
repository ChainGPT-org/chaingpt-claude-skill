# Scheduled Autonomy — zero to a running daily DCA in 10 minutes

The end-to-end walkthrough: a $700 ETH DCA, $100 every morning at 09:00, executed
autonomously by the agent wallet inside hard caps. Adapt the numbers freely.

The design has three independent safety layers, and it's worth understanding why
each exists before you trust it with money:

| Layer | What it bounds | Where it lives |
|---|---|---|
| The saved plan + journal | WHAT executes and WHEN; re-runs can't double-buy | `~/.chaingpt-mcp/plans/<name>.json` |
| The policy gate | how much ANY signing can move (per tx + per rolling 24h) | `~/.chaingpt-mcp/agent-wallet/policy.json` |
| The schedule | merely WHEN a tick happens — it has no spending authority at all | Claude Code `/schedule` (or cron) |

A bug in the schedule (fires 100×) hits the journal (steps already marked) and the
velocity caps (daily spend exhausted). A bug in the plan hits the policy gate. The
LLM itself can relax none of these — no MCP tool writes the policy or the journal's
already-marked entries.

## Step 1 — Generate and save the plan (2 min)

```text
chaingpt_strategy_dca_plan outToken=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 network=ethereum totalUsd=700 intervals=7 cadenceHours=24
```

The output ends with a "Scheduled execution" JSON payload. Save it verbatim:

```text
chaingpt_strategy_save_plan name=eth-dca type=dca payload=<that JSON>
```

Sanity-check the journal machinery before any money is involved:

```text
chaingpt_strategy_due_steps name=eth-dca          → step 1 is due (or shows the next time)
chaingpt_strategy_mark_step name=eth-dca stepId=1 status=skipped note=dry-run-test
chaingpt_strategy_due_steps name=eth-dca          → step 1 no longer due ✓
chaingpt_strategy_mark_step name=eth-dca stepId=1 → refused (already marked) ✓ idempotency works
```

(Then delete + re-save the plan to clear the test entry, or keep step 1 skipped.)

## Step 2 — Pre-flight the asset, once (1 min)

```text
chaingpt_risk_token address=<outToken> chain=ethereum
chaingpt_research_token query=<outToken> chain=ethereum
```

A FAIL verdict ends the project here. For plans running longer than a couple of
weeks, re-run the risk check weekly — tokens get compromised after launch too.

## Step 3 — Arm the agent wallet (3 min)

```text
chaingpt_agent_wallet_init          # one-time; keychain-managed passphrase
chaingpt_agent_wallet_address      # fund THIS address with exactly the budget + gas
chaingpt_agent_wallet_serve_ui     # open the dashboard → apply the "DCA bot" template
chaingpt_agent_wallet_status       # confirm: killSwitch off, caps visible
```

The `dca-base` template is built for exactly this: one chain, one router, 0.05 ETH
per tx, 0.15 ETH + 6 txs per day, memo required. Fund the wallet with only the
plan's budget — the cheapest cap is the balance itself.

## Step 4 — Create the schedule (2 min)

In Claude Code:

```text
/schedule create "eth-dca tick" --cron "0 9 * * *" --prompt
  "Run one tick of saved plan 'eth-dca' per the chaingpt-scheduled-autonomy skill:
   chaingpt_strategy_due_steps name=eth-dca; nothing due → stop with a one-liner.
   Per due step: chaingpt_dex_quote (abort + mark_step status=skipped note=<reason>
   if price impact > 1%); chaingpt_agent_wallet_sign_and_send with memo 'eth-dca
   step <id>' and an explicit gasLimit; then IMMEDIATELY chaingpt_strategy_mark_step
   with the tx hash. End with: steps executed, spend vs daily cap, next step time."
```

Tick more often than the plan cadence if you want self-healing catch-up (daily plan,
6-hourly tick): `due_steps` returns everything overdue, and the daily-spend cap
bounds how much catch-up can execute in one window.

Headless note: the PreToolUse mainnet guard exists for interactive sessions. In the
scheduled environment ONLY, set `CHAINGPT_GUARD=off` — the policy gate + velocity
caps + funded-balance ceiling are the designed safety boundary for unattended runs.

## Step 5 — Verify the first tick, then walk away

After the first scheduled run, check: the tx on the explorer, `chaingpt_strategy_due_steps`
(journal advanced), and the dashboard Activity tab (memo trail). From then on the
summary lands on schedule, and `due_steps` reports COMPLETE when the plan is done —
remove the schedule at that point.

## Recipes beyond DCA

- **Aave health sentinel** (read-only, no wallet needed): hourly tick calling
  `chaingpt_defi_aave_health` — alert when HF < 1.6. Pure peace of mind.
- **Funding monitor**: `chaingpt_hl_funding` daily; surface venues where the
  funding-arb plan from `chaingpt_strategy_funding_arb_plan` clears its threshold.
- **Grid rebalance**: save a grid plan; ticks compare price against levels and
  prepare (or execute) the crossed legs — same journal discipline.
- **Risk re-check**: weekly `chaingpt_risk_token` over every token your plans touch;
  any new flag → engage the kill switch via the dashboard and stop the schedules.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Tick says "already marked" on a fresh step | Two schedulers firing — remove one. Never overwrite the journal entry. |
| `sign_and_send` refused: daily cap | Working as designed — caps bound catch-up. Raise the cap in the dashboard ONLY from an interactive session, deliberately. |
| `sign_and_send` refused: gasLimit required | The policy sets `maxTxGas`; pass an explicit `gasLimit` ≤ the cap on every send. |
| Steps pile up overdue | Scheduler isn't firing (machine asleep?) — Claude Code scheduled agents run in the cloud; local cron needs the machine awake. |
| Plan finished but the schedule still fires | `due_steps` says COMPLETE — delete the schedule; ticks are harmless but noisy. |
