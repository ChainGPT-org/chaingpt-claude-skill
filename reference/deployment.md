# Deployment Patterns for ChainGPT-Powered Apps

Production-ready deployment configurations for apps using the ChainGPT SDK and API.

---

## 1. Vercel (Next.js / Serverless)

### vercel.json

```json
{
  "buildCommand": "next build",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "app/api/**/*.ts": {
      "runtime": "nodejs20.x",
      "maxDuration": 60
    }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

### Environment Variables

Set via the Vercel dashboard or CLI:

```bash
vercel env add CHAINGPT_API_KEY production
vercel env add CHAINGPT_API_KEY preview
# For development with mock server:
vercel env add CHAINGPT_BASE_URL development
# Set to http://localhost:3001 in development
```

### Edge vs Node Runtime

The ChainGPT SDK (`@chaingpt/generalchat`, `@chaingpt/smartcontractauditor`, etc.) depends on Node.js built-ins (`http`, `stream`, `buffer`). It **will not** run in the Edge Runtime.

```typescript
// app/api/chat/route.ts
// Must use Node runtime — Edge is NOT compatible with the SDK
export const runtime = "nodejs";
export const maxDuration = 60;
```

### Streaming via Route Handlers

```typescript
// app/api/chat/route.ts
import { NextRequest } from "next/server";
import { GeneralChat } from "@chaingpt/generalchat";

export const runtime = "nodejs";
export const maxDuration = 60;

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

export async function POST(req: NextRequest) {
  const { question, chatHistory = "off" } = await req.json();

  const stream = await chat.createChatStream({ question, chatHistory });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
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

---

## 2. Railway

### railway.json

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm ci && npm run build"
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

### Procfile (Alternative)

```
web: node dist/index.js
```

### Environment Variables

Set in the Railway dashboard under **Variables**:

```bash
CHAINGPT_API_KEY=<your-key>
NODE_ENV=production
PORT=3000
```

Railway auto-injects `PORT`. Do not hardcode it:

```typescript
const PORT = parseInt(process.env.PORT || "3000", 10);
```

### Express Deployment

```typescript
// src/index.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { GeneralChat } from "@chaingpt/generalchat";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json({ limit: "1mb" }));

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { question, chatHistory = "off" } = req.body;
    const response = await chat.createChatBlob({ question, chatHistory });
    res.json({ answer: response.data?.bot });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Fastify Deployment

```typescript
// src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { GeneralChat } from "@chaingpt/generalchat";

const server = Fastify({ logger: true });

await server.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(",") || true });
await server.register(helmet);

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

server.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

server.post<{ Body: { question: string; chatHistory?: string } }>(
  "/api/chat",
  async (request, reply) => {
    const { question, chatHistory = "off" } = request.body;
    const response = await chat.createChatBlob({ question, chatHistory });
    return { answer: response.data?.bot };
  }
);

await server.listen({ port: parseInt(process.env.PORT || "3000", 10), host: "0.0.0.0" });
```

### Auto-Scaling Config

Railway scales via **Replicas** in the service settings. For horizontal scaling, ensure your app is stateless (no in-memory sessions):

```json
{
  "deploy": {
    "numReplicas": 2
  }
}
```

> For session-based chat history (`chatHistory: "on"`), store `sdkUniqueId` in an external store (Redis, database) so any replica can serve follow-up requests.

---

## 3. Docker

### Multi-Stage Dockerfile

```dockerfile
# ── Build Stage ──────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime Stage ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: "3.9"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - CHAINGPT_API_KEY=${CHAINGPT_API_KEY}
      - CHAINGPT_BASE_URL=${CHAINGPT_BASE_URL:-https://api.chaingpt.org}
    depends_on:
      mock-server:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - chaingpt-net

  mock-server:
    build:
      context: ./mock-server
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - chaingpt-net
    profiles:
      - dev

networks:
  chaingpt-net:
    driver: bridge
```

Usage:

```bash
# Production (app only, uses real ChainGPT API)
docker compose up app

# Development (app + mock server)
CHAINGPT_BASE_URL=http://mock-server:3001 docker compose --profile dev up
```

### Health Check Endpoint

```typescript
// src/health.ts
import { Router } from "express";

const health = Router();

let isReady = false;

export function setReady(ready: boolean) {
  isReady = ready;
}

health.get("/health", (_req, res) => {
  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ok" : "starting",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

health.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "alive" });
});

