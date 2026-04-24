# Advanced Patterns: Streaming, Rate Limiting, Caching & Error Recovery

Production-ready TypeScript patterns for ChainGPT API integrations.

---

## 1. Streaming Implementation Patterns

### Server-Sent Events (SSE) Proxy — Express

ChainGPT streams via `POST /chat/stream`. Browsers cannot POST to an EventSource, so proxy through your backend:

```typescript
// server/stream-proxy.ts
import express from "express";
import { GeneralChat } from "@chaingpt/generalchat";

const app = express();
app.use(express.json());

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

app.post("/api/chat/stream", async (req, res) => {
  const { question, chatHistory = "off", sessionId } = req.body;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const stream = await chat.createChatStream({
      question,
      chatHistory,
      ...(sessionId && { sdkUniqueId: sessionId }),
    });

    stream.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    });

    stream.on("end", () => {
      res.write(`data: [DONE]\n\n`);
      res.end();
    });

    stream.on("error", (err: Error) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    req.on("close", () => {
      stream.destroy();
    });
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});
```

### SSE Proxy — Fastify

```typescript
// server/stream-proxy-fastify.ts
import Fastify from "fastify";
import { GeneralChat } from "@chaingpt/generalchat";

const fastify = Fastify();
const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

fastify.post("/api/chat/stream", async (request, reply) => {
  const { question, chatHistory = "off", sessionId } = request.body as {
    question: string;
    chatHistory?: string;
    sessionId?: string;
  };

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const stream = await chat.createChatStream({
    question,
    chatHistory,
    ...(sessionId && { sdkUniqueId: sessionId }),
  });

  stream.on("data", (chunk: Buffer) => {
    reply.raw.write(`data: ${JSON.stringify({ content: chunk.toString() })}\n\n`);
  });

  stream.on("end", () => {
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
  });

  request.raw.on("close", () => stream.destroy());
});
```

### Chunk Parsing

ChainGPT's `createChatStream` emits raw `Buffer` chunks. Each chunk is a partial text fragment (not JSON). Accumulate them for the full response:

```typescript
async function collectStream(
  question: string
): Promise<string> {
  const stream = await chat.createChatStream({ question, chatHistory: "off" });
  const chunks: string[] = [];

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });
    stream.on("end", () => resolve(chunks.join("")));
    stream.on("error", reject);
  });
}
```

### React Client — fetch + ReadableStream

```typescript
// hooks/useChainGPTStream.ts
import { useState, useCallback, useRef } from "react";

interface StreamState {
  content: string;
  isStreaming: boolean;
  error: string | null;
}

export function useChainGPTStream() {
  const [state, setState] = useState<StreamState>({
    content: "",
    isStreaming: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (question: string, sessionId?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ content: "", isStreaming: true, error: null });

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, chatHistory: "on", sessionId }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const data = line.replace(/^data: /, "");
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            setState((prev) => ({
              ...prev,
              content: prev.content + parsed.content,
            }));
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setState((prev) => ({ ...prev, error: err.message }));
      }
    } finally {
      setState((prev) => ({ ...prev, isStreaming: false }));
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, send, stop };
}
```

### Next.js App Router — Route Handler with TransformStream

```typescript
// app/api/chat/stream/route.ts
import { GeneralChat } from "@chaingpt/generalchat";

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

export async function POST(req: Request) {
  const { question, chatHistory = "off", sessionId } = await req.json();

  const stream = await chat.createChatStream({
    question,
    chatHistory,
    ...(sessionId && { sdkUniqueId: sessionId }),
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => {
        const payload = `data: ${JSON.stringify({ content: chunk.toString() })}\n\n`;
        controller.enqueue(encoder.encode(payload));
      });

      stream.on("end", () => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      });

      stream.on("error", (err: Error) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        );
        controller.close();
      });
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### Reconnection with Exponential Backoff

```typescript
// lib/resilient-stream.ts
interface ReconnectOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onChunk: (text: string) => void;
  onError?: (error: Error, attempt: number) => void;
  onReconnect?: (attempt: number) => void;
}

