# Smart Contract Audit CI/CD Pipeline Template

Instructions for Claude to scaffold a CLI tool and GitHub Actions pipeline that audits Solidity smart contracts using the ChainGPT Smart Contract Auditor SDK.

---

## What to Generate

### Project Structure

```
chaingpt-audit-pipeline/
├── package.json
├── .env.example
├── tsconfig.json
├── src/
│   ├── audit.ts          # Core audit logic
│   ├── cli.ts            # CLI entry point
│   └── reporter.ts       # Format audit results
├── .github/
│   └── workflows/
│       └── audit.yml     # GitHub Actions workflow
└── README.md
```

### Dependencies

**Production:**
- `@chaingpt/smartcontractauditor` — ChainGPT audit SDK
- `commander` — CLI argument parsing
- `chalk` — colored terminal output
- `glob` — file pattern matching
- `dotenv` — environment variables

**Dev:**
- `typescript`
- `ts-node`

### package.json

```json
{
  "name": "chaingpt-audit-pipeline",
  "version": "1.0.0",
  "bin": {
    "chaingpt-audit": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "audit": "ts-node src/cli.ts",
    "start": "node dist/cli.js"
  }
}
```

---

## Key Implementation Details

### src/audit.ts — Core Audit Logic

```typescript
import { SmartContractAuditor } from "@chaingpt/smartcontractauditor";

const auditor = new SmartContractAuditor({
  apiKey: process.env.CHAINGPT_API_KEY!,
});
```

**auditContract(code: string, sessionId?: string): Promise\<AuditResult\>**
- Read the .sol file content as a string
- Call `auditor.auditSmartContractBlob()` with:
  ```typescript
  {
    question: `Perform a comprehensive security audit of this smart contract. Identify all vulnerabilities, rate severity, and provide remediation suggestions:\n\n${contractCode}`,
    chatHistory: "off",
  }
  ```
- The response is `response.data.bot` — a markdown-formatted audit report
- Parse the response to extract:
  - **Overall score** (0-100) — look for pattern like "Score: XX/100" or "XX%"
  - **Findings by severity** — count Critical, High, Medium, Low, Informational sections
  - **Raw report text** — preserve the full markdown

**auditContractStream(code: string): AsyncIterable\<string\>**
- Call `auditor.auditSmartContractStream()` for real-time output
- Yield chunks as they arrive (useful for verbose CLI mode)

