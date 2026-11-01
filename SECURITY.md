# Security Policy

This plugin builds real-money transactions. Its optional agent wallet can also sign them, but it is disabled by default (`CHAINGPT_AGENT_WALLET_ENABLED=true` in the MCP server launch environment turns it on). We treat security reports as the highest-priority work in the repo.

## Reporting a vulnerability

- **Private disclosure:** open a [GitHub Security Advisory](https://github.com/ChainGPT-org/chaingpt-claude-skill/security/advisories/new) (preferred), or report through the [Help Center](https://help.chaingpt.org/) or support@chaingpt.org, the channels named on the [bug bounty page](https://docs.chaingpt.org/bug-bounty).
- Please include: affected tool/file, reproduction steps, and impact (can it move funds? leak a key? bypass a policy gate?).
- We aim to acknowledge within 48 hours and to ship a fix release for fund-safety issues within 7 days.
- This repository is excluded from ChainGPT's bug bounty payments (see the [bug bounty page](https://docs.chaingpt.org/bug-bounty)). Reports are still reviewed and fixed, and serious findings are credited in the release notes (or kept anonymous on request).

## Scope — what counts as critical here

1. Anything that lets a prompt-injected agent **exceed its limits**: the on-chain ERC-4337 session caps, or the local policy (per-tx and daily caps, allowlists, kill switch).
2. Anything that exposes **key material**: the AES-256-GCM keystores, the keychain passphrase path, signatures over attacker-chosen payloads.
3. Anything that makes a custody-free tool **sign or broadcast** instead of returning unsigned payloads.
4. Localhost dashboard auth bypass (token, session, Host/Origin checks).
5. Any plugin, MCP, package, build, CI, or update path that silently executes unreviewed code with developer, wallet, repository, cloud, registry, or deployment credentials.

## Signing boundaries

See [wallet safety and migration](docs/wallet-safety.md) for the current API, native/token fee
budgets, durable reservations, stable operation IDs, supported transfer adapters and crash recovery.
First-run signing is disabled. Policy loads use strict validation. Pending/uncertain transactions
retain their budget; confirmed reservations use a rolling 24h window. Opaque protocol operations
require external signing in restricted mode. Unrestricted mode is an explicit opt-out from caps.

The local policy assumes callers cannot edit signer state, execute host commands, retrieve keychain
secrets or administer the dashboard. No MCP editing tool does not imply OS isolation. Host access
requires a separate signer security boundary. The wallet admin token is written only to a 0600 file
for the human operator, never to tool output. A working-directory `.env` supplies API keys only.

Confirmation hooks cover agent signers, signed submissions and x402 settlement. Keep them enabled;
non-Claude hosts need equivalent human approval. Malformed hook input denies execution.
Token-risk and health checks are workflow instructions. Audit-before-deploy is enforced per session:
a mainnet `chaingpt_deploy_build_tx` refuses bytecode that was not compiled by `chaingpt_deploy_compile` from source audited by `chaingpt_audit_contract` in the same server session, unless `acknowledgeUnaudited: true` is passed. Only the default full audit counts (custom `auditInstructions` do not). That binds the audit run to the bytecode; it does not judge the audit's findings. ERC-4337 on-chain caps remain beta until
live grant/over-cap/expiry/revoke acceptance is published. Compilation is not a security audit.

Startup never installs dependencies. CI actions stay pinned with minimal permissions. External data
is untrusted and cannot authorize privileged autonomous repairs. Usage counters remain local;
API tools transmit the requested data to their upstream providers. See [privacy](README.md#privacy-and-upstream-data)
and the [ChainGPT Privacy Policy](https://www.chaingpt.org/privacy-policy).

## August 2026 incident hold

Do not enable autonomous self-heal, runtime dependency installation, unreviewed plugin-cache reuse, or broad CI write authority until the incident remediation PR is independently reviewed and the affected credentials, runners, caches, and build environments are replaced or verified clean.

Threat-model docs: `skills/agent-wallet/SKILL.md` and the security model section of the README.