export async function resilientStream(
  question: string,
  sessionId: string,
  options: ReconnectOptions
): Promise<void> {
  const {
    maxRetries = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    onChunk,
    onError,
    onReconnect,
  } = options;

  let attempt = 0;
  let accumulated = "";

  while (attempt <= maxRetries) {
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          chatHistory: "on",
          sessionId,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) return; // Completed successfully

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const data = line.replace(/^data: /, "");
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulated += parsed.content;
              onChunk(parsed.content);
            }
          } catch {
            // Skip malformed
          }
        }
      }
    } catch (err: any) {
      attempt++;
      onError?.(err, attempt);

      if (attempt > maxRetries) throw err;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelayMs
      );
      onReconnect?.(attempt);
      await new Promise((r) => setTimeout(r, delay));

      // On reconnect, ask for response again.
      // The chat history (sessionId) retains context, so the LLM
      // can continue from where the user's question was.
    }
  }
}
```

### Buffering for Markdown Rendering

Accumulate chunks before rendering to avoid broken markdown mid-stream:

```typescript
// lib/markdown-buffer.ts
export class MarkdownBuffer {
  private buffer = "";
  private pendingCodeBlock = false;
  private codeBlockCount = 0;

  /** Push a new chunk. Returns the safe-to-render prefix, if any. */
  push(chunk: string): string | null {
    this.buffer += chunk;

    // Count triple-backtick occurrences
    const matches = this.buffer.match(/```/g);
    this.codeBlockCount = matches?.length ?? 0;
    this.pendingCodeBlock = this.codeBlockCount % 2 !== 0;

    // If we are inside an unclosed code block, hold the buffer
    if (this.pendingCodeBlock) {
      return null;
    }

    // Flush everything up to the last complete line
    const lastNewline = this.buffer.lastIndexOf("\n");
    if (lastNewline === -1) return null;

    const safe = this.buffer.slice(0, lastNewline + 1);
    this.buffer = this.buffer.slice(lastNewline + 1);
    return safe;
  }

  /** Flush remaining buffer (call on stream end). */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }
}
```

---

## 2. Rate Limiting & Retry Patterns

ChainGPT enforces **200 requests per minute per API key** across all products. Exceeding this returns HTTP 429.

### Token Bucket Rate Limiter

```typescript
// lib/rate-limiter.ts
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 200,
    private readonly refillIntervalMs: number = 60_000
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(
      (elapsed / this.refillIntervalMs) * this.maxTokens
    );
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    // Wait until a token is available
    const waitMs =
      ((1 / this.maxTokens) * this.refillIntervalMs) + 50; // small buffer
    await new Promise((r) => setTimeout(r, waitMs));
    return this.acquire();
  }

  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// Usage
const limiter = new TokenBucketRateLimiter(200, 60_000);

async function rateLimitedRequest(question: string) {
  await limiter.acquire();
  return chat.createChatBlob({ question, chatHistory: "off" });
}
```

### 429 Handling with Exponential Backoff + Jitter

```typescript
// lib/retry.ts
interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 1000, maxDelayMs = 60_000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) throw err;

      // Parse Retry-After header if available
      const retryAfter = err?.headers?.["retry-after"];
      let delayMs: number;

      if (retryAfter) {
        delayMs = parseInt(retryAfter, 10) * 1000;
      } else {
        // Exponential backoff with full jitter
        const exponential = baseDelayMs * Math.pow(2, attempt);
        delayMs = Math.random() * Math.min(exponential, maxDelayMs);
      }

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error("Unreachable");
}

// Usage
const response = await withRetry(
  () => chat.createChatBlob({ question: "What is DeFi?", chatHistory: "off" }),
  { maxRetries: 3, baseDelayMs: 2000 }
);
```

### Queue-Based Approach for Batch Operations

Use a promise queue when you need to process many requests (e.g., generating 100 NFT images) without exceeding the rate limit:

```typescript
// lib/request-queue.ts
export class RequestQueue<T> {
  private queue: Array<{
    fn: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];
  private running = 0;

  constructor(
    private readonly concurrency: number = 10,
    private readonly delayBetweenMs: number = 300 // ~200/min
  ) {}

  enqueue(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    this.running++;
    const { fn, resolve, reject } = this.queue.shift()!;

    try {
      const result = await fn();
      resolve(result);
    } catch (err: any) {
      reject(err);
    } finally {
      this.running--;
      if (this.delayBetweenMs > 0) {
        await new Promise((r) => setTimeout(r, this.delayBetweenMs));
      }
      this.processNext();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

// Usage: batch NFT generation
import { Nft } from "@chaingpt/nft";

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY! });
const queue = new RequestQueue(5, 350); // 5 concurrent, 350ms gap

const prompts = Array.from({ length: 100 }, (_, i) => `Cyberpunk cat #${i + 1}`);

const results = await Promise.all(
  prompts.map((prompt) =>
    queue.enqueue(() =>
      nft.generateNft({ prompt, model: "velogen" })
    )
  )
);
```

### Multi-Key Rotation for High-Throughput Apps

When 200 req/min per key is insufficient, rotate across multiple API keys:

```typescript
// lib/key-rotator.ts
export class ApiKeyRotator {
  private index = 0;
  private readonly counters: Map<string, { count: number; resetAt: number }> =
    new Map();

  constructor(private readonly keys: string[]) {
    if (keys.length === 0) throw new Error("At least one API key required");
  }

  /** Get the next available API key, respecting per-key rate limits. */
  getKey(): string {
    const now = Date.now();

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.index + i) % this.keys.length;
      const key = this.keys[idx];
      const counter = this.counters.get(key);

      if (!counter || now >= counter.resetAt) {
        this.counters.set(key, { count: 1, resetAt: now + 60_000 });
        this.index = (idx + 1) % this.keys.length;
        return key;
      }

      if (counter.count < 190) {
        // 190 to leave headroom
        counter.count++;
        this.index = (idx + 1) % this.keys.length;
        return key;
      }
    }

    throw new Error("All API keys exhausted. Wait for rate limit reset.");
  }

  /** Total effective rate: keys.length * 200 req/min. */
  get effectiveRateLimit(): number {
    return this.keys.length * 200;
  }
}

// Usage
const rotator = new ApiKeyRotator([
  process.env.CHAINGPT_KEY_1!,
  process.env.CHAINGPT_KEY_2!,
  process.env.CHAINGPT_KEY_3!,
]);

// Effective limit: 600 req/min
async function highThroughputRequest(question: string) {
  const key = rotator.getKey();
  const client = new GeneralChat({ apiKey: key });
  return client.createChatBlob({ question, chatHistory: "off" });
}
```

---

## 3. Caching Patterns

### Response Cache with TTL

```typescript
// lib/cache.ts
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly defaultTtlMs: number = 300_000) {
    // Cleanup expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}
```

### Cached ChainGPT Client Wrapper

```typescript
// lib/cached-client.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { AINews } from "@chaingpt/ainews";
import { TTLCache } from "./cache";
import crypto from "crypto";

function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}:${hash}`;
}

export class CachedChainGPT {
  private cache: TTLCache<unknown>;
  private chat: GeneralChat;
  private news: AINews;

  constructor(apiKey: string) {
    this.cache = new TTLCache(300_000); // 5 min default
    this.chat = new GeneralChat({ apiKey });
    this.news = new AINews({ apiKey });
  }

  /**
   * Cached chat — only caches blob responses with chatHistory: "off".
   * Streaming and history-enabled chats are never cached.
   */
  async chatBlob(question: string): Promise<string> {
    const key = cacheKey("chat", { question });
    const cached = this.cache.get(key) as string | undefined;
    if (cached) return cached;

    const res = await this.chat.createChatBlob({
      question,
      chatHistory: "off",
    });
    const answer = res.data.bot;
    this.cache.set(key, answer, 600_000); // Cache LLM responses 10 min
    return answer;
  }

  /** Cached news — news changes infrequently, cache 15 minutes. */
  async getNews(categoryId?: number) {
    const key = cacheKey("news", { categoryId });
    const cached = this.cache.get(key);
    if (cached) return cached;

    const res = await this.news.getNews(
      categoryId ? { categoryId } : undefined
    );
    this.cache.set(key, res, 900_000); // 15 min
    return res;
  }
}
```