**parseAuditScore(report: string): number**
- Regex to extract numeric score from audit report
- Return -1 if score cannot be parsed (don't fail silently)

**countFindings(report: string): FindingSummary**
- Parse markdown headers and bullet points to count findings per severity level
- Return `{ critical: number, high: number, medium: number, low: number, info: number }`

### src/cli.ts — CLI Entry Point

Use `commander` to define the CLI:

```typescript
#!/usr/bin/env node
import { program } from "commander";

program
  .name("chaingpt-audit")
  .description("Audit Solidity smart contracts using ChainGPT AI")
  .argument("<path>", "Path to .sol file(s) or directory")
  .option("-v, --verbose", "Show full audit output in real-time (streaming)")
  .option("-o, --output <file>", "Save report to file (markdown format)")
  .option("-t, --threshold <score>", "Minimum passing score (default: 70)", "70")
  .option("--json", "Output results as JSON")
  .action(async (path, options) => { /* ... */ });

program.parse();
```

**CLI behavior:**
1. Resolve the path argument — if directory, glob for `**/*.sol` files
2. For each .sol file:
   - Read file contents
   - Display "Auditing <filename>..." with a spinner or progress indicator
   - Call `auditContract()` (or `auditContractStream()` if `--verbose`)
   - Collect results
3. After all files are audited:
   - Print summary table using chalk (filename | score | critical | high | medium | low)
   - If `--output` specified, write full markdown report to file
   - If `--json` specified, output JSON to stdout
4. **Exit code:** 0 if ALL files score >= threshold, 1 if any file fails

### src/reporter.ts — Output Formatting

**formatConsole(results: AuditResult[]): void**
- Print a colored summary table:
  - Green for score >= 80
  - Yellow for score 60-79
  - Red for score < 60
- Show severity counts with color coding (red for critical/high, yellow for medium, white for low)
- Print total files audited, pass/fail count

**formatMarkdown(results: AuditResult[]): string**
- Generate a markdown report with:
  - Header with date and tool version
  - Summary table (same as console but in markdown table format)
  - Full audit report for each file, separated by `---` dividers
  - Pass/fail verdict at the bottom

**formatJson(results: AuditResult[]): string**
- Structured JSON output for programmatic consumption:
```typescript
{
  "timestamp": "...",
  "summary": { "total": 3, "passed": 2, "failed": 1, "threshold": 70 },
  "results": [
    {
      "file": "Token.sol",
      "score": 85,
      "findings": { "critical": 0, "high": 0, "medium": 2, "low": 3, "info": 5 },
      "report": "..."
    }
  ]
}
```

### TypeScript Interfaces

```typescript
export interface AuditResult {
  file: string;
  score: number;
  findings: FindingSummary;
  report: string;
  passed: boolean;
}

export interface FindingSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AuditOptions {
  verbose: boolean;
  output?: string;
  threshold: number;
  json: boolean;
}
```

---

## GitHub Actions Workflow

### .github/workflows/audit.yml

```yaml
name: Smart Contract Audit

on:
  pull_request:
    paths:
      - "contracts/**/*.sol"
      - "src/**/*.sol"

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install audit tool
        run: |
          cd audit-tool  # or install globally from npm
          npm install
          npm run build

      - name: Run audit
        id: audit
        env:
          CHAINGPT_API_KEY: ${{ secrets.CHAINGPT_API_KEY }}
        run: |
          npx chaingpt-audit ./contracts/ \
            --threshold 70 \
            --output audit-report.md \
            --json > audit-results.json
        continue-on-error: true

      - name: Post PR comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('audit-report.md', 'utf8');
            const truncated = report.length > 60000
              ? report.substring(0, 60000) + '\n\n... (truncated)'
              : report;

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## ChainGPT Smart Contract Audit\n\n${truncated}`
            });

      - name: Check threshold
        if: steps.audit.outcome == 'failure'
        run: |
          echo "One or more contracts scored below the threshold."
          exit 1

      - name: Upload report artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: audit-report
          path: |
            audit-report.md
            audit-results.json
```

---

## .env.example

```
CHAINGPT_API_KEY=your_api_key_here
AUDIT_THRESHOLD=70
```

---

## Usage Instructions

### Local CLI

```bash
npm install
npm run build

# Audit a single file
npx chaingpt-audit ./contracts/Token.sol

# Audit all .sol files in a directory
npx chaingpt-audit ./contracts/

# Verbose streaming output
npx chaingpt-audit ./contracts/Token.sol --verbose

# Save markdown report
npx chaingpt-audit ./contracts/ --output report.md

# JSON output for CI pipelines
npx chaingpt-audit ./contracts/ --json

# Custom threshold (fail if below 80)
npx chaingpt-audit ./contracts/ --threshold 80
```

### GitHub Actions Setup

1. Add `CHAINGPT_API_KEY` as a repository secret (Settings > Secrets > Actions)
2. Copy the `.github/workflows/audit.yml` file into the repository
3. Adjust the `paths` trigger to match where .sol files live
4. PRs that modify Solidity files will automatically trigger an audit
5. Audit results are posted as a PR comment and uploaded as an artifact

---

## SDK Reference Notes

- The auditor uses model `"smart_contract_auditor"` internally
- All requests go to `POST https://api.chaingpt.org/chat/stream`
- Blob method: `auditor.auditSmartContractBlob({ question, chatHistory, sdkUniqueId })`
- Stream method: `auditor.auditSmartContractStream({ question, chatHistory })`
- Response format: `response.data.bot` contains the full markdown audit report
- Credit cost: same as general chat (0.5 per request, +0.5 with history)
- Rate limit: 200 requests/minute
- Chat history can be used to ask follow-up questions about the same contract
