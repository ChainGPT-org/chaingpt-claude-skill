# ChainGPT AI NFT Generator — Complete API/SDK Reference

## REST API Endpoints

Base URL: `https://api.chaingpt.org`

Authentication for all endpoints:

```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

---

### 1. POST /nft/generate-image

Synchronous image generation. Returns raw image bytes.

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text description of the image to generate |
| `model` | string | Yes | `"velogen"`, `"nebula_forge_xl"`, `"VisionaryForge"`, or `"Dale3"` |
| `height` | int | Yes | Image height in pixels |
| `width` | int | Yes | Image width in pixels |
| `steps` | int | No | Inference steps: velogen 1–4, nebula/visionary 1–50, Dale3 N/A |
| `enhance` | string | No | Upscale option: `"original"`, `"1x"`, or `"2x"` |
| `style` | string | No | Art style (see Styles section) |
| `traits` | array | No | NFT trait metadata |
| `image` | string (URL) | No | Source image URL for img2img generation |
| `isCharacterPreserve` | boolean | No | Preserve character consistency (+5 credits) |

#### Response

```json
{
  "data": [255, 216, ...]
}
```

The `data` field contains raw image bytes as an integer array (e.g., JPEG buffer).

---

### 2. POST /nft/generate-multiple-images

Generate multiple images from an array of prompts in a single request.

#### Request Body

```json
{
  "prompts": [
    { "prompt": "A cyberpunk cat", "model": "velogen", "height": 512, "width": 512 },
    { "prompt": "A medieval dragon", "model": "velogen", "height": 512, "width": 512 }
  ]
}
```

---

### 3. POST /nft/generate-nft-queue (Async)

Queues an NFT generation job for on-chain minting.

#### Additional Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `walletAddress` | string | Yes | Destination wallet address |
| `chainId` | int | Yes | Target blockchain chain ID |
| `amount` | int | Yes | Number of NFTs to generate |

Plus all parameters from `/nft/generate-image`.

#### Response

```json
{
  "collectionId": "abc123...",
  "status": "queued"
}
```

---

### 4. GET /nft/progress/{collectionId}

Check the status of an async NFT generation job.

#### Response

```json
{
  "collectionId": "abc123...",
  "status": "completed",
  "progress": 100
}
```

---

### 5. POST /nft/mint-nft

Finalize and mint an NFT collection. Uploads to IPFS and returns metadata.

#### Request Body

```json
{
  "collectionId": "abc123...",
  "name": "My NFT Collection",
  "description": "A collection of AI-generated art",
  "symbol": "MYNFT",
  "ids": [1, 2, 3]
}
```

#### Response

Returns metadata including IPFS image URLs for each minted NFT.

---

### 6. POST /nft/enhancePrompt

Enhance a prompt using AI for better image generation results. Costs 0.5 credits.

#### Request

```json
{
  "prompt": "a cat in space"
}
```

#### Response

```json
{
  "enhancedPrompt": "A majestic cosmic feline floating gracefully through a nebula of swirling purple and blue gases, surrounded by distant stars and galaxies, photorealistic digital art with volumetric lighting"
}
```

---

### 7. GET /nft/get-chains

Returns supported blockchain networks for NFT minting.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `testNet` | boolean | `true` for testnets, `false` for mainnets |

---

### 8. GET /nft/abi

Returns the NFT Mint Factory smart contract ABI.

---

## Supported Chains

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| Cronos | 25 |
| BSC | 56 |
| Viction | 88 |
| Polygon | 137 |
| Sonic | 146 |
| X Layer | 196 |
| BTTC | 199 |
| opBNB | 204 |
| Hedera | 295 |
| 5ire | 995 |
| COREDAO | 1116 |
| Sei | 1329 |
| Mantle | 5000 |
| Base | 8453 |
| Immutable | 13371 |
| Arbitrum | 42161 |
| Avalanche | 43114 |
| Linea | 59144 |
| Bera Chain | 80094 |
| Scroll | 534352 |
| SKALE | 1350216234 |

---

## Models & Specifications

| Model | Base Resolution | Max Upscaled (2x) | Steps Range | Default Steps |
|-------|----------------|-------------------|-------------|---------------|
| velogen | 512–768px | ~1920x1920 | 1–4 | 2 |
| nebula_forge_xl | 768–1024px | ~1536x1536 | 1–50 | 25 |
| VisionaryForge | 768–1024px | ~1536x1536 | 1–50 | 25 |
| Dale3 | 1024x1024 fixed | N/A | N/A | N/A |

---

## Styles

```
3d-model, analog-film, anime, cinematic, comic-book, digital-art, enhance,
fantasy-art, isometric, line-art, low-poly, neon-punk, origami, photographic,
pixel-art, texture, craft-clay
```

---

## Pricing

1 credit = $0.01. 1,000 credits = $10. 15% bonus when paying with $CGPT.

### Generation Costs

| Model | Base Cost | +1x Upscale | +2x Upscale | Steps 26–50 |
|-------|-----------|-------------|-------------|-------------|
| VeloGen | 1 credit | +1 credit | +2 credits | N/A (max 4 steps) |
| NebulaForge XL | 1 credit | +1 credit | +2 credits | +0.25 credits |
| VisionaryForge | 1 credit | +1 credit | +2 credits | +0.25 credits |
| Dale3 (1024x1024) | 4.75 credits | — | — | N/A |
| Dale3 (other res) | ~9.5 credits | — | — | N/A |

Enhanced (upscaled) Dale3 images cost roughly double.

### Other Costs

| Action | Cost |
|--------|------|
| Prompt enhancement | 0.5 credits |
| Character preserve | +5 credits |
| Minting | Free |
| Get chains | Free |
| Get ABI | Free |

---

## cURL Examples

### Enhance a Prompt

```bash
curl -X POST https://api.chaingpt.org/nft/enhancePrompt \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a cat wearing a space helmet"
  }'
