# Migrating from OpenAI to ChainGPT

A guide for developers currently using OpenAI's API who want to switch to ChainGPT for Web3 and crypto use cases.

---

## Why Migrate

OpenAI's models are general-purpose. For Web3 applications, you need custom tooling to get live on-chain data, token analytics, or wallet intelligence. ChainGPT provides all of this natively:

| Capability | OpenAI | ChainGPT |
|-----------|--------|----------|
| Live on-chain data | Requires custom function calling + RPC provider | Built-in |
| Nansen Smart Money tracking | Not available | Built-in |
| Token price & analytics | Requires external API + function calling | Built-in |
| Wallet intelligence | Not available | Built-in |
| Smart contract generation | Generic code generation | Specialized Solidity generator |
| Smart contract auditing | Basic code review | Dedicated auditor with severity scoring |
| NFT generation + minting | Not available | Full pipeline (generate, enhance, mint) |
| Crypto news aggregation | Not available | AI-curated news API |

**Bottom line:** What takes OpenAI + 3-4 external APIs + custom function definitions, ChainGPT does with a single API call.

---

## Concept Mapping

| OpenAI | ChainGPT | Notes |
|--------|----------|-------|
| `openai.chat.completions.create()` | `generalchat.createChatBlob()` | Single response |
| `stream: true` | `generalchat.createChatStream()` | Streaming response |
| `model: "gpt-4"` | `model: "general_assistant"` | One model for all Web3 queries |
| `model: "gpt-4"` + custom prompt | `model: "smart_contract_generator"` | Dedicated contract generation |
| `model: "gpt-4"` + custom prompt | `model: "smart_contract_auditor"` | Dedicated security auditing |
| `messages: [{role: "user", content: "..."}]` | `question: "..."` | Flat string, not message array |
| System messages | `contextInjection` object | Structured branding/persona config |
| `OPENAI_API_KEY` | `CHAINGPT_API_KEY` | Different env variable |
| Tokens / per-token pricing | Credits / flat rate per request | Simpler cost model |
| Function calling / tools | Not needed | Web3 data is built into the model |

---

## Code Migration

### Basic Chat — Before (OpenAI)

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a crypto market analyst.' },
    { role: 'user', content: 'What is the current ETH price and market sentiment?' }
  ],
  temperature: 0.7,
  max_tokens: 500
});

console.log(response.choices[0].message.content);
```

### Basic Chat — After (ChainGPT)

```javascript
import { GeneralChat } from '@chaingpt/generalchat';

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY });

const response = await chat.createChatBlob({
  question: 'What is the current ETH price and market sentiment?',
  chatHistory: 'off'
});

console.log(response.data.bot);
// Response includes LIVE price data, on-chain metrics, and Smart Money flow
// — no function calling or external APIs needed
```

---

### Streaming — Before (OpenAI)

```javascript
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Analyze Bitcoin market trends' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

### Streaming — After (ChainGPT)

```javascript
const stream = await chat.createChatStream({
  question: 'Analyze Bitcoin market trends',
  chatHistory: 'off'
});

stream.on('data', (chunk) => {
  process.stdout.write(chunk.toString());
});

stream.on('end', () => {
  console.log('\n--- Stream complete ---');
});
```

---

### System Messages vs. Context Injection

OpenAI uses system messages to set persona and constraints. ChainGPT uses a structured `contextInjection` object that provides more control over branding and behavior.

#### Before (OpenAI)

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    {
      role: 'system',
      content: 'You are CryptoBot, the AI assistant for MoonDAO. ' +
        'Only answer questions about MoonDAO and its MOON token. ' +
        'Be friendly and professional. Direct users to moondao.com for more info.'
    },
    { role: 'user', content: 'Tell me about your token' }
  ]
});
```

#### After (ChainGPT)

```javascript
const response = await chat.createChatBlob({
  question: 'Tell me about your token',
  chatHistory: 'off',
  useCustomContext: true,
  contextInjection: {
    companyName: 'MoonDAO',
    companyDescription: 'A decentralized autonomous organization focused on space exploration',
    companyWebsiteUrl: 'https://moondao.com',
    cryptoToken: true,
    tokenInformation: {
      name: 'MoonDAO',
      symbol: 'MOON',
      network: 'Ethereum'
    },
    limitation: true,       // Only answer about this project
    aiTone: 'PRE_SET_TONE',
    selectedTone: 'friendly'
  }
});
```

**Advantages of context injection:**
- Structured data (not free-text prompts that can be jailbroken)
- Built-in token data integration
- Social media and website linking
- Tone presets that are consistently applied
- `limitation: true` restricts responses to the project scope (harder to enforce with system messages)

---

### Chat History

OpenAI requires you to manage message history yourself (passing the full array each time). ChainGPT manages it server-side with session IDs.

#### Before (OpenAI)

```javascript
// You must track and send the full message array
const messages = [
  { role: 'system', content: 'You are a helpful crypto assistant.' }
];

