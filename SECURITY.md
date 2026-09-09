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

## Standing security properties (verify, then break)

- Every state-changing tool returns UNSIGNED transactions unless the user opted into the agent wallet.
- The policy file has no MCP write surface; checks run in code at a single chokepoint per chain, fail-closed.
- Velocity caps are computed fresh from an append-only ledger at sign time.
- The on-chain session caps (v1.21+) are enforced by audited third-party contracts at EntryPoint validation — the local host is not in that trust path.
- MCP startup never performs an automatic package installation. Missing dependencies block startup until a human performs the approved deterministic install from reviewed manifests and lockfiles.
- External API responses and workflow logs are untrusted data. They are not copied into issues or supplied to an autonomous code-writing agent.
- Live-API smoke detects upstream drift. Repairs require human review; the former autonomous self-heal workflow is disabled pending a separately approved redesign.
- GitHub Actions must be pinned to immutable commit SHAs and run with the minimum token permissions required for the job.

## August 2026 incident hold

Do not enable autonomous self-heal, runtime dependency installation, unreviewed plugin-cache reuse, or broad CI write authority until the incident remediation PR is independently reviewed and the affected credentials, runners, caches, and build environments are replaced or verified clean.

Threat-model docs: `skills/agent-wallet/SKILL.md` and the security model section of the README.
