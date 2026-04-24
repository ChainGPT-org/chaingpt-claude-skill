# ChainGPT API — TypeScript Type Definitions

Complete TypeScript interfaces for all ChainGPT API request and response types.
Use these as a reference when building integrations or generating code.

---

## Table of Contents

1. [Common / Shared Types](#common--shared-types)
2. [Web3 AI Chatbot (LLM)](#web3-ai-chatbot-llm)
3. [Smart Contract Generator](#smart-contract-generator)
4. [Smart Contract Auditor](#smart-contract-auditor)
5. [AI NFT Generator](#ai-nft-generator)
6. [AI Crypto News](#ai-crypto-news)
7. [Utility Types](#utility-types)
8. [Type Guards](#type-guards)

---

## Common / Shared Types

```typescript
// ── Product Identifier ──────────────────────────────────────────────

/** All ChainGPT API products */
type ChainGPTProduct =
  | 'general_assistant'
  | 'smart_contract_generator'
  | 'smart_contract_auditor'
  | 'nft_generator'
  | 'ai_news';

// ── API Error ───────────────────────────────────────────────────────

/** Standard error body returned by all ChainGPT REST endpoints */
interface ApiError {
  /** HTTP status code (400, 401, 402, 403, 404, 429, 5xx) */
  status: number;
  /** Human-readable error description */
  message: string;
  /** Machine-readable error code, e.g. "INSUFFICIENT_CREDITS" */
  code: string;
}

// ── Credit Balance ──────────────────────────────────────────────────

/** Returned by GET /balance */
interface CreditBalance {
  /** Remaining API credits */
  credits: number;
}

// ── Generic API Response Wrapper ────────────────────────────────────

/**
 * Generic wrapper matching the shape of most ChainGPT JSON responses.
 * Use `ApiResponse<T>` when the response body is `{ data: T }`.
 */
interface ApiResponse<T> {
  data: T;
}

/**
 * Generic wrapper for list endpoints that include pagination metadata.
 */
interface PaginatedResponse<T> {
  data: T[];
  /** Total number of records matching the query */
  total?: number;
  /** Current offset */
  offset?: number;
  /** Requested limit */
  limit?: number;
}
```

---

## Web3 AI Chatbot (LLM)

```typescript
// ── Enums ───────────────────────────────────────────────────────────

/** Preset tone options for context-injected conversations */
type PresetTone =
  | 'Professional'
  | 'Friendly'
  | 'Informative'
  | 'Casual'
  | 'Witty'
  | 'Formal'
  | 'Empathetic'
  | 'Direct'
  | 'Enthusiastic'
  | 'Analytical'
  | 'Creative'
  | 'Persuasive'
  | 'Educational';

/** Supported blockchains for context injection */
type BlockchainEnum =
  | 'Ethereum'
  | 'BSC'
  | 'Polygon'
  | 'Avalanche'
  | 'Fantom'
  | 'Arbitrum'
  | 'Optimism'
  | 'Cronos'
  | 'Gnosis'
  | 'Celo'
  | 'Moonbeam'
  | 'Moonriver'
  | 'Harmony'
  | 'Aurora'
  | 'Metis'
  | 'Boba'
  | 'Klaytn'
  | 'Fuse'
  | 'Evmos'
  | 'Kava'
  | 'Telos'
  | 'Syscoin'
  | 'Velas'
  | 'Milkomeda'
  | 'DFK'
  | 'Swimmer'
  | 'Base'
  | 'zkSync'
  | 'Linea'
  | 'Scroll'
  | 'Mantle'
  | 'Blast'
  | 'Solana'
  | 'TON';

// ── Context Injection ───────────────────────────────────────────────

/**
 * Custom context injected into the LLM to tailor responses.
 * Requires `useCustomContext: true` in the request.
 */
interface ContextInjection {
  /** Company or project name for branded responses */
  companyName?: string;
  /** Token-specific information (name, ticker, supply, etc.) */
  tokenInformation?: string;
  /** Select a preset tone for the AI response */
  aiTone?: PresetTone;
  /** Free-form custom tone description (overrides aiTone) */
  customTone?: string;
  /** Preferred response language (e.g. "English", "Spanish") */
  language?: string;
  /** Target blockchain for chain-specific answers */
  blockchain?: BlockchainEnum;
  /** Custom instructions appended to the system prompt */
  customInstructions?: string;
  /** Project website URL for grounding */
  website?: string;
  /** Social media links */
  socialMedia?: string;
  /** Additional free-form context */
  additionalContext?: string;
}

// ── Chat Request ────────────────────────────────────────────────────

/**
 * POST /chat/stream — request body for the Web3 AI Chatbot.
 * The same endpoint handles both blob and streaming responses.
 */
interface ChatBlobRequest {
  /** Must be "general_assistant" for the LLM chatbot */
  model: 'general_assistant';
  /** User prompt (1-10,000 characters) */
  question: string;
  /** Enable server-side chat history tracking */
  chatHistory: 'on' | 'off';
  /** Session ID for grouping history (1-100 characters) */
  sdkUniqueId?: string;
  /** Enable custom context injection */
  useCustomContext?: boolean;
  /** Custom context object (requires useCustomContext: true) */
  contextInjection?: ContextInjection;
}

// ── Chat Responses ──────────────────────────────────────────────────

/** Blob (non-streaming) response from /chat/stream */
interface ChatBlobResponse {
  data: {
    /** The AI-generated answer */
    bot: string;
    /** Serialized chat history (when chatHistory is "on") */
    chatHistory?: string;
  };
}

/**
 * When streaming, the response is chunked text.
 * Each chunk is a raw string fragment — not JSON.
 * Concatenate all chunks to reconstruct the full answer.
 */
type ChatStreamChunk = string;
```

---

## Smart Contract Generator

```typescript
/**
 * POST /chat/stream — request body for the Smart Contract Generator.
 * Uses the same endpoint and response shape as the LLM chatbot.
 */
interface SmartContractGeneratorRequest {
  /** Must be "smart_contract_generator" */
  model: 'smart_contract_generator';
  /** Description of the smart contract to generate */
  question: string;
  /** Enable server-side chat history tracking */
  chatHistory: 'on' | 'off';
  /** Session ID for grouping history */
  sdkUniqueId?: string;
}

/** Response is identical to ChatBlobResponse */
type SmartContractGeneratorResponse = ChatBlobResponse;
```

---

## Smart Contract Auditor

```typescript
/**
 * POST /chat/stream — request body for the Smart Contract Auditor.
 * Uses the same endpoint and response shape as the LLM chatbot.
 */
interface SmartContractAuditorRequest {
  /** Must be "smart_contract_auditor" */
  model: 'smart_contract_auditor';
  /** Solidity source code or contract description to audit */
  question: string;
  /** Enable server-side chat history tracking */
  chatHistory: 'on' | 'off';
  /** Session ID for grouping history */
  sdkUniqueId?: string;
}

/** Response is identical to ChatBlobResponse */
type SmartContractAuditorResponse = ChatBlobResponse;
```

---

## AI NFT Generator

```typescript
// ── Image Models ────────────────────────────────────────────────────

/** Supported image generation models */
type NftImageModel = 'velogen' | 'nebula_forge_xl' | 'VisionaryForge' | 'Dale3';

/** Upscale / enhance options */
type EnhanceOption = 'original' | '1x' | '2x' | 'none';

// ── Chain Info ──────────────────────────────────────────────────────

/** Blockchain network information for NFT minting */
interface ChainInfo {
  /** EVM chain ID (e.g. 1 for Ethereum, 56 for BSC) */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** Native token symbol (e.g. "ETH", "BNB") */
  symbol: string;
  /** JSON-RPC endpoint URL */
  rpcUrl: string;
}

// ── Generate Image ──────────────────────────────────────────────────

/**
 * POST /nft/generate-image — generate an AI image.
 * Returns raw image bytes in the response.
 */
interface GenerateImageRequest {
  /** Text description of the image to generate */
  prompt: string;
  /** Image generation model */
  model: NftImageModel;
  /** Image height in pixels */
  height: number;
  /** Image width in pixels */
  width: number;
  /** Inference steps (velogen 1-4, nebula/visionary 1-50, Dale3 N/A) */
  steps?: number;
  /** Upscale option */
  enhance?: EnhanceOption;
  /** Art style preset */
  style?: string;
  /** NFT trait metadata */
  traits?: Array<{ trait_type: string; value: string }>;
  /** Source image URL for img2img generation */
  image?: string;
  /** Preserve character consistency across generations (+5 credits) */
  isCharacterPreserve?: boolean;
}

/**
 * Response from /nft/generate-image.
 * The `data` field contains raw image bytes as an integer array.
 */
interface GenerateImageResponse {
  data: number[];
}

// ── Generate Multiple Images ────────────────────────────────────────

/** POST /nft/generate-multiple-images */
interface GenerateMultipleImagesRequest {
  prompts: GenerateImageRequest[];
}

// ── Generate NFT (Image + On-Chain Metadata) ────────────────────────

/**
 * POST /nft/generate-nft — generate an image and prepare it for minting.
 * Extends GenerateImageRequest with on-chain parameters.
 */
interface GenerateNftRequest extends GenerateImageRequest {
  /** Wallet address that will own the NFT */
  walletAddress: string;
  /** Target EVM chain ID */
  chainId: number;
  /** Number of editions to mint */
  amount: number;
}

/** Response from /nft/generate-nft */
interface GenerateNftResponse {
  data: {
    /** URL of the generated image */
    imageUrl: string;
  };
}

// ── Mint NFT ────────────────────────────────────────────────────────

/**
 * POST /nft/mint — mint a previously generated NFT on-chain.
 * Returns ABI and calldata for the user to submit the transaction.
 */
interface MintNftRequest {
  /** Collection ID from the generate step */
  collectionId: string;
  /** NFT name */
  name: string;
  /** NFT description */
  description: string;
  /** Token symbol */
  symbol: string;
  /** Array of NFT IDs within the collection to mint */
  ids: number[];
}

/** Response from /nft/mint */
interface MintNftResponse {
  data: {
    /** Contract ABI for the mint function */
    abi: any[];
    /** Deployed contract address */
    contractAddress: string;
    /** Encoded calldata to submit as a transaction */
    mintData: string;
  };
}
```

---

## AI Crypto News

```typescript
// ── News Category ───────────────────────────────────────────────────

/** News category metadata */
interface NewsCategory {
  id: number;
  name: string;
}

/** Token reference within a news article */
interface NewsToken {
  id: number;
  name: string;
  symbol: string;
}

/** Media URLs for a news article */
interface NewsMedia {
  thumbnail: string;
  original: string;
}

// ── News Article ────────────────────────────────────────────────────

/** A single AI-curated news article */
interface NewsArticle {
  /** Unique article ID */
  id: number;
  /** Article headline */
  title: string;
  /** AI-generated summary / description */
  description: string;
  /** Full article URL */
  url: string;
  /** Publication date (ISO 8601) */
  pubDate: string;
  /** Author attribution */
  author: string;
  /** Header image URL */
  imageUrl: string;
  /** Record creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Whether the article is publicly visible */
  isPublished: boolean;
  /** Whether the article is editorially featured */
  isFeatured: boolean;
  /** Whether the article is a top story */
  isTopStory: boolean;
  /** Total view count */
  viewsCount: number;
  /** Category ID */
  categoryId: number;
  /** Sub-category (blockchain) ID */
  subCategoryId: number;
  /** Related token ID */
  tokenId: number;
  /** Category metadata */
  category: NewsCategory;
  /** Sub-category metadata */
  subCategory: NewsCategory;
  /** Related token metadata */
  token: NewsToken;
  /** Image media URLs */
  media: NewsMedia;
  /** Keyword tags */
  newsTags: string[];
}

// ── News Request / Response ─────────────────────────────────────────

/**
 * GET /news — query parameters for fetching AI-curated crypto news.
 * All parameters are optional; defaults to latest 10 articles.
 */
interface NewsRequest {
  /** Filter by category ID(s) */
  categoryId?: number | number[];
  /** Filter by sub-category / blockchain ID(s) */
  subCategoryId?: number | number[];
  /** Filter by token ID(s) */
  tokenId?: number | number[];
  /** Full-text search query */
  searchQuery?: string;
  /** Return articles published after this date (YYYY-MM-DD) */
  fetchAfter?: string;
  /** Number of articles to return (default: 10) */
  limit?: number;
  /** Pagination offset (default: 0) */
  offset?: number;
  /** Sort field (default: "createdAt") */
  sortBy?: string;
}

/** Response from GET /news */
interface NewsResponse {
  status: string;
  data: NewsArticle[];
}
```

---

## Utility Types

```typescript
// ── Model Selector ──────────────────────────────────────────────────

/** Union of all valid `model` values across chat-based products */
type ChatModel =
  | 'general_assistant'
  | 'smart_contract_generator'
  | 'smart_contract_auditor';

// ── Generic Chat Request ────────────────────────────────────────────

/**
 * Polymorphic chat request — use this when building a single function
 * that dispatches to any of the three chat-based products.
 */
interface GenericChatRequest {
  model: ChatModel;
  question: string;
  chatHistory: 'on' | 'off';
  sdkUniqueId?: string;
  useCustomContext?: boolean;
  contextInjection?: ContextInjection;
}

// ── SDK Configuration ───────────────────────────────────────────────

/** Configuration object accepted by all ChainGPT JS SDK constructors */
interface ChainGPTConfig {
  /** API key from the ChainGPT developer dashboard */
  apiKey: string;
}

// ── Discriminated Union for All Requests ────────────────────────────

/**
 * Discriminated union of every request type.
 * Useful for building a generic API client or request logger.
 */
type AnyChainGPTRequest =
  | ({ _product: 'chatbot' } & ChatBlobRequest)
  | ({ _product: 'contract_generator' } & SmartContractGeneratorRequest)
  | ({ _product: 'contract_auditor' } & SmartContractAuditorRequest)
  | ({ _product: 'nft_generate' } & GenerateImageRequest)
  | ({ _product: 'nft_mint' } & MintNftRequest)
  | ({ _product: 'news' } & NewsRequest);
```

---

## Type Guards

```typescript
// ── Runtime Type Guards ─────────────────────────────────────────────

/** Check if a value is an ApiError */
function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'message' in value &&
    'code' in value &&
    typeof (value as ApiError).status === 'number' &&
    typeof (value as ApiError).message === 'string' &&
    typeof (value as ApiError).code === 'string'
  );
}

/** Check if a value is a ChatBlobResponse */
function isChatBlobResponse(value: unknown): value is ChatBlobResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    typeof (value as ChatBlobResponse).data === 'object' &&
    (value as ChatBlobResponse).data !== null &&
    typeof (value as ChatBlobResponse).data.bot === 'string'
  );
}

/** Check if a value is a NewsArticle */
function isNewsArticle(value: unknown): value is NewsArticle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    'url' in value &&
    typeof (value as NewsArticle).id === 'number' &&
    typeof (value as NewsArticle).title === 'string'
  );
}

/** Check if a value is a MintNftResponse */
function isMintNftResponse(value: unknown): value is MintNftResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    typeof (value as MintNftResponse).data === 'object' &&
    (value as MintNftResponse).data !== null &&
    'abi' in (value as MintNftResponse).data &&
    'contractAddress' in (value as MintNftResponse).data &&
    'mintData' in (value as MintNftResponse).data
  );
}

/** Validate that a model string is a valid ChatModel */
function isChatModel(model: string): model is ChatModel {
  return ['general_assistant', 'smart_contract_generator', 'smart_contract_auditor'].includes(model);
}
```

---

## Usage Examples

### Typing a chat request

```typescript
const request: ChatBlobRequest = {
  model: 'general_assistant',
  question: 'Explain ERC-721 vs ERC-1155',
  chatHistory: 'off',
};
```

### Using the generic wrapper

```typescript
async function fetchChat(req: GenericChatRequest): Promise<ApiResponse<{ bot: string }>> {
  const res = await fetch('https://api.chaingpt.org/chat/stream', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (isApiError(json)) throw new Error(`[${json.code}] ${json.message}`);
  return json;
}
```

### Safe response handling with type guards

```typescript
const result: unknown = await fetchChat(request);

if (isChatBlobResponse(result)) {
  console.log(result.data.bot);
} else if (isApiError(result)) {
  console.error(`Error ${result.status}: ${result.message}`);
}
```
