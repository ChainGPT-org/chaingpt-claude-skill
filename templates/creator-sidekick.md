# AI Creator Sidekick Template

A full-stack template for creator-economy platforms (video, podcast, newsletter, streaming) combining 3 ChainGPT products into a reusable Sidekick service that creator platforms can drop in.

- **Web3 AI Chatbot** — context-aware tipping thank-yous and news summarization
- **AI NFT Generator** — actual thumbnail PNGs from script context (not just descriptions)
- **AI Crypto News** — daily creator brief with story rankings + suggested video angles

This template targets a real gap: existing AI-creator tools either generate generic content or assume the creator is on Web2 platforms. This Sidekick is built for crypto-native creators who tip + earn on-chain, embedded in any video/streaming platform.

---

## What to Generate

### Project Structure

```
chaingpt-creator-sidekick/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                    # Express server with /tipping, /thumbnail, /news endpoints
│   ├── chaingptClient.ts           # Thin SDK wrapper (swap providers in 1 file)
│   ├── services/
│   │   ├── tippingCoach.ts         # Generate warm context-aware thank-yous
│   │   ├── scriptToThumbnail.ts    # Script → title/description/thumbnailConcept (text)
│   │   ├── thumbnailImage.ts       # Chains scriptToThumbnail → NFT image generation (PNG)
│   │   └── newsBrief.ts            # AI News fetch + creator-targeted brief composer
│   ├── routes/
│   │   ├── tipping.ts              # POST /tipping (viewer tipped → thank-you)
│   │   ├── thumbnail.ts            # POST /thumbnail (script → image PNG)
│   │   └── news.ts                 # GET /news (daily creator brief)
│   └── types.ts
└── README.md
```

### Dependencies

**Production:**
- `@chaingpt/generalchat` — chat-based AI for tipping + news composition
- `@chaingpt/nft` — image generation via `generateImage()` (use `velogen` model for cheap iteration)
- `@chaingpt/ainews` — crypto news fetch
- `express`, `dotenv`, `cors`

**Dev:**
- `typescript`, `ts-node`, `@types/express`, `@types/cors`, `nodemon`

---

## Key Implementation Details

### 1. `src/chaingptClient.ts` — SDK wrapper

Single class wrapping `GeneralChat`. Exposes one method `ask({ question, contextInjection, chatHistory })` that returns the streaming response collapsed to a string. This isolates the SDK so feature modules don't import it directly — making it possible to swap providers, add caching, or mock for tests without touching feature code.

### 2. `src/services/tippingCoach.ts` — Tipping Coach

When a viewer tips a creator on-chain, generate a warm, specific 1-2 sentence thank-you that references the actual video and viewer context.

**Inputs:** `creatorName`, `videoTitle`, `videoTopic`, `tipAmount`, `tipCurrency`, `viewerName`, `viewerHistory`

**Key technique:** Inject creator/video context via `contextInjection.companyName` and `contextInjection.tokenInformation`. Explicitly instruct the model to **avoid generic phrases** ("your support means the world to me") so output sounds like a real creator, not a chatbot.

**Output normalization:** Strip wrapping quotes if model adds them.

### 3. `src/services/scriptToThumbnail.ts` — Script-to-Thumbnail (text)

Given a video script, return `{ title, description, thumbnailConcept }`.

**Critical:** ChainGPT GeneralChat returns inconsistent JSON shapes across identical calls. The template must include **permissive normalization** that catches at least these variants:
- `{ thumbnailConcept: string }` (intended)
- `{ thumbnail_concept: string }` (snake_case drift)
- `{ thumbnail: string }` (flat alias)
- `{ thumbnail: { concept, hook, text } }` (nested object)
- `{ image: string }` or `{ imageConcept: string }` (alternate field names)

Recursively gather all string values under any `thumb*|image*|cover*` key and concatenate as fallback.

Strip markdown code fences (```json ... ```) before parsing — the model often wraps despite explicit instructions not to.

### 4. `src/services/thumbnailImage.ts` — Script-to-Thumbnail (PNG)

Chains `scriptToThumbnail` (text concept) into `nft.generateImage()` (actual PNG bytes). Returns `{ concept, image, prompt }`.

**Required for NFT API:** `walletAddress` (where generated images are tracked), `model` (`velogen` for cheapest, `Dale3` for highest quality).

