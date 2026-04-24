# Multi-Product Composition Patterns

Advanced patterns for combining 2+ ChainGPT API products into unified workflows.
For simpler two-product combos, see the dedicated templates:
- [combo-nft-marketplace.md](combo-nft-marketplace.md) — NFT Generator + LLM + Auditor + News
- [combo-defi-dashboard.md](combo-defi-dashboard.md) — LLM + News + Auditor

This document covers five additional composition patterns with service orchestration code,
architecture diagrams, and cost breakdowns.

---

## Table of Contents

1. [Token Launch Platform](#1-token-launch-platform)
2. [AI-Powered Security Suite](#2-ai-powered-security-suite)
3. [Social Trading Intelligence](#3-social-trading-intelligence)
4. [Full-Stack NFT Studio](#4-full-stack-nft-studio)
5. [Crypto Research Assistant](#5-crypto-research-assistant)

---

## 1. Token Launch Platform

**Products:** Contract Generator + Auditor + LLM + News

Generate a token contract from a description, auto-audit it, provide deployment
guidance via the LLM, and monitor market context via the news feed.

### Architecture

```
                        +-----------------------+
  User Spec             |   Token Launch API    |
  (name, symbol,        |   (Express server)    |
   supply, features)    +-----------+-----------+
        |                           |
        v                           |
  +----------------+    +-----------+-----------+
  |  Contract       |    |    Orchestrator       |
  |  Generator      |    |    Service            |
  |  @chaingpt/     |--->|                       |
  |  smartcontract  |    |  1. generate          |
  |  generator      |    |  2. audit             |
  +----------------+    |  3. explain via LLM    |
                        |  4. fetch market news  |
  +----------------+    |                       |
  |  Auditor        |    |                       |
  |  @chaingpt/     |<---|                       |
  |  smartcontract  |    |                       |
  |  auditor        |    |                       |
  +----------------+    |                       |
                        |                       |
  +----------------+    |                       |
  |  LLM            |    |                       |
  |  @chaingpt/     |<---|                       |
  |  generalchat    |    |                       |
  +----------------+    |                       |
                        |                       |
  +----------------+    |                       |
  |  News           |    |                       |
  |  @chaingpt/     |<---|                       |
  |  ainews         |    +-----------------------+
  +----------------+
```

### Product Interaction Flow

```
User Request
  |
  v
[1] Contract Generator — "Create an ERC-20 token called X with Y supply..."
  |   Returns: Solidity source code
  v
[2] Auditor — "Audit this contract for vulnerabilities: <source>"
  |   Returns: Score (0-100), findings by severity, remediation
  v
[3] LLM — "Given this audit report, explain each finding and provide
  |         deployment instructions for <chain>"
  |   Returns: Plain-English explanation + Hardhat/Foundry deploy steps
  v
[4] News — Fetch recent articles for the token's category/chain
  |   Returns: Market context, trending narratives
  v
Combined Response to User
```

### TypeScript Service Code

```typescript
// src/services/tokenLaunchService.ts
import { SmartContractGenerator } from "@chaingpt/smartcontractgenerator";
import { SmartContractAuditor } from "@chaingpt/smartcontractauditor";
import { GeneralChat } from "@chaingpt/generalchat";
import { AiNews } from "@chaingpt/ainews";

interface TokenSpec {
  name: string;
  symbol: string;
  supply: string;
  features: string[];  // e.g. ["burnable", "pausable", "mintable"]
  chain: string;       // e.g. "Ethereum", "BSC"
}

interface LaunchResult {
  contractSource: string;
  auditReport: string;
  auditScore: string;
  deployGuide: string;
  marketContext: { title: string; url: string; pubDate: string }[];
}

const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY! });
const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY! });
const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
const news = new AiNews({ apiKey: process.env.CHAINGPT_API_KEY! });

export async function launchToken(spec: TokenSpec): Promise<LaunchResult> {
  const sessionId = `launch-${Date.now()}`;

  // Step 1: Generate the contract
  const featureList = spec.features.join(", ");
  const genResponse = await generator.createSmartContractBlob({
    question: `Create an ERC-20 token called ${spec.name} with symbol ${spec.symbol}, `
            + `${spec.supply} total supply, and these features: ${featureList}. `
            + `Use OpenZeppelin v5 contracts.`,
    chatHistory: "off",
  });
  const contractSource = genResponse.data.bot;

  // Step 2: Audit the generated contract
  const auditResponse = await auditor.auditSmartContractBlob({
    question: `Audit this contract for security vulnerabilities:\n\n${contractSource}`,
    chatHistory: "off",
  });
  const auditReport = auditResponse.data.bot;

  // Extract score from audit report (format: "Overall Score: XX/100")
  const scoreMatch = auditReport.match(/Score:\s*(\d+)/);
  const auditScore = scoreMatch ? scoreMatch[1] : "N/A";

  // Step 3: LLM explains findings + deployment guidance
  const llmResponse = await chat.createChatBlob({
    question: `I generated this ERC-20 token contract and ran an audit on it.\n\n`
            + `Audit report:\n${auditReport}\n\n`
            + `Please:\n`
            + `1. Explain each audit finding in plain English\n`
            + `2. Suggest fixes for any issues found\n`
            + `3. Provide step-by-step deployment instructions for ${spec.chain} `
            + `using Hardhat`,
    chatHistory: "on",
    sdkUniqueId: sessionId,
  });
  const deployGuide = llmResponse.data.bot;

  // Step 4: Fetch market context (DeFi category = 5)
  const newsResponse = await news.getNews({
    categoryId: 5,
    limit: 5,
    sortBy: "createdAt",
  });
  const marketContext = newsResponse.data.map((article: any) => ({
    title: article.title,
    url: article.url,
    pubDate: article.pubDate,
  }));

  return { contractSource, auditReport, auditScore, deployGuide, marketContext };
}
```

```typescript
// src/routes/launch.ts
import { Router, Request, Response } from "express";
import { launchToken } from "../services/tokenLaunchService";

const router = Router();

router.post("/launch", async (req: Request, res: Response) => {
  try {
    const { name, symbol, supply, features, chain } = req.body;

    if (!name || !symbol || !supply) {
      return res.status(400).json({ error: "name, symbol, and supply are required" });
    }

    const result = await launchToken({
      name,
      symbol,
      supply,
      features: features || [],
      chain: chain || "Ethereum",
    });

    res.json({
      status: "success",
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Credit Cost Per Operation

| Step | Product | Credits | Notes |
|------|---------|---------|-------|
| Generate contract | Contract Generator | 1 | No history needed |
| Audit contract | Auditor | 1 | Single-pass audit |
| Deployment guide | LLM (with history) | 1 | History ON for follow-ups |
| Market news | News (5 articles) | 1 | Per 10 records |
| **Total per launch** | | **4** | **~$0.04 USD** |

### Scaling Considerations

- **Caching:** Cache generated contracts by spec hash; same token config = same code.
- **Parallel steps:** Steps 3 and 4 (LLM + News) are independent of each other. Run them
  with `Promise.all()` after the audit completes.
- **Rate limits:** 200 req/min per API key. A single launch uses 4 requests. At full
  concurrency, handle ~50 launches/min.
- **Audit retry:** If audit score is below a threshold (e.g., < 80), re-generate with
  chatHistory ON, feeding audit findings back to the generator for a revised contract.

---

## 2. AI-Powered Security Suite

**Products:** Auditor + LLM + Patterns Library (from `patterns/security.md`)

Paste a contract, audit it, have the LLM explain findings in plain English,
and suggest specific fixes from the ChainGPT patterns library.

### Architecture

```
  Contract Source Code
        |
        v
  +----------------+     +------------------+
  |  Auditor        |---->|  Finding Parser   |
  |  @chaingpt/     |     |  (extract issues) |
  |  smartcontract  |     +--------+---------+
  |  auditor        |              |
  +----------------+              v
                          +------------------+
                          |  LLM              |
                          |  @chaingpt/       |
                          |  generalchat      |
                          |                  |
                          |  "Explain these   |
                          |   findings..."    |
                          +--------+---------+
                                   |
                                   v
                          +------------------+
                          |  Pattern Matcher  |
                          |  (local lookup)   |
                          |                  |
                          |  Maps findings    |
                          |  to patterns/     |
                          |  security.md      |
                          +--------+---------+
                                   |
                                   v
                          Combined Report:
                          - Plain English summary
                          - Severity breakdown
                          - Fix snippets from patterns
```

### Product Interaction Flow

```
User pastes contract
  |
  v
[1] Auditor — Full security audit, returns scored report with findings
  |
  v
[2] Finding Parser — Extract issue categories (reentrancy, access control, etc.)
  |
  v
[3] LLM — "Explain these audit findings to a non-technical stakeholder"
  |
  v
[4] Pattern Matcher — Map each finding category to a fix from patterns/security.md
  |   (Reentrancy -> Pattern #8, Access Control -> Pattern #1, Pausable -> Pattern #2)
  |
  v
Unified security report with explanations + code fixes
```

### TypeScript Service Code

```typescript
// src/services/securitySuiteService.ts
import { SmartContractAuditor } from "@chaingpt/smartcontractauditor";
import { GeneralChat } from "@chaingpt/generalchat";
import * as fs from "fs";
import * as path from "path";

interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low" | "informational";
  category: string;
  description: string;
}

interface SecurityReport {
  auditReport: string;
  auditScore: string;
  plainEnglish: string;
  findings: AuditFinding[];
  suggestedFixes: { category: string; patternName: string; snippet: string }[];
}

// Map audit finding keywords to pattern library sections
const PATTERN_MAP: Record<string, { name: string; section: number }> = {
  "reentrancy":     { name: "Reentrancy Guard",          section: 8 },
  "access control": { name: "Role-Based Access Control",  section: 1 },
  "access":         { name: "Role-Based Access Control",  section: 1 },
  "pause":          { name: "Pausable Contract",          section: 2 },
  "upgrade":        { name: "UUPS Upgradeable",           section: 3 },
  "timelock":       { name: "Timelock",                   section: 4 },
  "rate limit":     { name: "Rate Limiter",               section: 5 },
  "escrow":         { name: "Escrow",                     section: 6 },
  "pull payment":   { name: "Pull Payment",               section: 7 },
  "signature":      { name: "Signature Verification",     section: 9 },
  "permit":         { name: "Permit (ERC-2612)",          section: 10 },
};

const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY! });
const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

// Load patterns library once at startup
const patternsPath = path.join(__dirname, "../../patterns/security.md");
const patternsContent = fs.readFileSync(patternsPath, "utf-8");

function extractPatternSnippet(sectionNumber: number): string {
  const regex = new RegExp(
    `## ${sectionNumber}\\.\\s+[\\s\\S]*?\`\`\`solidity\\n([\\s\\S]*?)\`\`\``,
    "m"
  );
  const match = patternsContent.match(regex);
  return match ? match[1].trim().slice(0, 500) + "\n// ... (see patterns/security.md)" : "";
}

function matchFindings(findings: AuditFinding[]): SecurityReport["suggestedFixes"] {
  const fixes: SecurityReport["suggestedFixes"] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const text = `${finding.category} ${finding.description}`.toLowerCase();
    for (const [keyword, pattern] of Object.entries(PATTERN_MAP)) {
      if (text.includes(keyword) && !seen.has(pattern.name)) {
        seen.add(pattern.name);
        fixes.push({
          category: finding.category,
          patternName: pattern.name,
          snippet: extractPatternSnippet(pattern.section),
        });
      }
    }
  }
  return fixes;
}

function parseFindings(auditReport: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const severities = ["critical", "high", "medium", "low", "informational"] as const;

  for (const severity of severities) {
    const regex = new RegExp(
      `### ${severity}[\\s\\S]*?(?=###|$)`,
      "gi"
    );
    const section = auditReport.match(regex);
    if (section) {
      const lines = section[0].split("\n").filter((l) => /^\d+\./.test(l.trim()));
      for (const line of lines) {
        findings.push({
          severity,
          category: severity,
          description: line.replace(/^\d+\.\s*/, "").trim(),
        });
      }
    }
  }
  return findings;
}

export async function analyzeContract(contractSource: string): Promise<SecurityReport> {
  // Step 1: Audit
  const auditResponse = await auditor.auditSmartContractBlob({
    question: `Audit this contract for security vulnerabilities:\n\n${contractSource}`,
    chatHistory: "off",
  });
  const auditReport = auditResponse.data.bot;

  const scoreMatch = auditReport.match(/Score:\s*(\d+)/);
  const auditScore = scoreMatch ? scoreMatch[1] : "N/A";

  // Step 2: Parse findings
  const findings = parseFindings(auditReport);

  // Step 3: LLM plain-English explanation
  const llmResponse = await chat.createChatBlob({
    question: `You are a smart contract security expert. Explain this audit report `
            + `to a non-technical project manager. Use simple language, no jargon. `
            + `For each finding, explain: what it means, what could go wrong, and `
            + `how urgent it is.\n\nAudit Report:\n${auditReport}`,
    chatHistory: "off",
  });
  const plainEnglish = llmResponse.data.bot;

  // Step 4: Match findings to pattern library fixes
  const suggestedFixes = matchFindings(findings);

  return { auditReport, auditScore, plainEnglish, findings, suggestedFixes };
}
```

```typescript
// src/routes/security.ts
import { Router, Request, Response } from "express";
import { analyzeContract } from "../services/securitySuiteService";

const router = Router();

router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const { contractSource } = req.body;

    if (!contractSource) {
      return res.status(400).json({ error: "contractSource is required" });
    }

    const report = await analyzeContract(contractSource);
    res.json({ status: "success", data: report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Credit Cost Per Operation

| Step | Product | Credits | Notes |
|------|---------|---------|-------|
| Audit contract | Auditor | 1 | Single-pass audit |
| LLM explanation | LLM | 0.5 | No history needed |
| Pattern matching | Local | 0 | File lookup, no API call |
| **Total per analysis** | | **1.5** | **~$0.015 USD** |

### Scaling Considerations

- **Pattern library is local:** The patterns lookup is pure file I/O, so it scales
  independently of the API. Pre-parse patterns at server start and keep them in memory.
- **Caching audits:** Hash the contract source and cache audit results. Same bytecode =
  same findings.
- **Batch mode:** Accept an array of contracts and process them in parallel with
  `Promise.allSettled()`. Each contract uses 1.5 credits.
- **Webhook mode:** For CI/CD integration, accept a webhook from GitHub Actions on PR,
  audit changed `.sol` files, and post results as a PR comment.

---

## 3. Social Trading Intelligence

**Products:** LLM + News + AgenticOS

Fetch trending crypto news, analyze sentiment with the LLM, and auto-post
insights to Twitter/X via AgenticOS.

### Architecture

```
  +------------------+
  |  Cron Scheduler  |  (runs every N minutes)
  |  node-cron       |
  +--------+---------+
           |
           v
  +------------------+     +------------------+
  |  News Service     |---->|  Topic Ranker     |
  |  @chaingpt/       |     |  (dedupe, score   |
  |  ainews            |     |   by views/recency)|
  +------------------+     +--------+---------+
                                    |
                                    v
                           +------------------+
                           |  LLM Service      |
                           |  @chaingpt/       |
                           |  generalchat      |
                           |                  |
                           |  "Analyze sentiment|
                           |   and generate a  |
                           |   tweet..."       |
                           +--------+---------+
                                    |
                                    v
                           +------------------+
                           |  AgenticOS        |
                           |  POST to Twitter  |
                           |  via OAuth 2.0    |
                           +------------------+
                                    |
                                    v
                           Tweet posted to X
```

### Product Interaction Flow

```
[Cron trigger or manual POST /trigger]
  |
  v
[1] News — Fetch top 10 trending articles (sorted by viewsCount)
  |   Returns: Headlines, summaries, categories
  v
[2] Topic Ranker — Score articles by recency + views, pick top 3
  |
  v
[3] LLM — "Given these 3 trending topics, write a concise market
  |         insight tweet (max 280 chars). Include sentiment analysis."
  |   Returns: Tweet text + sentiment (bullish/bearish/neutral)
  v
[4] AgenticOS — Post the tweet via Twitter OAuth 2.0
  |   The AgenticOS schedule.json can also trigger this autonomously
  v
Tweet live on X
```

### TypeScript Service Code

```typescript
// src/services/socialIntelService.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { AiNews } from "@chaingpt/ainews";
import axios from "axios";

interface TrendingTopic {
  title: string;
  description: string;
  category: string;
  viewsCount: number;
}

interface InsightResult {
  topics: TrendingTopic[];
  tweet: string;
  sentiment: "bullish" | "bearish" | "neutral";
  posted: boolean;
}

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
const news = new AiNews({ apiKey: process.env.CHAINGPT_API_KEY! });

// AgenticOS runs as a separate service; we trigger tweet generation via its API
const AGENTICOS_URL = process.env.AGENTICOS_URL || "http://localhost:8000";

async function fetchTrendingTopics(): Promise<TrendingTopic[]> {
  const response = await news.getNews({
    limit: 10,
    sortBy: "createdAt",
  });

  return response.data
    .map((article: any) => ({
      title: article.title,
      description: article.description,
      category: article.category?.name || "General",
      viewsCount: article.viewsCount || 0,
    }))
    .sort((a: TrendingTopic, b: TrendingTopic) => b.viewsCount - a.viewsCount)
    .slice(0, 3);
}

async function generateInsightTweet(topics: TrendingTopic[]): Promise<{
  tweet: string;
  sentiment: "bullish" | "bearish" | "neutral";
}> {
  const topicSummary = topics
    .map((t, i) => `${i + 1}. [${t.category}] ${t.title}: ${t.description}`)
    .join("\n");

  const response = await chat.createChatBlob({
    question: `You are a crypto market analyst running a Twitter account. `
            + `Based on these 3 trending news stories, write ONE tweet `
            + `(max 270 characters, leave room for emoji). Be insightful, not generic. `
            + `Also classify overall sentiment as bullish, bearish, or neutral.\n\n`
            + `Trending stories:\n${topicSummary}\n\n`
            + `Format your response as:\n`
            + `SENTIMENT: <bullish|bearish|neutral>\n`
            + `TWEET: <your tweet text>`,
    chatHistory: "off",
  });

  const text = response.data.bot;
  const sentimentMatch = text.match(/SENTIMENT:\s*(bullish|bearish|neutral)/i);
  const tweetMatch = text.match(/TWEET:\s*(.+)/s);

  return {
    sentiment: (sentimentMatch?.[1]?.toLowerCase() as any) || "neutral",
    tweet: tweetMatch?.[1]?.trim().slice(0, 280) || text.slice(0, 280),
  };
}

async function postToAgenticOS(tweet: string): Promise<boolean> {
  try {
    // AgenticOS uses ChainGPT LLM internally to generate tweets.
    // If you want to post a pre-composed tweet, update schedule.json
    // with a custom instruction that includes the exact text.
    // Alternatively, use the Twitter API directly if AgenticOS
    // is configured with OAuth credentials.
    await axios.post(`${AGENTICOS_URL}/api/webhook/`, {
      type: "market_insight",
      content: tweet,
    });
    return true;
  } catch {
    return false;
  }
}

export async function generateAndPostInsight(): Promise<InsightResult> {
  // Step 1: Fetch trending topics
  const topics = await fetchTrendingTopics();

  // Step 2: Generate tweet via LLM
  const { tweet, sentiment } = await generateInsightTweet(topics);

  // Step 3: Post via AgenticOS
  const posted = await postToAgenticOS(tweet);

  return { topics, tweet, sentiment, posted };
}
```

```typescript
// src/routes/social.ts
import { Router, Request, Response } from "express";
import cron from "node-cron";
import { generateAndPostInsight } from "../services/socialIntelService";

const router = Router();

// Manual trigger
router.post("/trigger", async (_req: Request, res: Response) => {
  try {
    const result = await generateAndPostInsight();
    res.json({ status: "success", data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Automated schedule: every 4 hours
cron.schedule("0 */4 * * *", async () => {
  try {
    const result = await generateAndPostInsight();
    console.log(`[Social Intel] Posted tweet — sentiment: ${result.sentiment}`);
  } catch (error) {
    console.error("[Social Intel] Scheduled post failed:", error);
  }
});

export default router;
```

### Credit Cost Per Operation

| Step | Product | Credits | Notes |
|------|---------|---------|-------|
| Fetch news (10 articles) | News | 1 | Per 10 records |
| Generate tweet | LLM | 0.5 | No history needed |
| AgenticOS tweet | AgenticOS | 1 | Per generated tweet |
| **Total per post** | | **2.5** | **~$0.025 USD** |

With a 4-hour schedule: 6 posts/day = **15 credits/day** (~$0.15/day, ~$4.50/month).

### Scaling Considerations

- **Deduplication:** Track posted topic hashes in a local store (Redis or SQLite) to
  avoid tweeting about the same story twice.
- **Multi-account:** Run separate AgenticOS instances per Twitter account. Each has its
  own OAuth credentials and schedule.json.
- **Rate limits:** Twitter free tier allows 1,500 tweets/month. X Premium allows more.
  The ChainGPT API side is 200 req/min, not a bottleneck here.
- **Content safety:** Add a moderation check on LLM output before posting. Reject tweets
  that contain financial advice, price predictions, or investment recommendations.
- **Event-driven alternative:** Instead of cron, subscribe to ChainGPT news webhooks
  (see AgenticOS reference) for real-time breaking news alerts.

---

## 4. Full-Stack NFT Studio

**Products:** NFT Generator + LLM + Auditor

LLM generates creative prompts, NFT Generator creates the images, Contract
Generator builds a custom NFT contract, the Auditor verifies it, and the
result is ready to deploy.

### Architecture

```
  User Input                   +-----------------------+
  ("cyberpunk cats             |   NFT Studio API      |
   collection, 10k supply")   +-----------+-----------+
        |                                 |
        v                                 |
  +----------------+          +-----------+-----------+
  |  LLM            |          |    Studio              |
  |  @chaingpt/     |--------->|    Orchestrator         |
  |  generalchat    |          |                       |
  |                |          |  1. creative prompts   |
  |  "Generate 5   |          |  2. generate images    |
  |   unique NFT   |          |  3. generate contract  |
  |   prompts..."  |          |  4. audit contract     |
  +----------------+          |  5. bundle result      |
                              |                       |
  +----------------+          |                       |
  |  NFT Generator  |          |                       |
  |  @chaingpt/nft  |<---------|                       |
  +----------------+          |                       |
                              |                       |
  +----------------+          |                       |
  |  Contract Gen   |          |                       |
  |  @chaingpt/     |<---------|                       |
  |  smartcontract  |          |                       |
  |  generator      |          |                       |
  +----------------+          |                       |
                              |                       |
  +----------------+          |                       |
  |  Auditor        |          |                       |
  |  @chaingpt/     |<---------|                       |
  |  smartcontract  |          +-----------------------+
  |  auditor        |
  +----------------+
```

### Product Interaction Flow

```
User: "Create a cyberpunk cats NFT collection, 10k supply, on BSC"
  |
  v
[1] LLM — "Generate 5 unique NFT art prompts for a cyberpunk cats collection.
  |         Each should have distinct traits (fur color, accessories, background)."
  |   Returns: Array of 5 detailed prompts with trait metadata
  v
[2] NFT Generator — Generate an image for each prompt (parallel)
  |   Returns: 5 image buffers (JPEG/PNG)
  v
[3] Contract Generator — "Create an ERC-721A NFT contract with 10,000 supply,
  |                        0.05 BNB mint price, batch minting, metadata URI"
  |   Returns: Solidity source code
  v
[4] Auditor — Audit the generated NFT contract
  |   Returns: Score + findings
  v
[5] Bundle — Return images, contract source, audit report, and deploy instructions
```

### TypeScript Service Code

```typescript
// src/services/nftStudioService.ts
import { SmartContractGenerator } from "@chaingpt/smartcontractgenerator";
import { SmartContractAuditor } from "@chaingpt/smartcontractauditor";
import { GeneralChat } from "@chaingpt/generalchat";
import { Nft } from "@chaingpt/nft";

interface CollectionSpec {
  theme: string;
  supply: number;
  mintPrice: string;
  chain: string;
  previewCount: number;  // how many preview images to generate
}

interface NftStudioResult {
  prompts: { prompt: string; traits: Record<string, string> }[];
  images: Buffer[];
  contractSource: string;
  auditReport: string;
  auditScore: string;
}

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY! });
const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY! });
const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY! });

export async function createNftCollection(spec: CollectionSpec): Promise<NftStudioResult> {
  // Step 1: LLM generates creative prompts
  const promptResponse = await chat.createChatBlob({
    question: `You are an NFT art director. Generate ${spec.previewCount} unique image `
            + `prompts for an NFT collection themed "${spec.theme}". For each prompt, `
            + `include trait metadata (background, character, accessory, rarity).\n\n`
            + `Format as JSON array:\n`
            + `[{"prompt": "...", "traits": {"background": "...", "character": "...", `
            + `"accessory": "...", "rarity": "common|rare|legendary"}}]`,
    chatHistory: "off",
  });

  let prompts: { prompt: string; traits: Record<string, string> }[];
  try {
    const jsonMatch = promptResponse.data.bot.match(/\[[\s\S]*\]/);
    prompts = JSON.parse(jsonMatch![0]);
  } catch {
    // Fallback: create simple prompts
    prompts = Array.from({ length: spec.previewCount }, (_, i) => ({
      prompt: `${spec.theme} character #${i + 1}, digital art, detailed`,
      traits: { variant: String(i + 1) },
    }));
  }

  // Step 2: Generate images in parallel
  const imagePromises = prompts.map((p) =>
    nft.generateImage({
      prompt: p.prompt,
      model: "velogen",
      height: 512,
      width: 512,
    })
  );
  const imageResults = await Promise.allSettled(imagePromises);
  const images = imageResults
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => Buffer.from(r.value.data));

  // Step 3: Generate NFT contract
  const contractResponse = await generator.createSmartContractBlob({
    question: `Create an ERC-721A NFT contract with:\n`
            + `- Collection name: "${spec.theme}"\n`
            + `- Max supply: ${spec.supply}\n`
            + `- Mint price: ${spec.mintPrice}\n`
            + `- Batch minting support\n`
            + `- Metadata URI with reveal mechanism\n`
            + `- Withdrawal function for owner\n`
            + `- ERC-2981 royalties at 5%\n`
            + `Use OpenZeppelin v5 and ERC-721A.`,
    chatHistory: "off",
  });
  const contractSource = contractResponse.data.bot;

  // Step 4: Audit the contract
  const auditResponse = await auditor.auditSmartContractBlob({
    question: `Audit this NFT contract:\n\n${contractSource}`,
    chatHistory: "off",
  });
  const auditReport = auditResponse.data.bot;
  const scoreMatch = auditReport.match(/Score:\s*(\d+)/);
  const auditScore = scoreMatch ? scoreMatch[1] : "N/A";

  return { prompts, images, contractSource, auditReport, auditScore };
}
```

```typescript
// src/routes/studio.ts
import { Router, Request, Response } from "express";
import { createNftCollection } from "../services/nftStudioService";

