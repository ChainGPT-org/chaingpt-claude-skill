# ChainGPT API Cost Optimization

Strategies to minimize credit usage while maintaining quality. All costs reference
the standard pricing (1 credit = $0.01 USD). See `pricing.md` for full rate card.

---

## 1. Chat History Toggle

The LLM Chatbot and Smart Contract endpoints charge **double** when chat history
is enabled (0.5 -> 1.0 for chat, 1.0 -> 2.0 for contracts).

**Strategy: default to off, enable only when context is required.**

```typescript
import { GeneralChat } from "@chaingpt/generalchat";

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY });

// Single-shot question — no history needed (0.5 credits)
const quick = await chat.createChatBlob({
  question: "What is EIP-4337?",
  chatHistory: "off",
});

// Multi-turn conversation — enable history (1.0 credits per message)
const conversational = await chat.createChatBlob({
  question: "Now explain how it relates to account abstraction",
  chatHistory: "on",
});
```

**When to use each mode:**

| Scenario | History | Cost/msg |
|----------|---------|----------|
| One-off lookups, definitions, price checks | off | 0.5 cr |
| Code generation with no follow-up | off | 0.5 cr |
| Iterative debugging, multi-step reasoning | on | 1.0 cr |
| Contract refinement over multiple prompts | on | 2.0 cr |

**Savings:** a support bot answering 10,000 independent questions/month saves
5,000 credits ($50) by defaulting to history off.

---

## 2. Response Caching

Many API responses are identical or near-identical for repeated queries. Cache
them locally to avoid redundant credit spend.

```typescript
import NodeCache from "node-cache";

const cache = new NodeCache();

// TTL recommendations per product
const TTL = {
  llmChat: 3600,         // 1 hour — answers are deterministic for same prompt
  news: 300,             // 5 minutes — news updates infrequently
  contractAudit: 86400,  // 24 hours — same code = same audit
  contractGen: 86400,    // 24 hours — same spec = same contract
  nftPrompt: 86400,      // 24 hours — prompt enhancement is deterministic
} as const;

async function cachedChat(question: string): Promise<string> {
  const key = `chat:${question}`;
  const cached = cache.get<string>(key);
  if (cached) return cached;

  const response = await chat.createChatBlob({
    question,
    chatHistory: "off",
  });
  const answer = response.data?.bot ?? "";
  cache.set(key, answer, TTL.llmChat);
  return answer;
}
```

**Cache hit rates by product (typical):**

| Product | Expected Hit Rate | TTL | Notes |
|---------|-------------------|-----|-------|
| LLM Chat | 20-40% | 1h | FAQ-type queries repeat often |
| News | 60-80% | 5m | Same category/token queries |
| Contract Audit | 50-70% | 24h | Same contract re-audited during dev |
| NFT Prompt Enhancement | 30-50% | 24h | Users refine similar prompts |

For distributed systems, replace `node-cache` with Redis:

```typescript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

async function cachedChatRedis(question: string): Promise<string> {
  const key = `cgpt:chat:${question}`;
  const cached = await redis.get(key);
  if (cached) return cached;

  const response = await chat.createChatBlob({
    question,
    chatHistory: "off",
  });
  const answer = response.data?.bot ?? "";
  await redis.setex(key, TTL.llmChat, answer);
  return answer;
}
```

---

## 3. Batch Optimization (NFT Generation)

NFT generation costs vary dramatically by model and options. Choose wisely.

**Model selection strategy:**

| Phase | Model | Credits | Use Case |
|-------|-------|---------|----------|
| Preview / draft | VeloGen | 1.0 | Fast iteration, concept validation |
| Final render | NebulaForge XL | 1.0 | High quality, same price as VeloGen |
| Photorealistic | Dale3 1024x1024 | 4.75 | Only when photorealism is required |
| Photorealistic other res | Dale3 | ~9.5 | Avoid — 2x cost for non-standard sizes |

**Skip prompt enhancement when your prompt is already detailed:**

```typescript
import { Nft } from "@chaingpt/nft";

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY });

// BAD: paying 0.5 extra credits for enhancement on a detailed prompt
const expensive = await nft.generateNft({
  prompt: "A cyberpunk samurai standing on a neon-lit Tokyo rooftop at night, "
    + "rain reflecting city lights, detailed armor with glowing circuits, "
    + "cinematic composition, 8k quality",
  model: "velogen",
  enhance: '1x',  // +0.5 credits — unnecessary here
});

// GOOD: skip enhancement, prompt is already specific (saves 0.5 credits)
const optimized = await nft.generateNft({
  prompt: "A cyberpunk samurai standing on a neon-lit Tokyo rooftop at night, "
    + "rain reflecting city lights, detailed armor with glowing circuits, "
    + "cinematic composition, 8k quality",
  model: "velogen",
  enhance: 'original',
});
```

