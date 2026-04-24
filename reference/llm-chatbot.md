# ChainGPT Web3 AI Chatbot & LLM — Complete API/SDK Reference

## REST API

### Endpoint

All requests go to a single endpoint:

```
POST https://api.chaingpt.org/chat/stream
```

There is **no** separate `/chat` endpoint. All traffic uses `/chat/stream`.

- For **blob** (non-streaming) responses: send a standard POST request and read the full JSON response.
- For **streaming** responses: send the same POST request and read the response as an HTTP chunked stream.

### Authentication

```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

API keys are generated from the ChainGPT developer dashboard.

---

## Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | — | Must be `"general_assistant"` |
| `question` | string | Yes | — | User prompt (1–10,000 characters) |
| `chatHistory` | string | No | `"off"` | `"on"` or `"off"` |
| `sdkUniqueId` | string | No | — | Session ID for history grouping (1–100 characters) |
| `useCustomContext` | boolean | No | `false` | Enable custom context injection |
| `contextInjection` | object | No | — | Custom context object (requires `useCustomContext: true`) |

---

## Context Injection Fields

All fields are optional. Passed inside the `contextInjection` object.

| Field | Type | Description |
|-------|------|-------------|
| `companyName` | string | Company or project name |
| `companyDescription` | string | Description of the company/project |
| `companyWebsiteUrl` | string (URL) | Website URL |
| `whitePaperUrl` | string (URL) | Whitepaper URL |
| `purpose` | string | Purpose or mission statement |
| `cryptoToken` | boolean | Whether the project has a token |
| `tokenInformation` | object | Token details (see below) |
| `socialMediaUrls` | array | Array of `{ name, url }` objects |
| `limitation` | boolean | Enable response limitations |
| `aiTone` | string | One of: `"DEFAULT_TONE"`, `"CUSTOM_TONE"`, `"PRE_SET_TONE"` |
| `selectedTone` | string | Preset tone value (when `aiTone` is `"PRE_SET_TONE"`) |
| `customTone` | string | Custom tone description (when `aiTone` is `"CUSTOM_TONE"`) |

### Token Information Fields

Passed inside `tokenInformation`:

| Field | Type |
|-------|------|
| `tokenName` | string |
| `tokenSymbol` | string |
| `tokenAddress` | string |
| `tokenSourceCode` | string |
| `tokenAuditUrl` | string (URL) |
| `explorerUrl` | string (URL) |
| `cmcUrl` | string (URL) |
| `coingeckoUrl` | string (URL) |
| `blockchain` | array of blockchain network strings |

---

## Supported Blockchain Network Values

```
ETHEREUM, BSC, ARBITRUM, BASE, BLAST, AVALANCHE, POLYGON, SCROLL, OPTIMISM,
LINEA, ZKSYNC, POLYGON_ZKEVM, GNOSIS, FANTOM, MOONRIVER, MOONBEAM, BOBA,
METIS, LISK, AURORA, SEI, IMMUTABLE_ZK, GRAVITY, TAIKO, CRONOS, FRAXTAL,
ABSTRACT, WORLD_CHAIN, MANTLE, MODE, CELO, BERACHAIN
```

---

## Preset Tone Values

```
PROFESSIONAL, FRIENDLY, INFORMATIVE, FORMAL, CONVERSATIONAL, AUTHORITATIVE,
PLAYFUL, INSPIRATIONAL, CONCISE, EMPATHETIC, ACADEMIC, NEUTRAL,
SARCASTIC_MEME_STYLE
```

---

## Response Format

### Blob (Non-Streaming) Response

Success:

```json
{
  "status": true,
  "message": "...",
  "data": {
    "bot": "<answer>"
  }
}
```

Error:

```json
{
  "status": false,
  "message": "Error description"
}
```

### Streaming Response

Raw text chunks delivered via HTTP chunked transfer encoding. No JSON wrapper — the response body is plain text streamed incrementally.

---

## Pricing

| Feature | Cost |
|---------|------|
| Standard request | 0.5 credits (~$0.005) |
| With chat history enabled | 1.0 credits total (+0.5 for history) |
| Rate limit | 200 requests/minute |

---

## Unique Capabilities

The ChainGPT LLM is purpose-built for Web3 and has access to real-time on-chain and off-chain data sources:

- **Market research & token analysis** — Nansen Smart Money data, Token God Mode analytics
- **Wallet & address intelligence** — balances, DeFi positions, PnL calculations
- **On-chain analytics** — whale tracking, arbitrage detection, trending narratives, transaction tracing
- **Social & sentiment insights** — KOL tracking, community sentiment analysis
- **NFT & ENS intelligence** — collection data, ENS resolution and lookups
- **Regulatory & compliance checks** — token risk scoring, compliance screening
- **Real-time data** — direct blockchain node and indexer connections plus off-chain API integrations
- **Developer utilities** — RPC access, smart contract code generation, live price feeds

---

## cURL Examples

### Blob Request

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "general_assistant",
    "question": "What is the current price of Ethereum?"
  }'
```