### Redis Cache Layer

```typescript
// lib/redis-cache.ts
import { createClient, type RedisClientType } from "redis";

export class RedisCache {
  private client: RedisClientType;

  constructor(url: string = "redis://localhost:6379") {
    this.client = createClient({ url });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) await this.client.del(keys);
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}

// Usage with ChainGPT
const redis = new RedisCache(process.env.REDIS_URL);
await redis.connect();

async function cachedNews(categoryId: number) {
  const cacheKey = `chaingpt:news:${categoryId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const news = new AINews({ apiKey: process.env.CHAINGPT_API_KEY! });
  const result = await news.getNews({ categoryId });

  await redis.set(cacheKey, result, 900); // 15 min TTL
  return result;
}
```

### CDN Caching for NFT Images

```typescript
// app/api/nft/[id]/route.ts — Next.js Route Handler
import { Nft } from "@chaingpt/nft";

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY! });

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const imageUrl = await fetchNftImageUrl(params.id); // your DB lookup

  // Proxy the image with aggressive cache headers
  const imageRes = await fetch(imageUrl);
  const imageBuffer = await imageRes.arrayBuffer();

  return new Response(imageBuffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable", // 1 year
      "CDN-Cache-Control": "public, max-age=31536000",
      ETag: `"nft-${params.id}"`,
    },
  });
}

