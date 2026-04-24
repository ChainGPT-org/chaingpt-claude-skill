# ChainGPT API Pricing Reference

## Credit System
- 1 CGPTc = $0.01 USD
- Credits never expire
- Purchase: crypto (USDT, USDC, ETH, BNB, TRX, $CGPT), or credit card
- 15% bonus when paying with $CGPT tokens or via monthly auto-top-up
- 1,000 credits = $10 USD
- Dashboard: https://app.chaingpt.org/addcredits

## API Product Pricing

### Web3 AI Chatbot & LLM
| Action | Credits | USD |
|--------|---------|-----|
| Base request | 0.5 | $0.005 |
| With chat history | 1.0 | $0.01 |
| Chat history retrieval | 0 | Free |

### AI NFT Generator
| Action | Credits | USD |
|--------|---------|-----|
| VeloGen / NebulaForge XL / VisionaryForge (base) | 1 | $0.01 |
| + 1x upscale | 2 | $0.02 |
| + 2x upscale | 3 | $0.03 |
| NebulaForge/Visionary steps 26-50 | +0.25 | +$0.0025 |
| Dale3 1024x1024 | 4.75 | $0.0475 |
| Dale3 other resolutions | ~9.5 | ~$0.095 |
| Dale3 + enhanced | ~14.25 | ~$0.1425 |
| Prompt enhancement | 0.5 | $0.005 |
| Character preserve | +5 | +$0.05 |
| Mint / Get chains / Get ABI | 0 | Free |

### Smart Contract Generator
| Action | Credits | USD |
|--------|---------|-----|
| Base request | 1 | $0.01 |
| With chat history | 2 | $0.02 |
| History retrieval | 0 | Free |

### Smart Contract Auditor
| Action | Credits | USD |
|--------|---------|-----|
| Base audit | 1 | $0.01 |
| With chat history | 2 | $0.02 |
| History retrieval | 0 | Free |

### AI Crypto News
| Action | Credits | USD |
|--------|---------|-----|
| Per 10 records | 1 | $0.01 |
| RSS feeds | 0 | Free |

### AgenticOS
| Action | Credits | USD |
|--------|---------|-----|
| Per generated tweet | 1 | $0.01 |

### Solidity LLM
Free (self-hosted, MIT license)

## B2C Membership Plans (AI Hub)
Free Plan: 50 chatbot msgs/day, 10 auditor uses/day, 10 generator uses/day, unlimited news, NFT generator access
Pay-Per-Prompt: Same credit costs as API
Freemium (Diamond tier, 200K+ CGPTsp): 20,000 CGPTc (~$200) monthly allowance

## Getting Started & Free Testing

### Promotional Credits
New accounts may receive complimentary credits to explore the API. Check your
dashboard at https://app.chaingpt.org/addcredits for current promotional credit
balance and any active offers.

### Mock Server (Unlimited Free Testing)
The local mock server at `localhost:3001` returns realistic responses for every
API product at zero cost. Use it for development, CI pipelines, and demos:
```bash
npm run mock-server   # starts on port 3001
```
All SDK methods work identically against the mock server — just set
`baseURL: 'http://localhost:3001'` in your client config.

### $CGPT Token Bonus
Pay with **$CGPT tokens** and receive a **15% bonus** on every top-up.

### Monthly Auto-Top-Up
Enable **auto-top-up** in your dashboard to automatically replenish credits when
your balance drops below a threshold. Ideal for steady-state production usage.

Manage credits and billing: https://app.chaingpt.org/addcredits

## Rate Limits
All API products: 200 requests/minute per API key

## Staking Tier System (CGPTsp)
Bronze (2,000+): 1x pool weight, DAO voting
Silver (20,000+): 4x+ weight, IDO round 1+2
Gold (intermediate): 10x+ weight, proposals, partial airdrops
Diamond (200,000+): 40x+ weight, full freemium, all benefits