### Streaming Request

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --no-buffer \
  -d '{
    "model": "general_assistant",
    "question": "Explain how Uniswap V3 concentrated liquidity works"
  }'
```

### With Chat History

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "general_assistant",
    "question": "What was my previous question about?",
    "chatHistory": "on",
    "sdkUniqueId": "session-abc-123"
  }'
```

### With Context Injection

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "general_assistant",
    "question": "Tell me about our token",
    "useCustomContext": true,
    "contextInjection": {
      "companyName": "MyProject",
      "companyDescription": "A DeFi protocol for cross-chain swaps",
      "cryptoToken": true,
      "tokenInformation": {
        "tokenName": "MyToken",
        "tokenSymbol": "MYT",
        "tokenAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "blockchain": ["ETHEREUM", "BSC"]
      },
      "aiTone": "PRE_SET_TONE",
      "selectedTone": "PROFESSIONAL"
    }
  }'
```

---

## Axios Examples

### Blob Request

```javascript
const axios = require("axios");

const response = await axios.post(
  "https://api.chaingpt.org/chat/stream",
  {
    model: "general_assistant",
    question: "What is the current price of Ethereum?",
  },
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
  }
);

console.log(response.data.data.bot);
```

### Streaming Request

```javascript
const axios = require("axios");

const response = await axios.post(
  "https://api.chaingpt.org/chat/stream",
  {
    model: "general_assistant",
    question: "Explain how Uniswap V3 concentrated liquidity works",
  },
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
    responseType: "stream",
  }
);

response.data.on("data", (chunk) => {
  process.stdout.write(chunk.toString());
});

response.data.on("end", () => {
  console.log("\n[Stream complete]");
});
```

### With Chat History

```javascript
const axios = require("axios");

const response = await axios.post(
  "https://api.chaingpt.org/chat/stream",
  {
    model: "general_assistant",
    question: "Now compare it with Solana",
    chatHistory: "on",
    sdkUniqueId: "session-abc-123",
  },
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
  }
);

console.log(response.data.data.bot);
```

---

## JavaScript SDK (@chaingpt/generalchat)

### Installation

```bash
npm install @chaingpt/generalchat
```

### Initialization

```javascript
const { GeneralChat } = require("@chaingpt/generalchat");

const generalchat = new GeneralChat({
  apiKey: "YOUR_API_KEY",
});
```

### Blob Chat

```javascript
async function blobChat() {
  const response = await generalchat.createChatBlob({
    question: "What is the current price of Ethereum?",
    chatHistory: "off",
  });
  console.log(response.data.bot);
}
```

### Streaming Chat

```javascript
async function streamChat() {
  const stream = await generalchat.createChatStream({
    question: "Explain how Uniswap V3 concentrated liquidity works",
    chatHistory: "off",
  });

  stream.on("data", (chunk) => {
    process.stdout.write(chunk.toString());
  });

  stream.on("end", () => {
    console.log("\n[Stream complete]");
  });
}
```

### Chat with History

```javascript
async function chatWithHistory() {
  const response = await generalchat.createChatBlob({
    question: "What is Ethereum?",
    chatHistory: "on",
    sdkUniqueId: "session-abc-123",
  });
  console.log(response.data.bot);

  // Follow-up — history is maintained via sdkUniqueId
  const followUp = await generalchat.createChatBlob({
    question: "How does its consensus mechanism work?",
    chatHistory: "on",
    sdkUniqueId: "session-abc-123",
  });
  console.log(followUp.data.bot);
}
```

### Get Chat History

```javascript
async function getHistory() {
  const history = await generalchat.getChatHistory({
    limit: 10,
    offset: 0,
    sortBy: "createdAt",
    sortOrder: "DESC",
    sdkUniqueId: "session-abc-123",
  });
  console.log(history);
}
```

### Context Injection

```javascript
const { GeneralChat, AI_TONE, PRE_SET_TONES, BLOCKCHAIN_NETWORK } = require("@chaingpt/generalchat");

const generalchat = new GeneralChat({ apiKey: "YOUR_API_KEY" });