**Upscale and character preserve cost awareness:**

| Option | Additional Credits | When to Use |
|--------|--------------------|-------------|
| 1x upscale | +1.0 | Final assets only |
| 2x upscale | +2.0 | Print / high-res display only |
| Character preserve | +5.0 | Series with consistent characters |

**Rule of thumb:** generate 5-10 previews with VeloGen (5-10 credits), then
upscale only the 1-2 winners (2-4 credits). Total: 7-14 credits vs. generating
all at Dale3 with upscale (28-67 credits).

---

## 4. News API Efficiency

The News API charges 1 credit per 10 records. Optimize batch size and use free
alternatives where possible.

```typescript
import { AINews } from "@chaingpt/ainews";
import Parser from "rss-parser";

const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY });
const rss = new Parser();

// Strategy 1: Fetch max batch size (50) to minimize per-record cost
// 50 records = 5 credits. Fetching 10 at a time for the same data = 5 calls = 5 credits
// Same cost, but fewer HTTP round-trips with batch of 50.
const batch = await news.getNews({
  limit: 50,            // max allowed — always use this
  category: "defi",
  sortBy: "createdAt",
  sortOrder: "desc",
});

// Strategy 2: Use RSS feeds (FREE) for real-time monitoring
const RSS_FEEDS = {
  general: "https://app.chaingpt.org/rssfeeds.xml",
  bitcoin: "https://app.chaingpt.org/rssfeeds-bitcoin.xml",
  ethereum: "https://app.chaingpt.org/rssfeeds-ethereum.xml",
  bnb: "https://app.chaingpt.org/rssfeeds-bnb.xml",
};

async function getLatestNews(category: keyof typeof RSS_FEEDS) {
  // Free — no credits consumed
  const feed = await rss.parseURL(RSS_FEEDS[category]);
  return feed.items.slice(0, 20);
}

// Strategy 3: Use the API only for filtered/search queries RSS cannot do
// e.g., token-specific news, sentiment filtering, custom date ranges
const filtered = await news.getNews({
  limit: 50,
  token: "ETH",
  category: "defi",
});
```

**Decision matrix:**

| Need | Source | Cost |
|------|--------|------|
| Latest headlines, category browsing | RSS feed | Free |
| Real-time feed / webhooks | RSS polling (60s interval) | Free |
| Token-specific filtering | API | 1 cr / 10 records |
| Sentiment or date-range queries | API | 1 cr / 10 records |
| Full-text search | API | 1 cr / 10 records |

**Monthly savings example:** a dashboard showing top-20 headlines refreshed every
5 minutes. With API: 20 records x 12 refreshes/hour x 24h x 30 days = 2 credits x 8,640
= 17,280 credits ($172.80). With RSS: $0.

---

## 5. Smart Contract Patterns

Use a local patterns library for common contracts instead of the Generator API.

```typescript
// Local template — zero credits
import { SmartContractGenerator } from "@chaingpt/smartcontractgenerator";
import { readFileSync } from "fs";
import path from "path";

const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY });

const TEMPLATES: Record<string, string> = {
  erc20: "templates/ERC20Token.sol",
  erc721: "templates/ERC721NFT.sol",
  erc1155: "templates/ERC1155MultiToken.sol",
  vesting: "templates/TokenVesting.sol",
  staking: "templates/StakingPool.sol",
  multisig: "templates/MultiSigWallet.sol",
};

function getTemplate(type: keyof typeof TEMPLATES): string | null {
  const templatePath = TEMPLATES[type];
  if (!templatePath) return null;
  return readFileSync(path.resolve(__dirname, templatePath), "utf-8");
}

// Decision: use template or API?
async function generateContract(description: string): Promise<string> {
  // Check if a standard template covers the request
  const templateType = detectTemplateMatch(description);
  if (templateType) {
    // Free — no API call
    return getTemplate(templateType)!;
  }

  // Complex/custom contract — use the API (1-2 credits)
  const result = await generator.createSmartContractBlob({
    question: description,
    chatHistory: "off",  // "off" unless iterating (saves 1 credit)
  });
  return result.data?.bot ?? "";
}

function detectTemplateMatch(description: string): string | null {
  const lower = description.toLowerCase();
  if (/standard\s+erc-?20|basic\s+token/i.test(lower)) return "erc20";
  if (/erc-?721|nft\s+collection/i.test(lower)) return "erc721";
  if (/erc-?1155|multi-?token/i.test(lower)) return "erc1155";
  if (/vesting|token\s+unlock/i.test(lower)) return "vesting";
  if (/staking|stake\s+pool/i.test(lower)) return "staking";
  if (/multi-?sig|multi-?signature/i.test(lower)) return "multisig";
  return null;
}
```