// Vercel/Cloudflare will cache at the edge automatically with these headers.
```

---

## 4. Error Recovery Patterns

### Circuit Breaker

Stop calling the API after repeated failures. Automatically recover after a cooldown:

```typescript
// lib/circuit-breaker.ts
type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeMs: number = 30_000,
    private readonly halfOpenMaxAttempts: number = 3
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeMs) {
        this.state = "half-open";
        this.successCount = 0;
      } else {
        throw new CircuitOpenError(
          `Circuit open. Retry after ${this.msUntilRetry()}ms`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = "closed";
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open" || this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  private msUntilRetry(): number {
    return Math.max(
      0,
      this.recoveryTimeMs - (Date.now() - this.lastFailureTime)
    );
  }

  get currentState(): CircuitState {
    return this.state;
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

// Usage
const breaker = new CircuitBreaker(5, 30_000);

async function safeChat(question: string) {
  return breaker.execute(() =>
    chat.createChatBlob({ question, chatHistory: "off" })
  );
}
```

### Fallback Chains

Try the primary path, fall back to alternatives, then degrade gracefully:

```typescript
// lib/fallback.ts
type FallbackFn<T> = () => Promise<T>;

export async function withFallback<T>(
  strategies: Array<{ name: string; fn: FallbackFn<T> }>,
  onFallback?: (name: string, error: Error) => void
): Promise<T> {
  let lastError: Error | undefined;

  for (const strategy of strategies) {
    try {
      return await strategy.fn();
    } catch (err: any) {
      lastError = err;
      onFallback?.(strategy.name, err);
    }
  }

  throw lastError ?? new Error("All fallback strategies exhausted");
}

// Usage: chat with graceful degradation
async function resilientChat(question: string): Promise<string> {
  return withFallback(
    [
      {
        name: "primary",
        fn: async () => {
          const res = await chat.createChatBlob({
            question,
            chatHistory: "on",
          });
          return res.data.bot;
        },
      },
      {
        name: "no-history",
        fn: async () => {
          // Disable history if primary fails (reduces load)
          const res = await chat.createChatBlob({
            question,
            chatHistory: "off",
          });
          return res.data.bot;
        },
      },
      {
        name: "cached",
        fn: async () => {
          // Return a cached response if available
          const cached = await redis.get<string>(`chaingpt:chat:${question}`);
          if (!cached) throw new Error("No cache hit");
          return cached;
        },
      },
      {
        name: "degraded",
        fn: async () => {
          return "I'm temporarily unable to process your request. Please try again in a moment.";
        },
      },
    ],
    (name, error) => {
      console.warn(`Fallback: "${name}" failed — ${error.message}`);
    }
  );
}
```

### Idempotent NFT Minting

NFT minting involves on-chain transactions. Use the `collectionId` as an idempotency key to prevent duplicate mints on retry:

```typescript
// lib/idempotent-mint.ts
import { Nft } from "@chaingpt/nft";

interface MintRecord {
  collectionId: string;
  transactionHash?: string;
  status: "pending" | "minted" | "failed";
  attempts: number;
  lastAttempt: number;
}

export class IdempotentMinter {
  private records = new Map<string, MintRecord>();

  constructor(private readonly nft: Nft) {}

  /**
   * Mint an NFT idempotently. If a mint with the same collectionId
   * is already in progress or completed, return the existing result.
   */
  async mint(params: {
    collectionId: string;
    name: string;
    description: string;
    prompt: string;
    walletAddress: string;
    chainId: string;
  }): Promise<MintRecord> {
    const { collectionId } = params;

    // Check for existing record
    const existing = this.records.get(collectionId);
    if (existing?.status === "minted") {
      return existing; // Already minted — no-op
    }
    if (existing?.status === "pending") {
      throw new Error(`Mint ${collectionId} already in progress`);
    }

    // Mark as pending
    const record: MintRecord = {
      collectionId,
      status: "pending",
      attempts: (existing?.attempts ?? 0) + 1,
      lastAttempt: Date.now(),
    };
    this.records.set(collectionId, record);

    try {
      // Step 1: Generate image via queue (async)
      const queued = await this.nft.generateNftWithQueue({
        prompt: params.prompt,
        model: "velogen",
        walletAddress: params.walletAddress,
        chainId: params.chainId,
      });

      // Step 2: Poll progress until generation is complete
      let progress = await this.nft.getNftProgress(queued.data.id);
      while (progress.data.status !== "completed") {
        await new Promise((r) => setTimeout(r, 3000));
        progress = await this.nft.getNftProgress(queued.data.id);
        if (progress.data.status === "failed") {
          throw new Error("NFT generation failed");
        }
      }

      // Step 3: Mint on-chain with correct parameters
      const minted = await this.nft.mintNft({
        collectionId: params.collectionId,
        name: params.name,
        description: params.description,
        ids: [queued.data.id],
      });

      record.status = "minted";
      record.transactionHash = minted.data?.transactionHash;
      return record;
    } catch (err) {
      record.status = "failed";
      throw err;
    }
  }

  getRecord(collectionId: string): MintRecord | undefined {
    return this.records.get(collectionId);
  }
}

// Usage
const minter = new IdempotentMinter(
  new Nft({ apiKey: process.env.CHAINGPT_API_KEY! })
);

// Safe to retry — won't double-mint
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const result = await minter.mint({
      collectionId: "collection-abc-123",
      name: "Cyberpunk Warrior #1",
      description: "A cyberpunk warrior with neon armor",
      prompt: "Cyberpunk warrior with neon armor",
      walletAddress: "0x1234...abcd",
      chainId: "binance",
    });
    console.log("Minted:", result.transactionHash);
    break;
  } catch (err) {
    console.warn(`Attempt ${attempt + 1} failed, retrying...`);
  }
}
```

---

## Combining Patterns

A production integration typically layers these patterns together:

```typescript
// lib/chaingpt-client.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { TokenBucketRateLimiter } from "./rate-limiter";
import { CircuitBreaker } from "./circuit-breaker";
import { withRetry } from "./retry";
import { TTLCache } from "./cache";