async function chatWithContext() {
  const response = await generalchat.createChatBlob({
    question: "Tell me about our tokenomics",
    chatHistory: "off",
    useCustomContext: true,
    contextInjection: {
      companyName: "MyProject",
      companyDescription: "A DeFi protocol for cross-chain swaps",
      companyWebsiteUrl: "https://myproject.io",
      cryptoToken: true,
      tokenInformation: {
        tokenName: "MyToken",
        tokenSymbol: "MYT",
        tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
        blockchain: [BLOCKCHAIN_NETWORK.ETHEREUM, BLOCKCHAIN_NETWORK.BSC],
      },
      socialMediaUrls: [
        { name: "Twitter", url: "https://twitter.com/myproject" },
        { name: "Discord", url: "https://discord.gg/myproject" },
      ],
      aiTone: AI_TONE.PRE_SET_TONE,
      selectedTone: PRE_SET_TONES.PROFESSIONAL,
    },
  });
  console.log(response.data.bot);
}
```

### Error Handling

```javascript
const { Errors } = require("@chaingpt/generalchat");

try {
  const response = await generalchat.createChatBlob({
    question: "Hello",
  });
} catch (error) {
  if (error instanceof Errors.GeneralChatError) {
    console.error("Chat error:", error.message);
  }
}
```

### Available Enums

```javascript
const { AI_TONE, PRE_SET_TONES, BLOCKCHAIN_NETWORK } = require("@chaingpt/generalchat");

// AI_TONE: DEFAULT_TONE, CUSTOM_TONE, PRE_SET_TONE
// PRE_SET_TONES: PROFESSIONAL, FRIENDLY, INFORMATIVE, FORMAL, CONVERSATIONAL,
//   AUTHORITATIVE, PLAYFUL, INSPIRATIONAL, CONCISE, EMPATHETIC, ACADEMIC,
//   NEUTRAL, SARCASTIC_MEME_STYLE
// BLOCKCHAIN_NETWORK: ETHEREUM, BSC, ARBITRUM, BASE, ... (all supported networks)
```

---

## Python SDK (chaingpt)

### Installation

```bash
pip install chaingpt  # v1.1.3+
```

### Initialization

```python
from chaingpt import ChainGPTClient

# Recommended: use as async context manager
async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    # ... use client
    pass

# Or instantiate directly
client = ChainGPTClient(api_key="YOUR_API_KEY")
```

### Blob Chat

```python
from chaingpt import ChainGPTClient
from chaingpt.models import LLMChatRequestModel
from chaingpt.types import ChatHistoryMode

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    request = LLMChatRequestModel(
        question="What is the current price of Ethereum?",
        chat_history=ChatHistoryMode.OFF,
    )
    response = await client.llm.chat(request)
    print(response.data.bot)
```

### Streaming Chat

```python
from chaingpt import ChainGPTClient
from chaingpt.models import LLMChatRequestModel
from chaingpt.types import ChatHistoryMode

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    request = LLMChatRequestModel(
        question="Explain how Uniswap V3 concentrated liquidity works",
        chat_history=ChatHistoryMode.OFF,
    )
    async for chunk in client.llm.stream_chat(request):
        print(chunk, end="", flush=True)
    print()
```

### Chat with History

```python
from chaingpt import ChainGPTClient
from chaingpt.models import LLMChatRequestModel
from chaingpt.types import ChatHistoryMode

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    request = LLMChatRequestModel(
        question="What is Ethereum?",
        chat_history=ChatHistoryMode.ON,
        sdk_unique_id="session-abc-123",
    )
    response = await client.llm.chat(request)
    print(response.data.bot)

    # Follow-up
    follow_up = LLMChatRequestModel(
        question="How does its consensus mechanism work?",
        chat_history=ChatHistoryMode.ON,
        sdk_unique_id="session-abc-123",
    )
    response2 = await client.llm.chat(follow_up)
    print(response2.data.bot)
```

### Context Injection

```python
from chaingpt import ChainGPTClient
from chaingpt.models import (
    LLMChatRequestModel,
    ContextInjectionModel,
    TokenInformationModel,
    SocialMediaUrlModel,
)
from chaingpt.types import (
    ChatHistoryMode,
    AITone,
    PresetTone,
    BlockchainNetwork,
)

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    context = ContextInjectionModel(
        company_name="MyProject",
        company_description="A DeFi protocol for cross-chain swaps",
        company_website_url="https://myproject.io",
        crypto_token=True,
        token_information=TokenInformationModel(
            token_name="MyToken",
            token_symbol="MYT",
            token_address="0x1234567890abcdef1234567890abcdef12345678",
            blockchain=[BlockchainNetwork.ETHEREUM, BlockchainNetwork.BSC],
        ),
        social_media_urls=[
            SocialMediaUrlModel(name="Twitter", url="https://twitter.com/myproject"),
            SocialMediaUrlModel(name="Discord", url="https://discord.gg/myproject"),
        ],
        ai_tone=AITone.PRE_SET_TONE,
        selected_tone=PresetTone.PROFESSIONAL,
    )

    request = LLMChatRequestModel(
        question="Tell me about our tokenomics",
        chat_history=ChatHistoryMode.OFF,
        use_custom_context=True,
        context_injection=context,
    )
    response = await client.llm.chat(request)
    print(response.data.bot)
