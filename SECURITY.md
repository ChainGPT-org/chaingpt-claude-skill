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

## Standing security properties (verify, then break)

- Every state-changing tool returns UNSIGNED transactions unless the user opted into the agent wallet.
- The policy file has no MCP write surface; checks run in code at a single chokepoint per chain, fail-closed.
- Velocity caps are computed fresh from an append-only ledger at sign time.
- The on-chain session caps (v1.21+) are enforced by audited third-party contracts at EntryPoint validation — the local host is not in that trust path.
- The daily live-API smoke + self-heal CI keep upstream integrations from rotting silently.

Threat-model docs: `skills/agent-wallet/SKILL.md` and the security model section of the README.