**Defensive prompt building:** If `thumbnailConcept` is empty (model drift), fall back to building the image prompt from `title + description`. Only fail when ALL three are empty.

### 5. `src/services/newsBrief.ts` — Daily Creator Brief

1. Fetch N news items via `ainews.getNews({ limit, sortBy: 'createdAt' })`
2. Truncate each item's title (200 chars) + description (300 chars) to keep prompt under model context limit
3. Send to `chaingptClient.ask()` with structured prompt template:

```
**Top 3 stories** (ranked by importance):
1. [headline] — [1-sentence why-it-matters]
2. ...
3. ...

**Suggested video angles** (3 specific topics a creator could film today):
- [angle 1, 1 sentence]
- [angle 2]
- [angle 3]
```

**Output normalization:** AI News API returns `{ statusCode, message, data: [...] }` — wrap in helper that handles the `data` field plus common variants (`data.rows`, `rows`, `items`, raw array).

### 6. `src/routes/*.ts` — Express endpoints

- `POST /tipping` — body: tip context, returns: `{ message: string }`
- `POST /thumbnail` — body: `{ script, creatorName, ... }`, returns: `{ concept, prompt, imageBase64 }` (encode the PNG as base64 for JSON transport)
- `GET /news?audience=crypto-native&limit=5` — returns: `{ items, brief }`

All endpoints stream long responses where possible (chat takes 7-13 seconds per call).

### 7. `.env.example`

```
CHAINGPT_API_KEY=your_chaingpt_api_key_here
CREATOR_WALLET=0xYourEvmWalletAddressHere
CHAINGPT_MODEL=
PORT=3000
```

---

## Error Handling Notes (Important)

The `@chaingpt/generalchat` SDK has a known error-handler issue where `Insufficient credits` and similar API failures can surface as `TypeError: Cannot read properties of undefined (reading 'data')`. Wrap SDK calls in a try/catch that detects this signature and surfaces a useful message:

```typescript
try {
  return await chat.ask({ ... });
} catch (err) {
  if (err.message?.includes('Cannot read properties of undefined')) {
    throw new Error('ChainGPT API call failed (credit limit or rate limit). Original: ' + err.message);
  }
  throw err;
}
```

---

## Credit Cost Estimate

- Tipping coach call: 0.5 credits per thank-you
- Script-to-thumbnail (text): 0.5 credits
- Script-to-thumbnail (PNG): 0.5 (concept) + 1-3 (image, depends on model + upscale) = ~1.5-3.5 credits
- News brief: 1 credit per 10 news items + 0.5 credits for composition = ~1.5 credits

Typical creator-platform daily usage at 100 active creators:
- 500 tip thank-yous (250 credits)
- 50 thumbnail generations (75-175 credits)
- 1 daily brief shared platform-wide (1.5 credits)
- **Daily total: ~325-425 credits ≈ $3.25-4.25/day at 1 credit = $0.01**

---

## Sample Test Flow

1. **Tipping coach** — POST `/tipping` with a viewer + creator + 5 CGPT tip → expect a 1-2 sentence message referencing the specific tip amount, video topic, and viewer context.
2. **Thumbnail (text)** — POST `/thumbnail` with `?textOnly=true` and a 12-minute ZK rollup script → expect title under 60 chars, 2-3 sentence description, thumbnail concept under 200 chars.
3. **Thumbnail (PNG)** — POST `/thumbnail` with same script → expect base64-encoded PNG ~512x512 or 1024x1024 (configurable).
4. **News brief** — GET `/news?limit=5` → expect structured top-3-stories + 3-video-angles markdown response.

---

## Why this template

- Existing chatbot/news/NFT templates are domain-generic. **No template currently targets the creator-economy vertical** that crypto-native video/streaming platforms need.
- The Sidekick uses 3 of ChainGPT's flagship products in one cohesive flow — chat (tipping + composition), NFT (thumbnails), and news (briefs).
- The output normalization patterns (JSON shape drift handling, error-handler workarounds) reflect lessons from real production integration. Including them here saves the next dev from rediscovering them.
- The architecture is **deliberately platform-agnostic**: BoTTube is one reference integration, but any creator platform (video, podcast, livestream, newsletter) can drop the modules in with minor adjustments.

---

## License

This template is contributed under the same license as the repository.