export function createResilientClient(apiKey: string) {
  const chat = new GeneralChat({ apiKey });
  const limiter = new TokenBucketRateLimiter(200, 60_000);
  const breaker = new CircuitBreaker(5, 30_000);
  const cache = new TTLCache<string>(600_000);

  return {
    async ask(question: string): Promise<string> {
      // 1. Check cache
      const cached = cache.get(question);
      if (cached) return cached;

      // 2. Rate limit
      await limiter.acquire();

      // 3. Circuit breaker + retry
      const answer = await breaker.execute(() =>
        withRetry(
          async () => {
            const res = await chat.createChatBlob({
              question,
              chatHistory: "off",
            });
            return res.data.bot;
          },
          { maxRetries: 3 }
        )
      );

      // 4. Cache result
      cache.set(question, answer);
      return answer;
    },
  };
}
```

---

## Quick Reference

| Pattern | When to Use | Key Config |
|---------|-------------|------------|
| SSE Proxy | Browser streaming | Express/Fastify middleware |
| Token Bucket | Client-side rate limiting | 200 tokens / 60s |
| Retry + Backoff | 429 and 5xx errors | base 1s, max 60s, jitter |
| Request Queue | Batch operations (NFTs) | concurrency 5-10, 300ms gap |
| Key Rotation | >200 req/min throughput | N keys = N * 200 req/min |
| TTL Cache | Repeated identical queries | 5-15 min for news, 10 min for chat |
| Circuit Breaker | Cascading failure prevention | 5 failures, 30s recovery |
| Fallback Chain | High-availability requirements | primary -> degraded -> static |
| Idempotent Mint | NFT minting retries | collectionId as idempotency key |