```

### Generate Image (Sync)

```bash
curl -X POST https://api.chaingpt.org/nft/generate-image \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A majestic cosmic feline in a detailed space helmet, nebula background, photorealistic",
    "model": "velogen",
    "height": 512,
    "width": 512,
    "steps": 4,
    "enhance": "2x",
    "style": "digital-art"
  }' --output generated.jpg
```

### Queue NFT Generation (Async)

```bash
curl -X POST https://api.chaingpt.org/nft/generate-nft-queue \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cyberpunk warrior with neon armor",
    "model": "nebula_forge_xl",
    "height": 1024,
    "width": 1024,
    "steps": 30,
    "walletAddress": "0xYourWalletAddress",
    "chainId": 56,
    "amount": 1
  }'
```

### Check Progress

```bash
curl -X GET https://api.chaingpt.org/nft/progress/COLLECTION_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Mint NFT

```bash
curl -X POST https://api.chaingpt.org/nft/mint-nft \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "collectionId": "COLLECTION_ID",
    "name": "Space Cat Collection",
    "description": "AI-generated space cats",
    "symbol": "SCAT",
    "ids": [1]
  }'
```

### Get Supported Chains

```bash
curl -X GET "https://api.chaingpt.org/nft/get-chains?testNet=false" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Get Contract ABI

```bash
curl -X GET https://api.chaingpt.org/nft/abi \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## JavaScript SDK (@chaingpt/nft)

### Installation

```bash
npm install @chaingpt/nft
```

### Initialization

```javascript
const { Nft } = require("@chaingpt/nft");

const nft = new Nft({
  apiKey: "YOUR_API_KEY",
});
```

### Complete Workflow: Enhance, Generate, and Mint