```

### Error Handling

```python
from chaingpt import ChainGPTClient
from chaingpt.exceptions import (
    ChainGPTError,
    APIError,
    AuthenticationError,
    ValidationError,
    InsufficientCreditsError,
    RateLimitError,
    NotFoundError,
    ServerError,
    TimeoutError,
    StreamingError,
    ConfigurationError,
)

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    try:
        request = LLMChatRequestModel(question="Hello")
        response = await client.llm.chat(request)
    except AuthenticationError:
        print("Invalid API key")
    except InsufficientCreditsError:
        print("Not enough credits")
    except RateLimitError:
        print("Rate limit exceeded, try again later")
    except ValidationError as e:
        print(f"Invalid request: {e}")
    except StreamingError:
        print("Streaming connection failed")
    except APIError as e:
        print(f"API error: {e}")
    except ChainGPTError as e:
        print(f"General error: {e}")
```

### Available Types

```python
from chaingpt.types import (
    ChatHistoryMode,    # ON, OFF
    AITone,             # DEFAULT_TONE, CUSTOM_TONE, PRE_SET_TONE
    PresetTone,         # PROFESSIONAL, FRIENDLY, INFORMATIVE, FORMAL,
                        # CONVERSATIONAL, AUTHORITATIVE, PLAYFUL, INSPIRATIONAL,
                        # CONCISE, EMPATHETIC, ACADEMIC, NEUTRAL,
                        # SARCASTIC_MEME_STYLE
    BlockchainNetwork,  # ETHEREUM, BSC, ARBITRUM, BASE, ... (all supported)
)
```

---

## Response Examples

### Blob (Non-Streaming) — Success

```json
{
  "status": true,
  "message": "OK",
  "data": {
    "bot": "Ethereum (ETH) is currently trading at approximately **$3,847.52** as of the latest data.\n\n**Key metrics:**\n- Market Cap: $462.3B\n- 24h Volume: $18.7B\n- 24h Change: +2.14%\n- Circulating Supply: 120,186,421 ETH\n\nThe price has been trending upward over the past week, largely driven by increased institutional inflows and positive sentiment around upcoming network upgrades.\n\n*Data sourced from on-chain aggregators and CoinGecko. Prices may vary across exchanges.*"
  }
}
```

### Blob (Non-Streaming) — With Chat History

```json
{
  "status": true,
  "message": "OK",
  "data": {
    "bot": "Based on your previous question about Ethereum, here is a comparison with Solana:\n\n| Feature | Ethereum | Solana |\n|---------|----------|--------|\n| Consensus | Proof of Stake | Proof of History + PoS |\n| TPS | ~30 (L1) | ~4,000 |\n| Avg Block Time | ~12s | ~400ms |\n| TVL | $48.2B | $4.8B |\n| Gas Fees | $2–15 | <$0.01 |\n\nEthereum has a stronger DeFi ecosystem and more battle-tested security, while Solana offers significantly higher throughput and lower fees at the cost of occasional network congestion events."
  }
}
```

### Streaming Response

Streaming responses arrive as raw text chunks via HTTP chunked transfer encoding. Each chunk is a fragment of the answer:

```
Chunk 1: "Uniswap V3 introduced "
Chunk 2: "**concentrated liquidity**, which allows "
Chunk 3: "liquidity providers (LPs) to allocate capital "
Chunk 4: "within custom price ranges rather than across "
Chunk 5: "the entire 0 to infinity curve..."
```

There is no JSON wrapper around streaming chunks. The full text is assembled by concatenating all chunks.

### Error — Invalid API Key

```json
{
  "status": false,
  "message": "Unauthorized: Invalid API key"
}
```

### Error — Insufficient Credits

```json
{
  "status": false,
  "message": "Insufficient credits. Your balance is 0.0 credits. This request requires 0.5 credits."
}
```

### Error — Rate Limit Exceeded

```json
{
  "status": false,
  "message": "Rate limit exceeded. Please retry after 60 seconds."
}
```