health.get("/health/ready", (_req, res) => {
  res.status(isReady ? 200 : 503).json({ status: isReady ? "ready" : "not_ready" });
});

export default health;
```

### Secret Management

**Option A: Docker Secrets (Swarm / Compose v3.9+)**

```yaml
services:
  app:
    secrets:
      - chaingpt_api_key
    environment:
      - CHAINGPT_API_KEY_FILE=/run/secrets/chaingpt_api_key

secrets:
  chaingpt_api_key:
    file: ./secrets/chaingpt_api_key.txt
```

Read the secret at runtime:

```typescript
import { readFileSync, existsSync } from "fs";

function resolveSecret(envVar: string): string {
  const fileEnv = `${envVar}_FILE`;
  const filePath = process.env[fileEnv];

  if (filePath && existsSync(filePath)) {
    return readFileSync(filePath, "utf-8").trim();
  }

  const value = process.env[envVar];
  if (!value) {
    throw new Error(`Missing secret: set ${envVar} or ${fileEnv}`);
  }
  return value;
}

const apiKey = resolveSecret("CHAINGPT_API_KEY");
```

**Option B: Environment Variables (Simpler)**

```bash
# .env (never commit this file)
CHAINGPT_API_KEY=sk-your-key-here
```

```yaml
services:
  app:
    env_file:
      - .env
```

---

## 4. AWS Lambda

### Serverless Framework Config

```yaml
# serverless.yml
service: chaingpt-api

frameworkVersion: "3"

provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1
  memorySize: 512
  timeout: 30
  environment:
    NODE_ENV: production
    CHAINGPT_API_KEY: ${ssm:/chaingpt/api-key}
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - ssm:GetParameter
          Resource: arn:aws:ssm:${aws:region}:${aws:accountId}:parameter/chaingpt/*

plugins:
  - serverless-esbuild

custom:
  esbuild:
    bundle: true
    minify: true
    target: node20
    platform: node
    external:
      - "@aws-sdk/*"

functions:
  chat:
    handler: src/handlers/chat.handler
    events:
      - httpApi:
          method: POST
          path: /api/chat
    timeout: 30

  audit:
    handler: src/handlers/audit.handler
    events:
      - httpApi:
          method: POST
          path: /api/audit
    timeout: 60
    memorySize: 1024

  health:
    handler: src/handlers/health.handler
    events:
      - httpApi:
          method: GET
          path: /health
```

### Cold Start Considerations

The ChainGPT SDK constructors perform minimal setup, so cold starts are manageable. Keep SDK instances at module scope to reuse them across warm invocations:

```typescript
// src/handlers/chat.ts
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GeneralChat } from "@chaingpt/generalchat";

// Initialize ONCE at module scope — survives across warm invocations
const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { question, chatHistory = "off" } = body;

    const response = await chat.createChatBlob({ question, chatHistory });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: response.data?.bot }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: message }),
    };
  }
};
```

**Provisioned concurrency** eliminates cold starts for latency-sensitive endpoints:

```yaml
functions:
  chat:
    handler: src/handlers/chat.handler
    provisionedConcurrency: 2
```

### API Gateway + Lambda for REST Endpoints

The `httpApi` event type in the Serverless config above creates an HTTP API (API Gateway v2), which is cheaper and faster than REST API (v1). For more control:

```yaml
functions:
  chat:
    handler: src/handlers/chat.handler
    events:
      - httpApi:
          method: POST
          path: /api/chat
          throttle:
            maxRate: 100
            burstLimit: 50
```

### Streaming from Lambda

Standard Lambda responses are buffered. For streaming:

**Option A: Lambda Response Streaming (Recommended)**

```typescript
// src/handlers/chat-stream.ts
import { GeneralChat } from "@chaingpt/generalchat";
import { Writable } from "stream";

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });

// Use awslambda.streamifyResponse (available in Node 18+ Lambda runtime)
export const handler = awslambda.streamifyResponse(
  async (event: any, responseStream: Writable) => {
    const body = JSON.parse(event.body || "{}");
    const { question, chatHistory = "off" } = body;

    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    try {
      const stream = await chat.createChatStream({ question, chatHistory });

      for await (const chunk of stream) {
        const text = chunk.toString();
        responseStream.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }

      responseStream.write("data: [DONE]\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      responseStream.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    } finally {
      responseStream.end();
    }
  }
);
```

Configure with a Function URL instead of API Gateway:

```yaml
functions:
  chatStream:
    handler: src/handlers/chat-stream.handler
    url:
      invokeMode: RESPONSE_STREAM
```

**Option B: WebSocket API**

For bidirectional streaming, use API Gateway WebSocket API. This requires a more complex setup with `$connect`, `$disconnect`, and `sendmessage` routes backed by separate Lambda functions plus a DynamoDB table for connection tracking. Use this only if you need push-from-server beyond the initial request.

---

## 5. Environment Configuration

### .env.example

```bash
# ── ChainGPT API ──────────────────────────────────────────────────────
CHAINGPT_API_KEY=your-api-key-here

# Override base URL (useful for mock server in development)
# CHAINGPT_BASE_URL=http://localhost:3001

# ── Server ────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development

# ── CORS ──────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins (use * for development only)
ALLOWED_ORIGINS=http://localhost:3000

# ── Rate Limiting ─────────────────────────────────────────────────────
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30

# ── Logging ───────────────────────────────────────────────────────────
LOG_LEVEL=info
```

### dotenv Setup

```typescript
// src/config.ts
import { config } from "dotenv";
import { resolve } from "path";

// Load .env files in order of precedence
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env";
config({ path: resolve(process.cwd(), ".env.local") });  // highest precedence
config({ path: resolve(process.cwd(), envFile) });        // env-specific
config({ path: resolve(process.cwd(), ".env") });         // base defaults

export const appConfig = {
  chaingpt: {
    apiKey: requireEnv("CHAINGPT_API_KEY"),
    baseUrl: process.env.CHAINGPT_BASE_URL || "https://api.chaingpt.org",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  },
  cors: {
    origins: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "30", 10),
  },
} as const;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
```

### Production vs Development (Mock Server URL Swap)

The SDK clients accept a base URL override. Use `CHAINGPT_BASE_URL` to swap between production and the mock server:

```typescript
import { GeneralChat } from "@chaingpt/generalchat";

const chat = new GeneralChat({
  apiKey: process.env.CHAINGPT_API_KEY!,
  ...(process.env.CHAINGPT_BASE_URL && {
    configuration: { basePath: process.env.CHAINGPT_BASE_URL },
  }),
});
```

```bash
# Development — uses mock server, no credits consumed
CHAINGPT_API_KEY=mock-key-for-dev
CHAINGPT_BASE_URL=http://localhost:3001

# Production — uses real API
CHAINGPT_API_KEY=sk-your-real-key
# CHAINGPT_BASE_URL is unset, defaults to https://api.chaingpt.org
```

### Secret Manager Integrations

**AWS Systems Manager (SSM) Parameter Store:**

```typescript
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: process.env.AWS_REGION || "us-east-1" });

async function getSecret(name: string): Promise<string> {
  const command = new GetParameterCommand({
    Name: name,
    WithDecryption: true,
  });
  const result = await ssm.send(command);
  return result.Parameter?.Value ?? "";
}

// Usage at app startup
const apiKey = await getSecret("/chaingpt/api-key");
const chat = new GeneralChat({ apiKey });
```

**HashiCorp Vault:**

```typescript
import vault from "node-vault";

const vaultClient = vault({
  apiVersion: "v1",
  endpoint: process.env.VAULT_ADDR || "http://127.0.0.1:8200",
  token: process.env.VAULT_TOKEN,
});

async function getVaultSecret(path: string, key: string): Promise<string> {
  const result = await vaultClient.read(path);
  return result.data.data[key];
}

// Usage at app startup
const apiKey = await getVaultSecret("secret/data/chaingpt", "api_key");
const chat = new GeneralChat({ apiKey });
```

---

## 6. CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Test, Build & Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: "20"

jobs:
  test:
    name: Lint & Test
    runs-on: ubuntu-latest

    services:
      mock-server:
        image: ghcr.io/${{ github.repository }}/mock-server:latest
        ports:
          - 3001:3001
        options: >-
          --health-cmd "wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 3

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type Check
        run: npm run typecheck

      - name: Unit Tests
        run: npm test

      - name: Smoke Test (Mock Server)
        env:
          CHAINGPT_API_KEY: mock-ci-key
          CHAINGPT_BASE_URL: http://localhost:3001
        run: npm run test:smoke

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci
      - run: npm run build

      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7

  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment: production
    concurrency:
      group: deploy-production
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/

      # ── Option A: Deploy to Vercel ───────────────────────────────────
      - name: Deploy to Vercel
        if: vars.DEPLOY_TARGET == 'vercel'
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: "--prod"

      # ── Option B: Deploy to Railway ──────────────────────────────────
      - name: Deploy to Railway
        if: vars.DEPLOY_TARGET == 'railway'
        uses: bervProject/railway-deploy@main
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
          service: ${{ vars.RAILWAY_SERVICE_ID }}

      # ── Option C: Deploy Docker to ECR + ECS ─────────────────────────
      - name: Configure AWS Credentials
        if: vars.DEPLOY_TARGET == 'aws'
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy to AWS
        if: vars.DEPLOY_TARGET == 'aws'
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}
          docker build -t ${{ secrets.ECR_REGISTRY }}/chaingpt-app:${{ github.sha }} .
          docker push ${{ secrets.ECR_REGISTRY }}/chaingpt-app:${{ github.sha }}
          aws ecs update-service --cluster chaingpt --service chaingpt-app --force-new-deployment

  post-deploy:
    name: Post-Deploy Smoke Test
    runs-on: ubuntu-latest
    needs: deploy

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      - name: Smoke Test Production
        env:
          SMOKE_TEST_URL: ${{ vars.PRODUCTION_URL }}
        run: npm run test:smoke:production
```

### Environment Secrets Configuration

Configure the following secrets in your GitHub repository settings (**Settings > Secrets and variables > Actions**):

| Secret | Required For | Description |
|--------|-------------|-------------|
| `CHAINGPT_API_KEY` | All | Production API key |
| `VERCEL_TOKEN` | Vercel | Vercel personal access token |
| `VERCEL_ORG_ID` | Vercel | From `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Vercel | From `.vercel/project.json` |
| `RAILWAY_TOKEN` | Railway | Railway project token |
| `AWS_ACCESS_KEY_ID` | AWS | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | AWS | IAM secret key |
| `ECR_REGISTRY` | AWS | ECR registry URL |

Set `DEPLOY_TARGET` as a **variable** (not secret) to `vercel`, `railway`, or `aws`.

### Smoke Test Script

```typescript
// tests/smoke.ts
import assert from "node:assert/strict";

const BASE_URL = process.env.SMOKE_TEST_URL || process.env.CHAINGPT_BASE_URL || "http://localhost:3001";

async function smoke() {
  console.log(`Running smoke tests against ${BASE_URL}`);

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/health`);
  assert.equal(healthRes.status, 200, "Health endpoint should return 200");
  const health = await healthRes.json();
  assert.equal(health.status, "ok", "Health status should be ok");
  console.log("  [PASS] Health check");

  // 2. Chat endpoint (blob)
  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What is blockchain?" }),
  });
  assert.equal(chatRes.status, 200, "Chat endpoint should return 200");
  const chatData = await chatRes.json();
  assert.ok(chatData.answer, "Response should contain an answer");
  console.log("  [PASS] Chat endpoint");

  console.log("\nAll smoke tests passed.");
}

smoke().catch((err) => {
  console.error("Smoke test failed:", err.message);
  process.exit(1);
});
```

Add to `package.json`:

```json
{
  "scripts": {
    "test:smoke": "tsx tests/smoke.ts",
    "test:smoke:production": "SMOKE_TEST_URL=$SMOKE_TEST_URL tsx tests/smoke.ts"
  }
}
```