**When to use each approach:**

| Contract Type | Approach | Cost |
|---------------|----------|------|
| Standard ERC-20/721/1155 | Local template | 0 cr |
| Vesting, staking, multisig | Local template | 0 cr |
| Custom logic, unusual token mechanics | Generator API (no history) | 1 cr |
| Iterative refinement of custom contract | Generator API (with history) | 2 cr/msg |

Always audit generated contracts via the Auditor API (1 credit) before deployment.

---

## 6. Architecture Patterns

### Backend Proxy with Caching Layer

Never call the ChainGPT API directly from the frontend. Route through a backend
proxy that handles caching, deduplication, and rate limiting.

```typescript
import express from "express";
import Redis from "ioredis";
import crypto from "crypto";

const app = express();
const redis = new Redis(process.env.REDIS_URL);

// Request deduplication — prevent duplicate in-flight requests
const inFlight = new Map<string, Promise<unknown>>();

function requestKey(endpoint: string, body: unknown): string {
  return crypto.createHash("sha256")
    .update(`${endpoint}:${JSON.stringify(body)}`)
    .digest("hex");
}

async function deduplicatedRequest<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number
): Promise<T> {
  // Check cache first
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as T;

  // Deduplicate concurrent identical requests
  if (inFlight.has(key)) {
    return inFlight.get(key) as Promise<T>;
  }

  const promise = fn().then(async (result) => {
    await redis.setex(key, ttl, JSON.stringify(result));
    inFlight.delete(key);
    return result;
  }).catch((err) => {
    inFlight.delete(key);
    throw err;
  });

  inFlight.set(key, promise);
  return promise;
}

// Example: proxied chat endpoint
app.post("/api/chat", async (req, res) => {
  const { question } = req.body;
  const key = requestKey("chat", { question });

  const result = await deduplicatedRequest(
    key,
    () => chat.createChatBlob({ question, chatHistory: "off" }),
    3600
  );

  res.json(result);
});
```

### Queue-Based Processing for Batch Operations

For bulk NFT generation or batch audits, use a job queue to control concurrency
and avoid hitting rate limits (200 req/min).

```typescript
import { Nft } from "@chaingpt/nft";
import PQueue from "p-queue";

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY });

// Max 3 concurrent requests, 150 req/min to stay under the 200 limit
const queue = new PQueue({ concurrency: 3, interval: 60_000, intervalCap: 150 });

interface BatchNftJob {
  prompt: string;
  model: string;
}

async function batchGenerateNfts(jobs: BatchNftJob[]) {
  const results = await Promise.allSettled(
    jobs.map((job) =>
      queue.add(() =>
        nft.generateNft({
          prompt: job.prompt,
          model: job.model,
          enhance: 'original',  // skip enhancement to save 0.5 cr each
        })
      )
    )
  );

  return results.map((r, i) => ({
    prompt: jobs[i].prompt,
    status: r.status,
    result: r.status === "fulfilled" ? r.value : null,
    error: r.status === "rejected" ? r.reason : null,
  }));
}
```

---

## 7. Monitoring & Budgeting

### Track Credit Usage Per Endpoint

