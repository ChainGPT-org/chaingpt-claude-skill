# ChainGPT MCP Server

An MCP (Model Context Protocol) server that exposes all ChainGPT Web3 AI APIs as tools Claude can call directly. This lets Claude execute real API requests against ChainGPT's infrastructure — generating NFTs, auditing smart contracts, fetching crypto news, and more — without writing code.

## Prerequisites

- Node.js 22.14+
- An optional ChainGPT API key ([get one here](https://app.chaingpt.org))
- API credits loaded in your account

## Installation

Use the [reviewed local-checkout installation](../README.md#-install-from-a-reviewed-checkout).
In `mcp-server/`, with credentials unset:

```bash
npm ci --omit=dev --ignore-scripts
```

Startup never invokes a package manager. Do not copy `node_modules` from an old
or untrusted installation. After reviewing an update, rerun `npm ci` before use.
The launcher checks for missing dependencies and the built server and fails closed.

## Configuration

For the MCP server alone, configure your client to run the prepared local launcher:

```json
{
  "mcpServers": {
    "chaingpt": {
      "command": "node",
      "args": ["/absolute/path/chaingpt-claude-skill/mcp-server/launch.mjs"]
    }
  }
}
```

Provide `CHAINGPT_API_KEY` through your client's environment after installation
if you use ChainGPT product tools. Keep secrets out of committed configuration.

## Available Tools

### Chat (Web3 AI LLM)

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_chat` | Ask ChainGPT's Web3 AI any crypto/blockchain question with live on-chain data | 0.5 credits |
| `chaingpt_chat_with_context` | Chat with custom context injection (company info, token details, tone) | 0.5 credits |

### NFT Generator

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_nft_generate_image` | Generate an AI image from a text prompt | 1-14.25 credits |
| `chaingpt_nft_enhance_prompt` | Enhance a prompt for better image generation | 0.5 credits |
| `chaingpt_nft_get_chains` | List supported blockchain networks for minting | Free |
| `chaingpt_nft_generate_and_mint` | Full pipeline: generate + queue + poll + mint | 1+ credits |

### Smart Contract Auditor

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_audit_contract` | Audit a Solidity contract for vulnerabilities (scored 0-100%) | 1 credit |

### Smart Contract Generator

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_generate_contract` | Generate Solidity contracts from natural language | 1 credit |

### Crypto News

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_news_fetch` | Fetch AI-curated crypto news with filtering | 1 credit/10 records |
| `chaingpt_news_categories` | Get all category, blockchain, and token IDs | Free |

### Utilities

| Tool | Description | Cost |
|------|-------------|------|
| `chaingpt_estimate_credits` | Estimate credit cost before executing an operation | Free |
| `chaingpt_check_balance` | Get dashboard URL for checking credit balance | Free |

## Usage Examples

Once configured, just talk to Claude naturally:

- "What is the current price of Ethereum?" -- Claude calls `chaingpt_chat`
- "Generate an NFT of a samurai warrior in cyberpunk style" -- Claude calls `chaingpt_nft_generate_image`
- "Audit this Solidity contract for vulnerabilities: [paste code]" -- Claude calls `chaingpt_audit_contract`
- "Generate an ERC-20 token called MyToken with 1M supply" -- Claude calls `chaingpt_generate_contract`
- "Get me the latest DeFi news about Ethereum" -- Claude calls `chaingpt_news_fetch`
- "How much would it cost to generate a Dale3 NFT with 2x upscale?" -- Claude calls `chaingpt_estimate_credits`

## Credit Costs Summary

| Product | Base Cost | With Chat History |
|---------|-----------|-------------------|
| Chat LLM | 0.5 credits ($0.005) | 1.0 credits ($0.01) |
| NFT Generation (velogen/nebula/visionary) | 1 credit ($0.01) | N/A |
| NFT Generation (Dale3) | 4.75 credits ($0.0475) | N/A |
| NFT +1x upscale | +1 credit | N/A |
| NFT +2x upscale | +2 credits | N/A |
| NFT prompt enhance | 0.5 credits ($0.005) | N/A |
| Contract Generator | 1 credit ($0.01) | 2 credits ($0.02) |
| Contract Auditor | 1 credit ($0.01) | 2 credits ($0.02) |
| Crypto News | 1 credit per 10 records | N/A |

1 credit = $0.01 USD. 15% bonus when paying with $CGPT tokens.

## Development

```bash
npm ci --ignore-scripts
npm run dev    # Run with ts-node
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

## Rate Limits

All API products: 200 requests/minute per API key.

## License

MIT
