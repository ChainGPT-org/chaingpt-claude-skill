# AI NFT Minting Service Template

Instructions for Claude to scaffold a complete AI NFT generation and minting service using the ChainGPT NFT SDK.

---

## What to Generate

### Project Structure

```
chaingpt-nft-service/
├── package.json
├── .env.example
├── tsconfig.json
├── src/
│   ├── index.ts          # Express server entry point
│   ├── nftService.ts     # NFT generation + minting logic
│   ├── routes.ts         # API route definitions
│   └── types.ts          # TypeScript interfaces
└── README.md
```

### Dependencies

**Production:**
- `@chaingpt/nft` — ChainGPT NFT Generator SDK
- `express` — HTTP server
- `dotenv` — environment variables
- `cors` — cross-origin support
- `multer` — multipart form handling (for optional image upload in img2img)

**Dev:**
- `typescript`
- `ts-node`
- `@types/express`
- `@types/multer`
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

---

## API Endpoints to Generate

### POST /nft/generate

Synchronous image generation. Returns the generated image as a buffer.

**Request body:**
```json
{
  "prompt": "A cyberpunk cat with neon eyes",
  "model": "velogen",
  "width": 512,
  "height": 512,
  "steps": 2,
  "style": "neon-punk",
  "enhance": "original"
}
```

**Response:** Image buffer as `image/png` with content-disposition header, or JSON with base64 if `?format=json` query param.

### POST /nft/generate-and-mint

Full pipeline: enhance prompt, generate image, queue for minting.

**Request body:**
```json
{
  "prompt": "A medieval dragon guarding treasure",
  "walletAddress": "0x...",
  "chainId": 137,
  "name": "Dragon NFT",
  "description": "AI-generated dragon art",
  "symbol": "DRGN",
  "model": "nebula_forge_xl",
  "enhancePrompt": true
}
```

**Response:**
```json
{
  "collectionId": "abc123",
  "status": "queued",
  "enhancedPrompt": "...",
  "estimatedCredits": 2
}
```

### GET /nft/progress/:collectionId

Poll the status of an async generation/mint job.

**Response:**
```json
{
  "collectionId": "abc123",
  "status": "completed",
  "progress": 100
}
```

### GET /nft/chains

List supported blockchain networks for minting.

**Query params:** `testNet=true|false`

### POST /nft/enhance-prompt

Enhance a prompt for better generation results (costs 0.5 credits).

**Request body:** `{ "prompt": "a cat in space" }`
**Response:** `{ "enhancedPrompt": "A majestic cosmic feline floating..." }`

---

## Key Implementation Details

### src/nftService.ts

```typescript
import { Nft } from "@chaingpt/nft";

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY! });
```

**generateImage(prompt, options):**
- Call `nft.generateImage()` with prompt, model, width, height, steps, style, enhance
- Returns raw image buffer (the SDK returns `{ data: [byte array] }`)
- Convert the integer array to a Buffer: `Buffer.from(response.data)`

**enhancePrompt(prompt):**
- Call the enhance endpoint
- Return the enhanced prompt string

**generateAndMint(prompt, walletAddress, chainId, metadata):**
- Optionally call enhancePrompt first
- Call `nft.generateNftQueue()` with all params including walletAddress, chainId, amount: 1
- Return the collectionId for polling

**checkProgress(collectionId):**
- Call `nft.getNftProgress(collectionId)`
- Return status and progress percentage

**getSupportedChains(testNet):**
- Call `nft.getChains({ testNet })`
- Return chain list

### Model Validation

Validate the `model` parameter against allowed values:
```typescript
const VALID_MODELS = ["velogen", "nebula_forge_xl", "VisionaryForge", "Dale3"] as const;
```

Model-specific constraints:
- **velogen**: steps 1-4 (default 2), base resolution 512-768px
- **nebula_forge_xl**: steps 1-50 (default 25), base resolution 768-1024px
- **VisionaryForge**: steps 1-50 (default 25), base resolution 768-1024px
- **Dale3**: fixed 1024x1024, no steps parameter, no upscaling

### Credit Cost Estimation

Include a helper function that estimates credit cost before generation:

```typescript
function estimateCredits(model: string, enhance?: string, steps?: number, isCharacterPreserve?: boolean): number {
  let cost = model === "Dale3" ? 4.75 : 1;
  if (enhance === "1x") cost += 1;
  if (enhance === "2x") cost += 2;
  if (model !== "velogen" && model !== "Dale3" && steps && steps > 25) cost += 0.25;
  if (isCharacterPreserve) cost += 5;
  return cost;
}
```

### src/types.ts

```typescript
export type NftModel = "velogen" | "nebula_forge_xl" | "VisionaryForge" | "Dale3";
export type EnhanceOption = "original" | "1x" | "2x";
export type ArtStyle = "3d-model" | "analog-film" | "anime" | "cinematic" | "comic-book" |
  "digital-art" | "enhance" | "fantasy-art" | "isometric" | "line-art" | "low-poly" |
  "neon-punk" | "origami" | "photographic" | "pixel-art" | "texture" | "craft-clay";

export interface GenerateRequest {
  prompt: string;
  model?: NftModel;
  width?: number;
  height?: number;
  steps?: number;
  style?: ArtStyle;
  enhance?: EnhanceOption;
}

export interface MintRequest extends GenerateRequest {
  walletAddress: string;
  chainId: number;
  name: string;
  description: string;
  symbol: string;
  enhancePrompt?: boolean;
}

export interface MintResponse {
  collectionId: string;
  status: string;
  enhancedPrompt?: string;
  estimatedCredits: number;
}

export interface ProgressResponse {
  collectionId: string;
  status: string;
  progress: number;
}
```

### .env.example

```
CHAINGPT_API_KEY=your_api_key_here
PORT=3001
ALLOWED_ORIGINS=*
DEFAULT_MODEL=velogen
```

### Error Handling

- Validate model before calling SDK (return 400 for invalid model)
- Validate width/height ranges per model
- Catch SDK errors and return structured JSON errors
- Include credit cost in error responses when relevant (e.g., insufficient credits)

---

## Supported Chains Reference

Include this as a constant in the codebase for documentation/validation:

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| BSC | 56 |
| Polygon | 137 |
| Base | 8453 |
| Arbitrum | 42161 |
| Avalanche | 43114 |
| Linea | 59144 |
| Scroll | 534352 |
| Mantle | 5000 |
| Sei | 1329 |
| Bera Chain | 80094 |
| Cronos | 25 |
| Sonic | 146 |

---

## Usage Instructions

```bash
npm install
cp .env.example .env  # Add your ChainGPT API key
npm run dev
```

Generate an image:
```bash
curl -X POST http://localhost:3001/nft/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A cyberpunk cat", "model": "velogen", "width": 512, "height": 512}' \
  --output cat.png
```

Generate and mint:
```bash
curl -X POST http://localhost:3001/nft/generate-and-mint \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A dragon",
    "walletAddress": "0xYOUR_WALLET",
    "chainId": 137,
    "name": "Dragon NFT",
    "description": "AI art",
    "symbol": "DRGN",
    "enhancePrompt": true
  }'
```

Check progress:
```bash
curl http://localhost:3001/nft/progress/abc123
```

---

## Pricing Notes

- 1 credit = $0.01 (1,000 credits = $10)
- 15% bonus when purchasing with $CGPT token
- Prompt enhancement: 0.5 credits
- Minting itself is free (generation costs apply)