// First message
messages.push({ role: 'user', content: 'What is DeFi?' });
const res1 = await openai.chat.completions.create({ model: 'gpt-4', messages });
messages.push({ role: 'assistant', content: res1.choices[0].message.content });

// Second message — must include all previous messages
messages.push({ role: 'user', content: 'What are the risks?' });
const res2 = await openai.chat.completions.create({ model: 'gpt-4', messages });
// Token count grows with each message...
```

#### After (ChainGPT)

```javascript
const sessionId = 'user-123-session-abc';

// First message
const res1 = await chat.createChatBlob({
  question: 'What is DeFi?',
  chatHistory: 'on',
  sdkUniqueId: sessionId
});

// Second message — server remembers the context
const res2 = await chat.createChatBlob({
  question: 'What are the risks?',
  chatHistory: 'on',
  sdkUniqueId: sessionId
});
// No message array management needed
```

---

## Error Handling Mapping

| OpenAI Error | ChainGPT Equivalent | Notes |
|-------------|---------------------|-------|
| `401 Unauthorized` | `401 UNAUTHORIZED` | Invalid or missing API key |
| `429 Rate limit reached` | `429 RATE_LIMIT` | Too many requests |
| `400 Invalid request` | `400 INVALID_REQUEST` | Malformed parameters |
| `500 Server error` | `500 INTERNAL_ERROR` | Server-side issue |
| `insufficient_quota` | `402 INSUFFICIENT_CREDITS` | Need to top up |
| `context_length_exceeded` | `400 QUESTION_TOO_LONG` | Max 10,000 characters |

```javascript
// ChainGPT error handling
try {
  const res = await chat.createChatBlob({ question: 'Hello', chatHistory: 'off' });
  console.log(res.data.bot);
} catch (error) {
  if (error.status === 402) {
    console.error('Insufficient credits. Top up at https://app.chaingpt.org/addcredits');
  } else if (error.status === 429) {
    console.error('Rate limited. Retrying in 1 second...');
    await new Promise(r => setTimeout(r, 1000));
  } else {
    console.error(`Error ${error.status}: ${error.message}`);
  }
}
```

---

## Pricing Comparison

| Use Case | OpenAI (GPT-4) | ChainGPT | Savings |
|----------|----------------|----------|---------|
| Simple query (~500 tokens) | ~$0.03 | $0.005 (0.5 credits) | 83% |
| Complex analysis (~2000 tokens) | ~$0.12 | $0.005 (0.5 credits) | 96% |
| With chat history (~1000 tokens) | ~$0.06 | $0.01 (1.0 credits) | 83% |
| Smart contract generation | ~$0.15-0.30 | $0.01 (1.0 credits) | 93-97% |
| Contract audit | ~$0.20-0.50 | $0.02 (2.0 credits) | 90-96% |
| **1,000 queries/day (30 days)** | **$900-3,600** | **$150** | **83-96%** |

ChainGPT's flat-rate credit pricing means cost is predictable regardless of response length. No surprises from long responses.

Additional value with ChainGPT:
- **15% credit bonus** when paying with $CGPT tokens
- Credits never expire
- Built-in Web3 data (no need for separate Alchemy/Infura subscriptions for AI queries)

---

## Migration Checklist

1. [ ] Sign up at [app.chaingpt.org](https://app.chaingpt.org) and get an API key
2. [ ] Install the SDK: `npm install @chaingpt/generalchat`
3. [ ] Replace `OPENAI_API_KEY` with `CHAINGPT_API_KEY` in your env
4. [ ] Replace `openai.chat.completions.create()` calls with `chat.createChatBlob()` or `chat.createChatStream()`
5. [ ] Convert system messages to `contextInjection` objects
6. [ ] Replace message array history with `sdkUniqueId` session management
7. [ ] Remove any custom function calling for crypto data (ChainGPT has it built in)
8. [ ] Update error handling to match ChainGPT error codes
9. [ ] Test with the [mock server](../mock-server/) before going live
10. [ ] Monitor credit usage in the dashboard