```javascript
const { Nft, Errors } = require("@chaingpt/nft");

const nft = new Nft({ apiKey: "YOUR_API_KEY" });

async function createAndMintNft() {
  try {
    // Step 1: Enhance the prompt
    const enhanced = await nft.enhancePrompt({
      prompt: "a cat wearing a space helmet",
    });
    console.log("Enhanced prompt:", enhanced.enhancedPrompt);

    // Step 2: Generate NFT (async queue)
    const generation = await nft.generateNftWithQueue({
      prompt: enhanced.enhancedPrompt,
      model: "nebula_forge_xl",
      height: 1024,
      width: 1024,
      steps: 30,
      enhance: "2x",
      style: "digital-art",
      walletAddress: "0xYourWalletAddress",
      chainId: 56,
      amount: 1,
    });
    console.log("Collection ID:", generation.collectionId);

    // Step 3: Poll for completion
    let progress;
    do {
      await new Promise((r) => setTimeout(r, 3000));
      progress = await nft.getNftProgress({
        collectionId: generation.collectionId,
      });
      console.log("Progress:", progress.status);
    } while (progress.status !== "completed");

    // Step 4: Mint the NFT
    const minted = await nft.mintNft({
      collectionId: generation.collectionId,
      name: "Space Cat",
      description: "An AI-generated space cat NFT",
      symbol: "SCAT",
      ids: [1],
    });
    console.log("Minted:", minted);
  } catch (error) {
    if (error instanceof Errors.NftError) {
      console.error("NFT error:", error.message);
    }
    throw error;
  }
}
```

### Sync Image Generation

```javascript
async function generateImage() {
  const result = await nft.generateImage({
    prompt: "A futuristic city skyline at sunset",
    model: "velogen",
    height: 512,
    width: 512,
    steps: 4,
    enhance: "original",
    style: "cinematic",
  });

  // result.data is a byte array — write to file
  const fs = require("fs");
  const buffer = Buffer.from(result.data);
  fs.writeFileSync("output.jpg", buffer);
  console.log("Image saved to output.jpg");
}
```

### Generate Multiple Images

```javascript
async function generateMultiple() {
  const results = await nft.generateMultipleImages([
    { prompt: "A dragon in a volcano", model: "velogen", height: 512, width: 512 },
    { prompt: "An ice phoenix", model: "velogen", height: 512, width: 512 },
  ]);
  console.log("Generated", results.length, "images");
}
```

### Sync NFT Generation

```javascript
async function generateNftSync() {
  const result = await nft.generateNft({
    prompt: "A golden warrior helmet",
    model: "VisionaryForge",
    height: 1024,
    width: 1024,
    steps: 30,
    walletAddress: "0xYourWalletAddress",
    chainId: 1,
    amount: 1,
  });
  console.log("NFT generated:", result);
}
```

### Surprise Me

```javascript
async function surpriseMe() {
  const result = await nft.surpriseMe();
  console.log("Random NFT:", result);
}
```

### Get Collections

```javascript
async function listCollections() {
  const collections = await nft.getCollections({
    walletAddress: "0xYourWalletAddress",
    isPublic: true,
    isDraft: false,
    isMinted: true,
    name: "Space",
    symbol: "SCAT",
    page: 1,
    limit: 10,
  });
  console.log("Collections:", collections);
}
```

### Toggle NFT Visibility

```javascript
async function toggleVisibility() {
  await nft.toggleNftVisibility({
    collectionId: "COLLECTION_ID",
    isPublic: false,
  });
  console.log("Visibility toggled");
}
```

### Get Chains and ABI

```javascript
async function getChainInfo() {
  const chains = await nft.getChains({ testNet: false });
  console.log("Supported chains:", chains);

  const contractAbi = await nft.abi();
  console.log("ABI:", contractAbi);
}
```

### Error Handling

```javascript
const { Errors } = require("@chaingpt/nft");

try {
  const result = await nft.generateImage({ /* ... */ });
} catch (error) {
  if (error instanceof Errors.NftError) {
    console.error("NFT generation error:", error.message);
  }
}
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

# Recommended: async context manager
async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    # ... use client.nft methods
    pass
```

### Enhance Prompt

