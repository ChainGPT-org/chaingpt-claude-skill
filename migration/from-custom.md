# Migrating from Custom AI Solutions to ChainGPT

A guide for teams running their own fine-tuned models, custom NLP pipelines, or self-hosted LLMs for crypto and Web3 use cases.

---

## Why Switch from Self-Hosted to Managed API

Running your own AI infrastructure for Web3 is expensive and operationally complex. Here is what it actually costs:

### Cost Reality Check

| Cost Category | Self-Hosted (Typical) | ChainGPT API |
|--------------|----------------------|-------------|
| GPU hosting (A100/H100) | $2,000-8,000/mo | $0 |
| Training data pipeline | $500-2,000/mo (engineers + data) | $0 (ChainGPT maintains) |
| On-chain data integration | $200-500/mo (RPC providers) | Built-in |
| Model fine-tuning | $1,000-5,000 per training run | $0 |
| MLOps / monitoring | $300-800/mo (tools + engineer time) | $0 |
| Redundancy / failover | 2x GPU cost for HA | Built-in |
| **Monthly total** | **$4,000-16,300/mo** | **$50-200/mo** |

**Break-even analysis:** ChainGPT API becomes more cost-effective for any application doing fewer than ~500,000 requests per month. Most Web3 applications fall well below this threshold.

### Operational Advantages

- **Always current data:** ChainGPT's model ingests live on-chain data, Nansen Smart Money feeds, and real-time market data. Self-hosted models go stale the moment you stop retraining.
- **No GPU management:** No CUDA driver updates, no OOM errors, no spot instance interruptions, no GPU shortage procurement delays.
- **No training pipeline:** Token analytics, wallet labels, protocol mappings, and chain data are maintained by ChainGPT's team.
- **Instant scaling:** API handles traffic spikes automatically. No capacity planning.
- **Multi-product:** One API key gives you chatbot, contract generation, auditing, NFT generation, and news. Building all of these in-house would require multiple specialized models.

---

## Mapping Custom Endpoints to ChainGPT

If you have built custom API endpoints for your AI, here is how they map to ChainGPT:

### Chat / Query Endpoint

**Your custom endpoint:**
```javascript
// Typical self-hosted pattern
app.post('/api/ai/query', async (req, res) => {
  const { prompt, context, userId } = req.body;
  
  // Load model
  const model = await loadModel('./models/crypto-llm-v3');
  
  // Build context from your data pipeline
  const enrichedContext = await fetchOnChainData(prompt);
  const formattedPrompt = buildPrompt(prompt, enrichedContext, context);
  
  // Inference
  const result = await model.generate(formattedPrompt, {
    maxTokens: 1024,
    temperature: 0.7
  });
  
  res.json({ response: result.text });
});
```

**ChainGPT replacement:**
```javascript
import { GeneralChat } from '@chaingpt/generalchat';

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY });

app.post('/api/ai/query', async (req, res) => {
  const { prompt, userId } = req.body;
  
  const result = await chat.createChatBlob({
    question: prompt,
    chatHistory: 'on',
    sdkUniqueId: `user-${userId}`
    // On-chain data enrichment happens automatically
  });
  
  res.json({ response: result.data.bot });
});
```

### Contract Analysis Endpoint

**Your custom endpoint:**
```javascript
app.post('/api/ai/analyze-contract', async (req, res) => {
  const { sourceCode } = req.body;
  
  // Custom vulnerability scanner
  const staticAnalysis = await runSlither(sourceCode);
  const aiAnalysis = await model.generate(
    `Analyze this Solidity contract:\n${sourceCode}\n\nStatic analysis found:\n${staticAnalysis}`
  );
  
  res.json({ analysis: aiAnalysis.text, staticFindings: staticAnalysis });
});
```

**ChainGPT replacement:**
```javascript
app.post('/api/ai/analyze-contract', async (req, res) => {
  const { sourceCode } = req.body;
  
  const result = await chat.createChatBlob({
    question: `Audit this contract for vulnerabilities:\n\n${sourceCode}`,
    model: 'smart_contract_auditor',
    chatHistory: 'off'
  });
  
  res.json({ analysis: result.data.bot });
  // Returns scored report with Critical/High/Medium/Low findings
});
```

### Image Generation Endpoint

**Your custom endpoint:**
```javascript
app.post('/api/ai/generate-nft', async (req, res) => {
  const { prompt } = req.body;
  
  // Self-hosted Stable Diffusion
  const result = await stableDiffusion.generate({
    prompt,
    steps: 25,
    width: 512,
    height: 512,
    scheduler: 'euler_a'
  });
  
  res.json({ image: result.buffer });
});
```

**ChainGPT replacement:**
```javascript
import { NFTAI } from '@chaingpt/nftai';

const nft = new NFTAI({ apiKey: process.env.CHAINGPT_API_KEY });

app.post('/api/ai/generate-nft', async (req, res) => {
  const { prompt } = req.body;
  
  const result = await nft.generateImage({
    prompt,
    model: 'velogen',  // or nebula_forge_xl, VisionaryForge, Dale3
    height: 512,
    width: 512
  });
  
  res.json({ image: result.data });
  // Plus: prompt enhancement, batch generation, on-chain minting — all built in
});
```

---

## SDK Integration Pattern: Drop-In Service Layer

The cleanest migration pattern is to create an abstraction layer that you can swap implementations behind.

### Step 1: Define Your Interface

```typescript
// services/ai-service.ts
export interface AIService {
  chat(prompt: string, sessionId?: string): Promise<string>;
  generateContract(description: string): Promise<string>;
  auditContract(sourceCode: string): Promise<string>;
  generateImage(prompt: string, options?: ImageOptions): Promise<Buffer>;
}

export interface ImageOptions {
  width?: number;
  height?: number;
  model?: string;
}
```

