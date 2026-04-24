# Product Selection Guide

Pick the right ChainGPT products for your use case, estimate costs, and find the
fastest path to production.

## "I Want to Build X" — Decision Tree

| I want to build...          | Primary product(s)                          | Template to start from            |
|-----------------------------|---------------------------------------------|-----------------------------------|
| AI chatbot for crypto       | Web3 AI Chatbot (LLM)                       | `chatbot-app.md`, `nextjs-chatbot.md` |
| NFT collection / generator  | AI NFT Generator                            | `nft-minting-service.md`          |
| Smart contract tool         | Smart Contract Generator + Auditor          | `contract-auditor-ci.md`          |
| News aggregator             | AI Crypto News                              | `news-dashboard.md`, `nuxt-news-app.md` |
| Twitter/X bot               | AgenticOS                                   | `twitter-agent.md`                |
| DeFi dashboard              | LLM + News + Auditor (combo)                | `combo-defi-dashboard.md`         |
| NFT marketplace             | NFT Generator + LLM + Auditor + News (combo)| `combo-nft-marketplace.md`        |
| Token analysis tool         | LLM (includes Nansen Smart Money, on-chain) | `chatbot-app.md`                  |
| Portfolio tracker           | LLM + News                                  | `chatbot-app.md` + `news-dashboard.md` |
| Audit platform              | Smart Contract Auditor + patterns library   | `contract-auditor-ci.md`          |
| Mobile wallet companion     | LLM + News                                  | `react-native-wallet.md`          |

> **Not sure?** Start with the **Web3 AI Chatbot (LLM)** — it covers the widest
> range of crypto queries out of the box and is the easiest to extend.

---

## Product Compatibility Matrix

Products are designed to work together. The table shows which combinations add
clear value.

|                        | LLM Chatbot | NFT Generator | Contract Generator | Contract Auditor | Crypto News | AgenticOS |
|------------------------|:-----------:|:-------------:|:------------------:|:----------------:|:-----------:|:---------:|
| **LLM Chatbot**        |      —      |   Natural fit: chat-driven minting   |   Generate from chat prompts   |   Audit from chat   |   Enrich answers with live news   |   Feed insights to agent   |
| **NFT Generator**      |             |       —       |   Deploy NFT contracts   |   Audit NFT contracts before deploy   |   Trending context for collections   |   Auto-post new mints   |
| **Contract Generator** |             |               |        —           |   Always audit generated code   |        —        |      —      |
| **Contract Auditor**   |             |               |                    |        —         |        —        |   Tweet audit results   |
| **Crypto News**        |             |               |                    |                  |       —       |   Auto-curate & post   |
| **AgenticOS**          |             |               |                    |                  |             |      —      |

**Key combos:**

- **Generator + Auditor** — Never deploy unaudited generated code. These two
  should always be paired.
- **LLM + News** — The chatbot becomes significantly more useful when it can
  reference real-time news in its answers.
- **NFT Generator + LLM + Auditor** — Full NFT marketplace stack: generate art,
  chat-based UX, audit the smart contracts.
- **AgenticOS + News** — Autonomous social media agent that posts curated,
  timely crypto content.

---

## Cost Estimation by Use Case

All estimates assume average request patterns and include the credit costs from
[pricing.md](./pricing.md). Actual costs depend on feature mix and usage
patterns.

### Small App — ~100 users/day

| Use case              | Requests/day | Credits/day | Monthly cost (USD) |
|-----------------------|:------------:|:-----------:|:------------------:|
| Chatbot               |     200      |     100     |       ~$30         |
| NFT Generator         |      50      |      50     |       ~$15         |
| News Dashboard        |     100      |      10     |        ~$3         |
| Contract Auditor      |      20      |      20     |        ~$6         |
| Twitter Agent         |      30      |      30     |        ~$9         |

**Estimated total for a combo app (DeFi dashboard):** ~$40-60/month

### Medium App — ~1,000 users/day

| Use case              | Requests/day | Credits/day | Monthly cost (USD) |
|-----------------------|:------------:|:-----------:|:------------------:|
| Chatbot               |    2,000     |    1,000    |      ~$300         |
| NFT Generator         |      500     |      500    |      ~$150         |
| News Dashboard        |    1,000     |      100    |       ~$30         |
| Contract Auditor      |      200     |      200    |       ~$60         |
| Twitter Agent         |      100     |      100    |       ~$30         |

**Estimated total for a combo app (NFT marketplace):** ~$400-550/month

### Large App — ~10,000 users/day

| Use case              | Requests/day | Credits/day | Monthly cost (USD) |
|-----------------------|:------------:|:-----------:|:------------------:|
| Chatbot               |   20,000     |   10,000    |     ~$3,000        |
| NFT Generator         |    5,000     |    5,000    |     ~$1,500        |
| News Dashboard        |   10,000     |    1,000    |       ~$300        |
| Contract Auditor      |    2,000     |    2,000    |       ~$600        |
| Twitter Agent         |      300     |      300    |        ~$90        |

**Estimated total for a combo app (full platform):** ~$4,000-5,500/month

> **Cost optimization tips:**
> - Pay with **$CGPT tokens** for a 15% bonus on every top-up.
> - Enable **monthly auto-top-up** to avoid service interruptions.
> - Use the **mock server** (`localhost:3001`) for development — zero cost.
> - Cache news and chat history locally to reduce redundant API calls.
> - Check your dashboard for **promotional credits**: https://app.chaingpt.org/addcredits

---

## Quick-Start Recommendations

For each use case, the recommended template and first steps.

### AI Chatbot
1. Start from: [`chatbot-app.md`](../templates/chatbot-app.md) or [`nextjs-chatbot.md`](../templates/nextjs-chatbot.md)
2. Get your API key from the dashboard
3. Test against the mock server first
4. Add chat history for context-aware conversations

### NFT Collection / Generator
1. Start from: [`nft-minting-service.md`](../templates/nft-minting-service.md)
2. Choose your model (VeloGen for speed, NebulaForge XL for quality)
3. Use prompt enhancement for better results (+0.5 credits)
4. Integrate minting — the mint endpoint is free

### Smart Contract Tool
1. Start from: [`contract-auditor-ci.md`](../templates/contract-auditor-ci.md)
2. Always pair Generator with Auditor
3. Add to your CI pipeline for automatic auditing on every PR

### News Aggregator
1. Start from: [`news-dashboard.md`](../templates/news-dashboard.md) or [`nuxt-news-app.md`](../templates/nuxt-news-app.md)
2. Use RSS feeds (free) for high-frequency polling
3. Use the paginated API for search and filtering (1 credit per 10 records)

### Twitter/X Bot
1. Start from: [`twitter-agent.md`](../templates/twitter-agent.md)
2. Configure AgenticOS with your posting schedule
3. Combine with Crypto News for content sourcing

### DeFi Dashboard (Combo)
1. Start from: [`combo-defi-dashboard.md`](../templates/combo-defi-dashboard.md)
2. Wire up LLM for natural-language queries
3. Add News feed for market context
4. Integrate Auditor for on-demand contract checks

### NFT Marketplace (Combo)
1. Start from: [`combo-nft-marketplace.md`](../templates/combo-nft-marketplace.md)
2. NFT Generator for creation, LLM for chat UX
3. Auditor for smart contract safety
4. News feed for collection trending data

### Mobile Wallet Companion
1. Start from: [`react-native-wallet.md`](../templates/react-native-wallet.md)
2. LLM for in-app AI assistant
3. News for portfolio-relevant updates
