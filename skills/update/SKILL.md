---
name: chaingpt-update
description: "Check for and apply updates to the ChainGPT skill. Use when: update chaingpt, update skill, check for updates, latest version, outdated docs, new api features."
disable-model-invocation: true
---

# ChainGPT Skill Update Manager

When the user invokes this skill, follow these steps in order:

## Step 1: Check Current Version

Read the file `VERSION` in the skill root directory to determine the currently installed version:

```
cat VERSION
```

Report the current version to the user.

## Step 2: Check for Updates

Fetch the latest changes from the remote repository, then compare against the local HEAD:

```bash
git fetch origin
```

```bash
git log HEAD..origin/main --oneline
```

- If the `log` command returns **no output**, tell the user: "You are on the latest version (vX.X.X). No updates available."
- If the `log` command returns **one or more commits**, proceed to Step 3.

## Step 3: Show Changelog

Display the list of new commits to the user in a readable format. Categorize changes where possible:

- **New Endpoints** — Any new API routes or SDK methods added
- **SDK Updates** — Version bumps, new packages, breaking changes
- **New Patterns** — Additional smart contract templates or scaffolding
- **Bug Fixes** — Corrections to docs, examples, or the MCP server
- **Other** — Anything that doesn't fit the above

Ask the user: "Would you like to apply these updates?"

## Step 4: Apply Update

If the user confirms, pull the latest changes:

```bash
git pull origin main
```

Report the result. If the pull succeeds, read the updated `VERSION` file and confirm the new version.

## Step 5: Post-Update

After a successful update, check if the MCP server directory exists. If it does, remind the user:

> The MCP server may need to be rebuilt. Run:
> ```bash
> cd mcp-server && npm install && npm run build
> ```
> Then restart Claude Code for the MCP server changes to take effect.

---

## SDK Version Compatibility

| Product | NPM Package | Minimum Version | Docs Updated For |
|---------|-------------|----------------|-----------------|
| Web3 AI Chatbot | @chaingpt/generalchat | 1.0.0 | Latest |
| AI NFT Generator | @chaingpt/nft | 1.0.0 | Latest |
| Smart Contract Generator | @chaingpt/smartcontractgenerator | 1.0.0 | Latest |
| Smart Contract Auditor | @chaingpt/smartcontractauditor | 1.0.0 | Latest |
| AI Crypto News | @chaingpt/ainews | 1.0.0 | Latest |
| Python SDK | chaingpt | 1.1.3 | Latest |

## API Changelog

When a developer asks about recent API changes or reports an SDK method that does not match the skill's reference files:

1. Check https://docs.chaingpt.org for the latest API documentation.
2. Compare the live docs against the reference files bundled in this skill (under `reference/`).
3. If there is a discrepancy — a new parameter, a renamed method, a deprecated endpoint — inform the user of the difference.
4. Suggest the user run `/chaingpt-update` to pull the latest skill files that may include the fix.
5. If the skill is already up to date but the discrepancy persists, note it as a potential gap and recommend the user open an issue at https://github.com/ChainGPT-org/chaingpt-claude-skill/issues.