### Step 2: Implement with ChainGPT

```typescript
// services/chaingpt-service.ts
import { GeneralChat } from '@chaingpt/generalchat';
import { NFTAI } from '@chaingpt/nftai';
import { AIService, ImageOptions } from './ai-service';

export class ChainGPTService implements AIService {
  private chat: GeneralChat;
  private nft: NFTAI;

  constructor(apiKey: string) {
    this.chat = new GeneralChat({ apiKey });
    this.nft = new NFTAI({ apiKey });
  }

  async chat(prompt: string, sessionId?: string): Promise<string> {
    const res = await this.chat.createChatBlob({
      question: prompt,
      chatHistory: sessionId ? 'on' : 'off',
      sdkUniqueId: sessionId
    });
    return res.data.bot;
  }

  async generateContract(description: string): Promise<string> {
    const res = await this.chat.createChatBlob({
      question: description,
      model: 'smart_contract_generator',
      chatHistory: 'off'
    });
    return res.data.bot;
  }

  async auditContract(sourceCode: string): Promise<string> {
    const res = await this.chat.createChatBlob({
      question: `Audit this contract:\n\n${sourceCode}`,
      model: 'smart_contract_auditor',
      chatHistory: 'off'
    });
    return res.data.bot;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<Buffer> {
    const res = await this.nft.generateImage({
      prompt,
      model: options?.model || 'velogen',
      height: options?.height || 512,
      width: options?.width || 512
    });
    return Buffer.from(res.data);
  }
}
```

### Step 3: Swap in Your Application

```typescript
// Before
import { CustomAIService } from './services/custom-ai-service';
const ai = new CustomAIService({ modelPath: './models/v3', gpuId: 0 });

// After
import { ChainGPTService } from './services/chaingpt-service';
const ai = new ChainGPTService(process.env.CHAINGPT_API_KEY!);

// All existing code continues to work
const answer = await ai.chat('What is the TVL of Aave?');
const contract = await ai.generateContract('ERC-20 with vesting schedule');
const audit = await ai.auditContract(contractSource);
```

---

## Hybrid Approach

You do not need to migrate everything. A common pattern is to use ChainGPT for Web3-specific queries while keeping your custom model for domain-specific tasks.

```typescript
class HybridAIService implements AIService {
  private chaingpt: ChainGPTService;
  private custom: CustomAIService;

  async chat(prompt: string, sessionId?: string): Promise<string> {
    // Route Web3 queries to ChainGPT
    if (this.isWeb3Query(prompt)) {
      return this.chaingpt.chat(prompt, sessionId);
    }
    // Route domain-specific queries to custom model
    return this.custom.chat(prompt, sessionId);
  }

  private isWeb3Query(prompt: string): boolean {
    const web3Keywords = [
      'blockchain', 'token', 'wallet', 'defi', 'nft', 'smart contract',
      'ethereum', 'bitcoin', 'solidity', 'gas fee', 'staking', 'yield',
      'liquidity', 'swap', 'bridge', 'airdrop', 'dao', 'dapp',
      'on-chain', 'tvl', 'market cap', 'trading volume'
    ];
    const lower = prompt.toLowerCase();
    return web3Keywords.some(kw => lower.includes(kw));
  }
}
```

**When to keep your custom model:**
- Proprietary data that cannot leave your infrastructure
- Highly specialized non-crypto domain (e.g., medical, legal)
- Regulatory requirement for on-premise processing
- Sub-10ms latency requirements (ChainGPT adds network round-trip)

**When to use ChainGPT instead:**
- Any crypto/blockchain/Web3 question or analysis
- Smart contract generation or auditing
- NFT artwork generation
- Market news and sentiment
- Wallet or token analysis

---

## Data Privacy

A common concern when moving from self-hosted to a managed API:

- **ChainGPT does NOT train on your data.** Your API queries are not used to improve the model.
- **No query logging for training.** Requests are processed and responses returned; your prompts are not stored for model training purposes.
- **Chat history is per-session.** When `chatHistory: 'off'`, no conversation data is retained.
- **API keys are scoped.** Each key has its own credit balance and usage tracking, isolated from other users.

For compliance-sensitive applications (e.g., handling wallet addresses that could be PII under certain jurisdictions), consult ChainGPT's data processing terms.

---

## Infrastructure Teardown Checklist

Once your migration is validated, you can decommission self-hosted infrastructure:

1. [ ] Get ChainGPT API key and verify all endpoints work
2. [ ] Implement the service layer abstraction
3. [ ] Run parallel (both custom and ChainGPT) for 1-2 weeks to compare quality
4. [ ] Switch traffic to ChainGPT
5. [ ] Monitor credit usage and response quality for 1 week
6. [ ] Decommission GPU instances / training pipeline
7. [ ] Cancel RPC provider subscriptions used only for AI context enrichment
8. [ ] Archive model weights and training data (in case you ever need to revert)
9. [ ] Update monitoring and alerting to track ChainGPT API health
10. [ ] Celebrate your reduced cloud bill

---

## Migration Checklist

1. [ ] Audit current AI infrastructure costs (GPU, data pipeline, engineers)
2. [ ] Map custom endpoints to ChainGPT equivalents (see table above)
3. [ ] Get API key at [app.chaingpt.org](https://app.chaingpt.org)
4. [ ] Install SDKs: `npm install @chaingpt/generalchat @chaingpt/nftai`
5. [ ] Create service abstraction layer
6. [ ] Implement ChainGPT service behind the abstraction
7. [ ] Test with the [mock server](../mock-server/) during development
8. [ ] Run parallel comparison for quality validation
9. [ ] Cut over traffic
10. [ ] Decommission self-hosted infrastructure
