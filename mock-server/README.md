# ChainGPT Mock API Server

A local mock server that mimics every ChainGPT API endpoint with realistic responses. Develop and test your integrations without spending credits.

## Why Use This

- **Zero cost** — No API key charges during development
- **Offline development** — Works without internet
- **Realistic data** — Responses match the real API structure exactly
- **Credit logging** — See what each request would cost in production
- **CI/CD friendly** — Run integration tests without API dependencies
- **Fast iteration** — No rate limits, instant responses (100-500ms simulated latency)

## Quick Start

```bash
# Install dependencies
cd mock-server
npm install

# Start in development mode
npm run dev

# Or build and run
npm run build
npm start
```

The server starts on `http://localhost:3001` by default. Set the `PORT` environment variable to change it:

```bash
PORT=4000 npm run dev
```

## Connecting Your App

Point your application to the mock server instead of the production API.

### JavaScript SDK Override

```javascript
import { GeneralChat } from '@chaingpt/generalchat';

const chat = new GeneralChat({
  apiKey: 'mock-key-anything-works',
  configuration: {
    baseUrl: 'http://localhost:3001'  // Mock server
  }
});

// Use exactly as you would with the real API
const res = await chat.createChatBlob({
  question: 'What is the current ETH price?',
  chatHistory: 'off'
});
console.log(res.data.bot);
```

### Python SDK Override

```python
from chaingpt import GeneralChat

chat = GeneralChat(
    api_key="mock-key-anything-works",
    base_url="http://localhost:3001"  # Mock server
)

response = chat.create_chat_blob(
    question="What is the current ETH price?",
    chat_history="off"
)
print(response["data"]["bot"])
```

### Direct HTTP (curl)

```bash
# Chat request
curl -X POST http://localhost:3001/chat/stream \
  -H "Authorization: Bearer any-token-works" \
  -H "Content-Type: application/json" \
  -d '{"model": "general_assistant", "question": "What is Bitcoin?"}'

# NFT generation
curl -X POST http://localhost:3001/nft/generate-image \
  -H "Authorization: Bearer any-token-works" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "cyberpunk cat", "model": "velogen", "height": 512, "width": 512}'

# Crypto news
curl http://localhost:3001/news?limit=5 \
  -H "Authorization: Bearer any-token-works"

# Health check (no auth required... just kidding, auth is global)
curl http://localhost:3001/health \
  -H "Authorization: Bearer any-token-works"
```

## Supported Endpoints

| Method | Path | Product | Mock Credits |
|--------|------|---------|-------------|
| POST | `/chat/stream` | LLM Chatbot (model: general_assistant) | 0.5 |
| POST | `/chat/stream` | Contract Generator (model: smart_contract_generator) | 1.0 |
| POST | `/chat/stream` | Contract Auditor (model: smart_contract_auditor) | 2.0 |
| GET | `/chat/chatHistory` | Chat history retrieval | 0 |
| POST | `/nft/generate-image` | Single image generation | 1.0-4.75 |
| POST | `/nft/generate-multiple-images` | Batch image generation | 1.0/image |
| POST | `/nft/generate-nft-queue` | Async NFT generation | 1.0/image |
| GET | `/nft/progress/:id` | Job progress tracking | 0 |
| POST | `/nft/mint-nft` | NFT minting | 0 |
| POST | `/nft/enhancePrompt` | Prompt enhancement | 0.5 |
| GET | `/nft/get-chains` | Supported chains | 0 |
| GET | `/nft/abi` | Mint factory ABI | 0 |
| GET | `/news` | AI crypto news | 0.1 |
| GET | `/health` | Server health check | 0 |

## Mock Behavior Details

### Chat (`/chat/stream`)
- **general_assistant**: Returns one of 6 varied crypto/blockchain responses (random per request)
- **smart_contract_generator**: Returns a complete ERC-20 contract with OpenZeppelin imports
- **smart_contract_auditor**: Returns a detailed audit report with score 72/100, 10 findings across all severity levels
- **Streaming**: Set `Accept: text/event-stream` header to get Server-Sent Events (words streamed in chunks of 3)

### NFT Generation
- Returns a placeholder PNG byte array (valid but tiny)
- Async queue tracks state: first `/progress` call returns 50%, second returns completed
- Mint returns mock IPFS URIs and metadata

### News
- 10 sample articles covering DeFi, NFTs, Bitcoin, Ethereum, gaming, stablecoins, regulation, and security
- Full filtering support: `categoryId`, `subCategoryId`, `tokenId`
- Pagination via `limit` and `offset`

### Authentication
- Any `Bearer <token>` header is accepted
- Missing or malformed auth returns 401 (matching real API behavior)

## Credit Logging

Every request logs the simulated credit cost to the console:

```
[MOCK] 2026-04-24T10:30:00.000Z POST /chat/stream | model: general_assistant | cost: 0.5 credits | session total: 0.5 credits
[MOCK] 2026-04-24T10:30:01.000Z POST /nft/generate-image | cost: 1 credits | session total: 1.5 credits
[MOCK] 2026-04-24T10:30:02.000Z GET /news | cost: 0.1 credits | session total: 1.6 credits
```

Use this to estimate production costs before deploying.

## Use Cases

- **Local development** — Build features without burning credits
- **Integration tests** — Reliable, deterministic API responses in CI
- **Demos and presentations** — Show API capabilities without a live connection
- **Prototyping** — Quickly test different API products and flows
- **Load testing** — Verify your client handles high throughput (no rate limits on mock)
