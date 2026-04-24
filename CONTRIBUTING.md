# Contributing to the ChainGPT Claude Skill

Thank you for your interest in improving the ChainGPT developer skill for Claude. This guide covers how to report issues, submit changes, and maintain quality standards.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/ChainGPT-org/chaingpt-claude-skill/issues) with:

1. **What you expected** — the correct API behavior, SDK output, or skill response.
2. **What actually happened** — the incorrect output, error, or missing information.
3. **Steps to reproduce** — the prompt you used with Claude, or the specific file/section with the error.
4. **Environment** — Claude Desktop vs. Claude Code, OS, Node/Python version if relevant.

Label the issue with one of: `bug`, `docs`, `pattern`, `template`, `example`, `mcp-server`, `mock-server`.

## Submitting Pull Requests

1. Fork the repository and create a feature branch from `main`.
2. Make your changes following the style guidelines below.
3. Run the validation script: `./scripts/validate.sh`
4. Ensure all checks pass before opening the PR.
5. Write a clear PR description explaining what changed and why.
6. Reference any related issues (e.g., "Fixes #42").

Keep PRs focused. One logical change per PR is preferred over large multi-topic changes.

## Code Style

### JavaScript / TypeScript Examples

- Use **TypeScript** conventions (even in `.js` files): `const`/`let` over `var`, arrow functions, async/await.
- Target **Node.js 18+** and **ES Modules** (`import`/`export`).
- Use `process.env.CHAINGPT_API_KEY` for API keys (never hardcode).
- Include error handling with try/catch.
- Add a comment header explaining what the example demonstrates.

### Python Examples

- Target **Python 3.10+**.
- Use `async`/`await` with `asyncio` where the SDK supports it.
- Use `os.environ["CHAINGPT_API_KEY"]` for API keys.
- Follow PEP 8 style conventions.
- Include type hints where practical.
- Add a docstring at the top of each file explaining the example.

### Markdown Files

- Use standard GitHub-Flavored Markdown.
- Keep lines under 120 characters where feasible.
- Use fenced code blocks with language identifiers (```javascript, ```python, ```bash, ```solidity).
- Reference files with backtick-quoted relative paths (e.g., `reference/llm-chatbot.md`).

## Adding New Patterns

Smart contract patterns live in `patterns/*.md`. To add a new pattern:

1. Choose the correct file (`tokens.md`, `nfts.md`, `defi.md`, `governance.md`, `security.md`) or propose a new category file.
2. Follow the existing format:
   - Pattern name as `###` heading
   - Brief description of use case
   - Complete Solidity code block
   - Key features list
   - Gas optimization notes if applicable
3. Ensure the contract compiles with Solidity 0.8.x.
4. If possible, verify the contract with the ChainGPT Smart Contract Auditor.

## Adding New Templates

Project scaffolding templates live in `templates/*.md`. To add a new template:

1. Follow the existing format:
   - Frontmatter or heading with template name and description
   - Prerequisites section (dependencies, API keys, etc.)
   - Complete file-by-file code generation instructions
   - Environment variable setup
   - Run instructions
2. Include all files needed for a working starter project.
3. Test the generated project end-to-end (install deps, run, verify output).
4. Add the template to the table in `SKILL.md` under "Project Scaffolding Templates".

## Updating Reference Docs

Reference files in `reference/*.md` document ChainGPT API endpoints and SDKs. When updating:

1. Verify changes against the official [ChainGPT Developer Docs](https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk).
2. Include request/response examples for any new endpoints.
3. Update pricing tables if credit costs have changed.
4. Keep the format consistent with existing reference files (parameter tables, code examples, notes).

## Testing Requirements

Before submitting any PR:

1. **Run the validation script:**
   ```bash
   ./scripts/validate.sh
   ```
   All checks must pass.

2. **For JavaScript examples:** ensure they pass `node --check`.
3. **For Python examples:** ensure they pass `python3 -c "import ast; ast.parse(...)"`.
4. **For MCP server changes:** run `cd mcp-server && npm test` if tests exist.
5. **For mock server changes:** run `cd mock-server && npm test` if tests exist.
6. **For SKILL.md changes:** verify the file stays under 500 lines, frontmatter is valid, and all referenced files exist.

## Project Structure

```
chaingpt-claude-skill/
  SKILL.md              # Main skill definition (< 500 lines)
  README.md             # Public readme
  plugin.json           # Claude plugin manifest
  VERSION               # Semantic version
  reference/            # API/SDK reference docs
  templates/            # Project scaffolding templates
  patterns/             # Smart contract patterns (Solidity)
  migration/            # Migration guides from other platforms
  examples/js/          # Working JavaScript examples
  examples/python/      # Working Python examples
  skills/               # Sub-skills (playground, debug, hackathon, update)
  mcp-server/           # MCP server for direct API access
  mock-server/          # Mock server for testing without credits
  scripts/              # Validation and utility scripts
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