```python
from chaingpt import ChainGPTClient

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    result = await client.nft.enhance_prompt(prompt="a cat in space")
    print("Enhanced:", result.enhanced_prompt)
```

### Generate Image

```python
from chaingpt import ChainGPTClient
from chaingpt.types import NFTImageModel, ImageEnhanceOption

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    result = await client.nft.generate_image(
        prompt="A majestic cosmic feline floating through a nebula",
        model=NFTImageModel.VELOGEN,
        height=512,
        width=512,
        steps=4,
        enhance=ImageEnhanceOption.ENHANCE_2X,
        style="digital-art",
    )
    # result.data contains raw image bytes
    with open("output.jpg", "wb") as f:
        f.write(bytes(result.data))
    print("Image saved")
```

### Async Queue Generation and Minting

```python
import asyncio
from chaingpt import ChainGPTClient
from chaingpt.types import NFTImageModel, ImageEnhanceOption

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    # Step 1: Enhance prompt
    enhanced = await client.nft.enhance_prompt(
        prompt="a warrior with golden armor"
    )

    # Step 2: Queue generation
    generation = await client.nft.generate_nft_queue(
        prompt=enhanced.enhanced_prompt,
        model=NFTImageModel.NEBULA_FORGE_XL,
        height=1024,
        width=1024,
        steps=30,
        enhance=ImageEnhanceOption.ENHANCE_2X,
        wallet_address="0xYourWalletAddress",
        chain_id=56,
        amount=1,
    )
    collection_id = generation.collection_id
    print(f"Queued: {collection_id}")

    # Step 3: Poll for completion
    while True:
        progress = await client.nft.get_progress(collection_id=collection_id)
        print(f"Status: {progress.status}")
        if progress.status == "completed":
            break
        await asyncio.sleep(3)

    # Step 4: Mint
    minted = await client.nft.mint_nft_metadata(
        collection_id=collection_id,
        name="Golden Warrior",
        description="An AI-generated golden warrior NFT",
        symbol="GWAR",
        ids=[1],
    )
    print("Minted:", minted)
```

### Get Chains and ABI

```python
from chaingpt import ChainGPTClient

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    # Get supported chains
    chains = await client.nft.get_chains(test_net=False)
    print("Chains:", chains)

    # Get contract ABI
    abi = await client.nft.get_abi()
    print("ABI:", abi)
```

### Available Enums

```python
from chaingpt.types import NFTImageModel, ImageEnhanceOption

# NFTImageModel
NFTImageModel.VELOGEN           # "velogen"
NFTImageModel.NEBULA_FORGE_XL   # "nebula_forge_xl"
NFTImageModel.VISIONARY_FORGE   # "VisionaryForge"
NFTImageModel.DALE3             # "Dale3"

# ImageEnhanceOption
ImageEnhanceOption.ORIGINAL     # "original"
ImageEnhanceOption.ENHANCE_1X   # "1x"
ImageEnhanceOption.ENHANCE_2X   # "2x"
```

### Error Handling

```python
from chaingpt import ChainGPTClient
from chaingpt.exceptions import (
    ChainGPTError,
    APIError,
    AuthenticationError,
    InsufficientCreditsError,
    ValidationError,
)

async with ChainGPTClient(api_key="YOUR_API_KEY") as client:
    try:
        result = await client.nft.generate_image(
            prompt="test",
            model=NFTImageModel.VELOGEN,
            height=512,
            width=512,
        )
    except AuthenticationError:
        print("Invalid API key")
    except InsufficientCreditsError:
        print("Not enough credits")
    except ValidationError as e:
        print(f"Invalid parameters: {e}")
    except APIError as e:
        print(f"API error: {e}")
    except ChainGPTError as e:
        print(f"General error: {e}")
```

---

## Response Examples

### POST /nft/generate-image — Success

The response contains raw image bytes as an integer array. This is a truncated example:

```json
{
  "data": [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 219, 0, 67, 0, 8, 6, 6, 7, 6, 5, 8, 7, 7, 7, 9, 9, 8, 10, 12, 20, 13, 12, 11, 11, 12, 25, 18, 19, 15, "...thousands more bytes..."]
}
```

