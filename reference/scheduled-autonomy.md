# Scheduled strategies and recovery

The current procedure is in [wallet safety](../docs/wallet-safety.md) and
[the scheduled strategy skill](../skills/scheduled-autonomy/SKILL.md).

Generate a plan, review it, and save it locally. `due_steps` is read-only by default.
For an authorized agent-wallet action, `due_steps claim=true` atomically reserves each due step
and returns a stable operationId. Use that exact id for signing and receipt reconciliation.
A crash leaves the step in flight; it does not become a fresh purchase on the next tick.
Mark its result only after obtaining the transaction hash. Never overwrite execution history,
reset journals to restore allowance, or disable confirmation for an unattended tick.

Native limits include fee reservations; tokens require independent asset/recipient limits.
Restricted signing supports canonical direct transfers and bounded ERC-20 approvals. Protocol
swaps/lending/compositions must use unsigned builders and external signing. Scheduling cannot
make external-wallet actions atomic or deduplicate different IDs representing the same intention.

Use scheduled research, risk/health monitoring and unsigned preparation when no human executor
is present. An unattended signer needs its own reviewed executor and approval boundary.