const router = Router();

router.post("/create-collection", async (req: Request, res: Response) => {
  try {
    const { theme, supply, mintPrice, chain, previewCount } = req.body;

    if (!theme) {
      return res.status(400).json({ error: "theme is required" });
    }

    const result = await createNftCollection({
      theme,
      supply: supply || 10000,
      mintPrice: mintPrice || "0.05 ETH",
      chain: chain || "Ethereum",
      previewCount: Math.min(previewCount || 5, 10),  // cap at 10 previews
    });

    // Return images as base64 for JSON transport
    res.json({
      status: "success",
      data: {
        prompts: result.prompts,
        images: result.images.map((buf) => buf.toString("base64")),
        contractSource: result.contractSource,
        auditReport: result.auditReport,
        auditScore: result.auditScore,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Credit Cost Per Operation

| Step | Product | Credits | Notes |
|------|---------|---------|-------|
| Generate prompts | LLM | 0.5 | No history |
| Generate images (5x) | NFT Generator | 5 | 1 credit each (VeloGen, no upscale) |
| Generate contract | Contract Generator | 1 | No history |
| Audit contract | Auditor | 1 | Single-pass audit |
| **Total (5 previews)** | | **7.5** | **~$0.075 USD** |

With upscaling: add 1-2 credits per image. With Dale3 model: 4.75 credits per image.

### Scaling Considerations

- **Image generation is the bottleneck.** Each image takes 2-10 seconds. Run them in
  parallel with `Promise.allSettled()` (already shown above).
- **Progressive delivery:** Stream results to the client as each step completes.
  Send prompts first, then images as they arrive, then contract + audit.
- **Storage:** Store generated images in S3/IPFS. Return URLs instead of base64 for
  large collections.
- **Batch collections:** For full 10k collections, use the LLM to generate a trait
  probability matrix, then combine traits programmatically (not via API per image).
- **Cost control:** Cap `previewCount` on the server side. Full collection generation
  should be a paid feature, not an open endpoint.

---

## 5. Crypto Research Assistant

**Products:** LLM + News

User asks a research question, the LLM answers with on-chain data, and News
provides recent context. The results are merged into a single response.

### Architecture

```
  User Question
  "What's happening with
   Ethereum L2 adoption?"
        |
        v
  +-----+-----+
  |  Splitter  |  (keyword extraction + query routing)
  +--+------+--+
     |      |
     v      v
  +-----+ +--------+
  | LLM | | News   |       ---- parallel requests ----
  +--+--+ +---+----+
     |        |
     v        v
  +--+--------+--+
  |   Aggregator  |  (merge LLM analysis + news articles)
  +-------+------+
          |
          v
  Combined Research Response:
  - LLM deep analysis
  - Supporting news articles
  - Source attribution
```

### Product Interaction Flow

```
User: "What's happening with Ethereum L2 adoption?"
  |
  v
[1] Keyword Extraction — Parse query for search terms ("Ethereum", "L2")
  |
  +-----> [2a] LLM (parallel)
  |         "Analyze Ethereum L2 adoption. Include data on TVL, user growth,
  |          and top L2s by activity."
  |         Returns: Detailed analysis with on-chain data
  |
  +-----> [2b] News (parallel)
  |         Search: "Ethereum L2" (subCategoryId: 15 for Ethereum)
  |         Returns: Recent articles about Ethereum L2s
  |
  v
[3] Aggregator — Combine LLM analysis + news articles
  |   - LLM provides the analytical framework
  |   - News provides timestamped evidence and breaking developments
  v
Final response with analysis + sources
```

### TypeScript Service Code

```typescript
// src/services/researchService.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { AiNews } from "@chaingpt/ainews";

interface ResearchResult {
  analysis: string;
  articles: {
    title: string;
    description: string;
    url: string;
    pubDate: string;
    category: string;
  }[];
  combined: string;
}

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
const news = new AiNews({ apiKey: process.env.CHAINGPT_API_KEY! });

// Map common topics to news category/subcategory IDs
const TOPIC_MAP: Record<string, { categoryId?: number; subCategoryId?: number }> = {
  defi:       { categoryId: 5 },
  nft:        { categoryId: 8 },
  gaming:     { categoryId: 2 },
  dao:        { categoryId: 3 },
  ethereum:   { subCategoryId: 15 },
  bsc:        { subCategoryId: 12 },
  solana:     { subCategoryId: 22 },
  arbitrum:   { subCategoryId: 28 },
  stablecoin: { categoryId: 9 },
};

function detectTopicFilters(query: string): { categoryId?: number; subCategoryId?: number } {
  const lower = query.toLowerCase();
  for (const [keyword, filter] of Object.entries(TOPIC_MAP)) {
    if (lower.includes(keyword)) return filter;
  }
  return {};
}

export async function research(question: string, sessionId?: string): Promise<ResearchResult> {
  const topicFilter = detectTopicFilters(question);

  // Run LLM analysis and news fetch in parallel
  const [llmResult, newsResult] = await Promise.all([
    // LLM deep analysis
    chat.createChatBlob({
      question: `You are a crypto research analyst. Provide a detailed analysis for: `
              + `"${question}". Include relevant on-chain data, metrics, and trends. `
              + `Structure your response with sections: Overview, Key Data Points, `
              + `Analysis, and Outlook.`,
      chatHistory: sessionId ? "on" : "off",
      ...(sessionId && { sdkUniqueId: sessionId }),
    }),

    // News context
    news.getNews({
      ...topicFilter,
      searchQuery: question.slice(0, 100),
      limit: 5,
      sortBy: "createdAt",
    }),
  ]);

  const analysis = llmResult.data.bot;

  const articles = newsResult.data.map((article: any) => ({
    title: article.title,
    description: article.description,
    url: article.url,
    pubDate: article.pubDate,
    category: article.category?.name || "General",
  }));

  // Build combined response
  const articleSummary = articles.length > 0
    ? articles.map((a: any) => `- [${a.category}] ${a.title} (${a.pubDate})`).join("\n")
    : "No recent news articles found for this topic.";

  const combined = `## Research Analysis\n\n${analysis}\n\n`
                 + `## Recent News Context\n\n${articleSummary}\n\n`
                 + `---\n*Analysis powered by ChainGPT LLM with real-time on-chain data. `
                 + `News sourced from ChainGPT AI News.*`;

  return { analysis, articles, combined };
}
```

```typescript
// src/routes/research.ts
import { Router, Request, Response } from "express";
import { research } from "../services/researchService";

const router = Router();

// Single question
router.post("/ask", async (req: Request, res: Response) => {
  try {
    const { question, sessionId } = req.body;

    if (!question) {
      return res.status(400).json({ error: "question is required" });
    }

    const result = await research(question, sessionId);
    res.json({ status: "success", data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Follow-up question (uses chat history)
router.post("/follow-up", async (req: Request, res: Response) => {
  try {
    const { question, sessionId } = req.body;

    if (!question || !sessionId) {
      return res.status(400).json({ error: "question and sessionId are required" });
    }

    const result = await research(question, sessionId);
    res.json({ status: "success", data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Credit Cost Per Operation

| Step | Product | Credits | Notes |
|------|---------|---------|-------|
| LLM analysis | LLM | 0.5 | 1.0 if using chat history |
| News fetch (5 articles) | News | 1 | Per 10 records |
| **Total (no history)** | | **1.5** | **~$0.015 USD** |
| **Total (with history)** | | **2.0** | **~$0.02 USD** |

### Scaling Considerations

- **Session management:** Use `sdkUniqueId` to maintain conversation context. Users can
  ask follow-up questions ("Now compare that with Solana") without repeating context.
- **Response caching:** Cache research results by question hash with a short TTL
  (5-15 minutes). Crypto data moves fast, so stale caches are worse than no cache.
- **Streaming:** Use `createChatStream()` for the LLM call to stream the analysis to the
  client while news loads in the background. Reduces perceived latency.
- **Topic detection:** The `TOPIC_MAP` is a simple keyword lookup. For production, use
  the LLM itself to extract entities and map them to category IDs.
- **Cost at scale:** At 1.5 credits per query, 10k queries/day = 15k credits = $150/day.
  Enable the 15% $CGPT token bonus to reduce this to ~$127.50/day.

---

## General Composition Guidelines

### Shared Dependencies

All patterns above use the same base setup:

```json
{
  "dependencies": {
    "@chaingpt/generalchat": "latest",
    "@chaingpt/smartcontractauditor": "latest",
    "@chaingpt/smartcontractgenerator": "latest",
    "@chaingpt/nft": "latest",
    "@chaingpt/ainews": "latest",
    "express": "^4.18.0",
    "dotenv": "^16.0.0",
    "cors": "^2.8.0"
  }
}
```

### .env.example

```bash
CHAINGPT_API_KEY=your-api-key-here
PORT=3000
# For Social Trading Intelligence pattern:
AGENTICOS_URL=http://localhost:8000
```

### Initialization Pattern

All SDK clients accept the same `apiKey` option. Initialize once, reuse across requests:

```typescript
// src/config/chaingpt.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { SmartContractAuditor } from "@chaingpt/smartcontractauditor";
import { SmartContractGenerator } from "@chaingpt/smartcontractgenerator";
import { Nft } from "@chaingpt/nft";
import { AiNews } from "@chaingpt/ainews";

const apiKey = process.env.CHAINGPT_API_KEY!;

export const chat = new GeneralChat({ apiKey });
export const auditor = new SmartContractAuditor({ apiKey });
export const generator = new SmartContractGenerator({ apiKey });
export const nftClient = new Nft({ apiKey });
export const newsClient = new AiNews({ apiKey });
```

### Error Handling Across Products

When orchestrating multiple products, handle partial failures gracefully:

```typescript
interface StepResult<T> {
  step: string;
  status: "success" | "error";
  data?: T;
  error?: string;
}

async function safeStep<T>(step: string, fn: () => Promise<T>): Promise<StepResult<T>> {
  try {
    const data = await fn();
    return { step, status: "success", data };
  } catch (error: any) {
    return { step, status: "error", error: error.message };
  }
}
```

### Rate Limit Budget

All ChainGPT API products share a **200 requests/minute** rate limit per API key.
When combining products, count total API calls per workflow:

| Pattern | API Calls per Run | Max Concurrent Runs at 200 req/min |
|---------|-------------------|------------------------------------|
| Token Launch Platform | 4 | 50 |
| AI Security Suite | 2 | 100 |
| Social Trading Intelligence | 3 | 66 |
| Full-Stack NFT Studio | 7+ | 28 |
| Crypto Research Assistant | 2 | 100 |

For higher throughput, request additional API keys or contact ChainGPT for enterprise
rate limits.