The byte array starts with `[255, 216, 255]` (JPEG magic bytes). Write these bytes to a `.jpg` file to save the image.

### POST /nft/generate-nft-queue — Success

```json
{
  "collectionId": "f7a3b2c1-9e8d-4f6a-b5c0-1d2e3f4a5b6c",
  "status": "queued"
}
```

### GET /nft/progress/{collectionId} — In Progress

```json
{
  "collectionId": "f7a3b2c1-9e8d-4f6a-b5c0-1d2e3f4a5b6c",
  "status": "processing",
  "progress": 65
}
```

### GET /nft/progress/{collectionId} — Completed

```json
{
  "collectionId": "f7a3b2c1-9e8d-4f6a-b5c0-1d2e3f4a5b6c",
  "status": "completed",
  "progress": 100
}
```

### POST /nft/mint-nft — Success

```json
{
  "data": {
    "collectionId": "f7a3b2c1-9e8d-4f6a-b5c0-1d2e3f4a5b6c",
    "name": "Space Cat Collection",
    "symbol": "SCAT",
    "description": "AI-generated space cats",
    "chainId": 56,
    "walletAddress": "0x7a9F3bC1d2E4f5A6b8C0dE1f2A3b4C5D6e7F8a9B",
    "nfts": [
      {
        "id": 1,
        "imageUrl": "ipfs://QmX7bF3kL9mNpR2sT4vW5yZ6aB8cD0eF1gH2iJ3kL4mN5o",
        "metadataUrl": "ipfs://QmR8cD9eF0gH1iJ2kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2",
        "metadata": {
          "name": "Space Cat #1",
          "description": "AI-generated space cats",
          "image": "ipfs://QmX7bF3kL9mNpR2sT4vW5yZ6aB8cD0eF1gH2iJ3kL4mN5o",
          "attributes": []
        }
      }
    ]
  }
}
```

### POST /nft/enhancePrompt — Success

```json
{
  "enhancedPrompt": "A majestic cosmic feline astronaut floating gracefully through a vibrant nebula of swirling purple and electric blue gases, wearing a sleek futuristic space helmet with reflective visor, surrounded by distant spiral galaxies and twinkling stars, photorealistic digital art with dramatic volumetric lighting and lens flare effects"
}
```

### GET /nft/get-chains — Success (Mainnet)

```json
{
  "data": [
    { "chainId": 1, "name": "Ethereum", "rpcUrl": "https://eth.llamarpc.com", "explorerUrl": "https://etherscan.io", "symbol": "ETH" },
    { "chainId": 56, "name": "BSC", "rpcUrl": "https://bsc-dataseed.binance.org", "explorerUrl": "https://bscscan.com", "symbol": "BNB" },
    { "chainId": 137, "name": "Polygon", "rpcUrl": "https://polygon-rpc.com", "explorerUrl": "https://polygonscan.com", "symbol": "MATIC" },
    { "chainId": 42161, "name": "Arbitrum", "rpcUrl": "https://arb1.arbitrum.io/rpc", "explorerUrl": "https://arbiscan.io", "symbol": "ETH" },
    { "chainId": 43114, "name": "Avalanche", "rpcUrl": "https://api.avax.network/ext/bc/C/rpc", "explorerUrl": "https://snowtrace.io", "symbol": "AVAX" },
    { "chainId": 8453, "name": "Base", "rpcUrl": "https://mainnet.base.org", "explorerUrl": "https://basescan.org", "symbol": "ETH" }
  ]
}
```

### Error — Invalid Model

```json
{
  "status": false,
  "message": "Validation error: 'model' must be one of: velogen, nebula_forge_xl, VisionaryForge, Dale3"
}
```

### Error — Insufficient Credits

```json
{
  "status": false,
  "message": "Insufficient credits. Your balance is 0.2 credits. This request requires 3.0 credits."
}
```
