# Security Policy

This plugin builds and (opt-in) signs real-money transactions. We treat security reports as the highest-priority work in the repo.

## Reporting a vulnerability

- **Private disclosure:** open a [GitHub Security Advisory](https://github.com/ChainGPT-org/chaingpt-claude-skill/security/advisories/new) (preferred), or email security@chaingpt.org.
- Please include: affected tool/file, reproduction steps, and impact (can it move funds? leak a key? bypass a policy gate?).
- We aim to acknowledge within 48 hours and to ship a fix release for fund-safety issues within 7 days.
- No bounty program is published for this repo yet; serious findings will be credited in the release notes (or kept anonymous on request).

## Scope — what counts as critical here

1. Anything that lets a prompt-injected agent **exceed the policy gate**: per-tx caps, daily velocity caps, allowlists, the kill switch, the Solana lamport caps, the ERC-4337 session gates.
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
requires a separate signer security boundary. Dashboard admin tokens are privileged tool outputs.

Confirmation hooks cover agent signers, signed submissions and x402 settlement. Keep them enabled;
non-Claude hosts need equivalent human approval. Malformed hook input denies execution.
Audit-before-deploy, token-risk and health checks are workflow instructions; the unsigned deployment
builder does not bind a verified audit receipt to bytecode. ERC-4337 on-chain caps remain beta until
live grant/over-cap/expiry/revoke acceptance is published. Compilation is not a security audit.

Startup never installs dependencies. CI actions stay pinned with minimal permissions. External data
is untrusted and cannot authorize privileged autonomous repairs. Usage counters remain local;
API tools transmit the requested data to their upstream providers. See [privacy](README.md#privacy-and-upstream-data)
and the [ChainGPT Privacy Policy](https://www.chaingpt.org/privacy-policy).

## August 2026 incident hold

Do not enable autonomous self-heal, runtime dependency installation, unreviewed plugin-cache reuse, or broad CI write authority until the incident remediation PR is independently reviewed and the affected credentials, runners, caches, and build environments are replaced or verified clean.

Threat-model docs: `skills/agent-wallet/SKILL.md` and the security model section of the README.
