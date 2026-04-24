# Web3 AI Chatbot Application Template

Instructions for Claude to scaffold a complete Web3 AI chatbot application using the ChainGPT General Chat SDK.

---

## What to Generate

### Project Structure

```
chaingpt-chatbot/
├── package.json
├── .env.example
├── tsconfig.json
├── src/
│   ├── index.ts          # Express server with /chat endpoint
│   ├── chatService.ts    # ChainGPT SDK wrapper with streaming
│   └── types.ts          # TypeScript interfaces
└── README.md
```

### Dependencies

**Production:**
- `@chaingpt/generalchat` — ChainGPT LLM SDK
- `express` — HTTP server
- `dotenv` — environment variable loading
- `cors` — cross-origin support

**Dev:**
- `typescript`
- `ts-node`
- `@types/express`
- `@types/cors`
- `nodemon`

### package.json scripts

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Key Implementation Details

### 1. src/index.ts — Express Server

Create an Express server with these routes:

- **POST /chat** — accepts `{ question, sessionId? }` body, returns blob response
- **POST /chat/stream** — accepts `{ question, sessionId? }`, returns SSE streaming response
- **GET /health** — returns `{ status: "ok", timestamp }`

Configuration:
- CORS enabled for all origins (configurable via `ALLOWED_ORIGINS` env)
- JSON body parser with 10kb limit
- Port from `PORT` env variable or default 3000
- Graceful error handling middleware that catches ChainGPT-specific errors

SSE streaming endpoint must:
- Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Write `data: <chunk>\n\n` for each stream chunk
- Write `data: [DONE]\n\n` when stream ends
- Handle client disconnect (req.on('close'))

### 2. src/chatService.ts — ChainGPT Wrapper

Initialize the SDK and expose two methods:

```typescript
import { GeneralChat } from "@chaingpt/generalchat";

// Initialize with API key from environment
const generalChat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
```

**chat(question: string, sessionId?: string): Promise\<string\>**
- Call the SDK blob method
- Pass `chatHistory: "on"` and `sdkUniqueId: sessionId` when sessionId is provided
- If `COMPANY_NAME` env is set, include context injection:
  ```typescript
  useCustomContext: true,
  contextInjection: {
    companyName: process.env.COMPANY_NAME,
    companyDescription: process.env.COMPANY_DESCRIPTION,
  }
  ```
- Return `response.data.bot`

**chatStream(question: string, sessionId?: string): Promise\<ReadableStream\>**
- Same parameters as above but call the streaming method
- Return the raw stream for the route handler to pipe

**Error handling:**
- Import `Errors` from `@chaingpt/generalchat`
- Catch and re-throw with descriptive messages for:
  - `Errors.GeneralChatError` — API-level errors
  - Network errors — timeout, connection refused
  - Missing API key — throw immediately on init

### 3. src/types.ts — Interfaces

```typescript
export interface ChatRequest {
  question: string;
  sessionId?: string;
}

export interface ChatResponse {
  answer: string;
  sessionId?: string;
  timestamp: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface ErrorResponse {
  error: string;
  code: string;
  timestamp: string;
}
```

### 4. .env.example

```
CHAINGPT_API_KEY=your_api_key_here
PORT=3000
ALLOWED_ORIGINS=*
COMPANY_NAME=
COMPANY_DESCRIPTION=
```

### 5. README.md

Include:
- Project description (one paragraph)
- Prerequisites (Node.js 18+, ChainGPT API key from app.chaingpt.org)
- Setup instructions
- API endpoint documentation with curl examples
- Credit costs: 0.5 credits per request, +0.5 if chatHistory enabled
- Link to ChainGPT docs

---

## Usage Instructions

```bash
npm install
cp .env.example .env  # Add your ChainGPT API key
npm run dev
```

Test blob response:
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What is DeFi?"}'
```

Test streaming:
```bash
curl -N -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain how Uniswap V3 concentrated liquidity works"}'
```

Test with session (chat history):
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What is staking?", "sessionId": "user-123"}'
```

---

## SDK Reference Notes

- The SDK model is `"general_assistant"` — this is set internally by the `@chaingpt/generalchat` package
- All requests go to `POST https://api.chaingpt.org/chat/stream` under the hood
- Streaming responses are plain text chunks (no JSON wrapper)
- Blob responses return `{ status: true, data: { bot: "<answer>" } }`
- Rate limit: 200 requests/minute
- The LLM has built-in Web3 knowledge: real-time market data, wallet analytics, on-chain data, NFT/ENS lookups