```typescript
interface UsageRecord {
  endpoint: string;
  credits: number;
  timestamp: Date;
  userId?: string;
}

class CreditTracker {
  private records: UsageRecord[] = [];

  track(endpoint: string, credits: number, userId?: string) {
    this.records.push({
      endpoint,
      credits,
      timestamp: new Date(),
      userId,
    });
  }

  // Daily summary by endpoint
  getDailySummary(): Record<string, { calls: number; credits: number }> {
    const today = new Date().toISOString().split("T")[0];
    const summary: Record<string, { calls: number; credits: number }> = {};

    for (const r of this.records) {
      if (r.timestamp.toISOString().split("T")[0] !== today) continue;
      if (!summary[r.endpoint]) summary[r.endpoint] = { calls: 0, credits: 0 };
      summary[r.endpoint].calls++;
      summary[r.endpoint].credits += r.credits;
    }
    return summary;
  }

  // Per-user quota enforcement
  getUserUsage(userId: string, periodMs = 86400_000): number {
    const cutoff = Date.now() - periodMs;
    return this.records
      .filter((r) => r.userId === userId && r.timestamp.getTime() > cutoff)
      .reduce((sum, r) => sum + r.credits, 0);
  }
}

const tracker = new CreditTracker();

// Middleware: enforce per-user daily quota
function quotaMiddleware(dailyLimit: number) {
  return (req: any, res: any, next: any) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const used = tracker.getUserUsage(userId);
    if (used >= dailyLimit) {
      return res.status(429).json({
        error: "Daily credit quota exceeded",
        used,
        limit: dailyLimit,
        resetsAt: new Date(new Date().setHours(24, 0, 0, 0)),
      });
    }
    next();
  };
}

// Alert when approaching budget threshold
function checkBudgetAlert(monthlyBudget: number) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthUsage = tracker.records
    .filter((r) => r.timestamp >= monthStart)
    .reduce((sum, r) => sum + r.credits, 0);

  const pctUsed = (monthUsage / monthlyBudget) * 100;
  if (pctUsed >= 80) {
    console.warn(`[BUDGET ALERT] ${pctUsed.toFixed(1)}% of monthly budget used`);
    // Send alert via Slack, email, etc.
  }
}
```

**Recommended quotas (starting points):**

| User Tier | Daily Credits | Monthly Credits |
|-----------|---------------|-----------------|
| Free | 50 | 500 |
| Basic | 200 | 5,000 |
| Pro | 1,000 | 25,000 |
| Enterprise | Custom | Custom |

---

## 8. Cost Comparison Table

Monthly cost estimates at different scales, with and without optimization.

### Without Optimization

| Usage Level | Chat (w/ history) | NFTs (Dale3+enhance) | News (10/req) | Contracts (w/ history) | Total Credits | Monthly Cost |
|-------------|-------------------|----------------------|---------------|------------------------|---------------|-------------|
| Starter (1K/mo) | 1,000 cr | 1,425 cr | 100 cr | 200 cr | 2,725 | $27.25 |
| Growth (10K/mo) | 10,000 cr | 14,250 cr | 1,000 cr | 2,000 cr | 27,250 | $272.50 |
| Scale (100K/mo) | 100,000 cr | 142,500 cr | 10,000 cr | 20,000 cr | 272,500 | $2,725.00 |

### With Optimization

| Usage Level | Chat (no history, cached) | NFTs (VeloGen, no enhance) | News (RSS + API) | Contracts (templates + API) | Total Credits | Monthly Cost | Savings |
|-------------|---------------------------|----------------------------|-------------------|-----------------------------|---------------|-------------|---------|
| Starter (1K/mo) | 300 cr | 100 cr | 10 cr | 20 cr | 430 | $4.30 | **84%** |
| Growth (10K/mo) | 3,000 cr | 1,000 cr | 100 cr | 200 cr | 4,300 | $43.00 | **84%** |
| Scale (100K/mo) | 30,000 cr | 10,000 cr | 1,000 cr | 2,000 cr | 43,000 | $430.00 | **84%** |

### Assumptions

- **Chat:** 40% cache hit rate, 80% of queries work without history
- **NFTs:** VeloGen for previews (10 per final), 1 final per batch, no prompt enhancement
- **News:** 90% served from RSS, API only for filtered queries
- **Contracts:** 80% covered by local templates, remaining use no-history mode
- **CGPT bonus:** not included — add 15% savings if paying with $CGPT tokens

### Break-Even: Optimization Effort vs. Savings

| Monthly Spend (Unoptimized) | Annual Savings | Worth Optimizing? |
|-----------------------------|----------------|-------------------|
| < $50 | < $500 | Basic caching only |
| $50 - $500 | $500 - $5,000 | Full caching + RSS + templates |
| > $500 | > $5,000 | All strategies + monitoring |

---

## Quick Reference: Optimization Checklist

- [ ] Default `chatHistory: "off"` for all single-turn queries
- [ ] Implement response cache with per-product TTLs
- [ ] Use RSS feeds for news dashboards, API only for filtered queries
- [ ] Maintain local Solidity templates for standard contracts
- [ ] Use VeloGen for drafts, reserve Dale3 for photorealistic finals
- [ ] Use `enhance: 'original'` when prompts are already detailed
- [ ] Route all API calls through a backend proxy with deduplication
- [ ] Set per-user daily credit quotas
- [ ] Monitor credit spend per endpoint with budget alerts
- [ ] Pay with $CGPT tokens for the 15% bonus
