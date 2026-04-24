# AI Twitter Agent Template (AgenticOS-based)

Instructions for Claude to scaffold a customized Web3 Twitter agent by forking and configuring the ChainGPT AgenticOS framework.

---

## What to Generate

This template does NOT create a project from scratch. It forks the existing AgenticOS repo and guides customization. Claude should generate the customization files and configuration.

### Project Structure (after fork + customization)

```
my-crypto-agent/
├── .env                        # All required environment variables
├── data/
│   └── schedule.json           # Custom tweet schedule
├── src/
│   ├── config/
│   │   └── persona.ts          # Agent persona/voice configuration
│   ├── services/
│   │   └── contentGenerator.ts # Custom content generation logic
│   └── index.ts                # Entry point (from AgenticOS)
├── package.json
├── bun.lockb
└── README.md
```

---

## Setup Steps

### 1. Clone AgenticOS

```bash
git clone https://github.com/ChainGPT-org/AgenticOS.git my-crypto-agent
cd my-crypto-agent
```

### 2. Install Bun Runtime

```bash
curl -fsSL https://bun.sh/install | bash
# Restart terminal or source ~/.bashrc
```

### 3. Install Dependencies

```bash
bun install
```

### 4. Configure Environment Variables

Generate the `.env` file with all required variables:

```
# Server
PORT=8000
NODE_ENV=development

# Twitter OAuth 2.0 (from developer.twitter.com)
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret

# Encryption (for secure token storage)
ENCRYPTION_KEY=your_32_character_encryption_key
ENCRYPTION_SALT=your_hex_salt_value
ENCRYPTION_IV=your_hex_iv_value

# ChainGPT
CHAINGPT_API_KEY=your_chaingpt_api_key

# Auth
PASSWORD_AUTH=your_admin_password
```

**Generating encryption credentials:**
```bash
# Generate a 32-character key
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# Generate salt (hex)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# Generate IV (hex)
node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"
```

### 5. Set Up Twitter Developer Account

1. Go to https://developer.twitter.com and create a Project + App
2. Configure OAuth 2.0 settings:
   - **Type:** Confidential client
   - **Callback URL:** `https://your-domain.com/api/login/callback` (or `http://localhost:8000/api/login/callback` for local dev)
3. Required scopes:
   - `tweet.read`
   - `tweet.write`
   - `users.read`
   - `offline.access`
4. Copy Client ID and Client Secret to `.env`
5. Note: Free tier = 280 character limit, X Premium = 4,000 characters

### 6. Start the Agent

```bash
bun start
```

### 7. Authenticate with Twitter

1. Open `http://localhost:8000/api/login` in your browser
2. Authorize the app on Twitter
3. The callback will store encrypted tokens for future use

---

## Customization Guide

### Persona Configuration (src/config/persona.ts)

Create a persona configuration that defines the agent's voice and behavior:

```typescript
export const persona = {
  name: "CryptoInsider",
  bio: "Your AI-powered crypto analyst. Breaking down DeFi, NFTs, and market movements.",

  // Voice characteristics
  voice: {
    tone: "informative yet approachable",
    style: "concise, data-driven, uses relevant emojis sparingly",
    vocabulary: "crypto-native but accessible to newcomers",
    avoid: ["financial advice", "price predictions with specific numbers", "shilling"],
  },

  // Topic focus areas
  topics: [
    "DeFi protocol updates",
    "NFT market trends",
    "Layer 2 developments",
    "Governance proposals",
    "Market analysis",
  ],

  // Hashtag strategy
  hashtags: {
    always: ["#Web3", "#Crypto"],
    rotating: ["#DeFi", "#NFTs", "#Layer2", "#Ethereum", "#Bitcoin"],
    maxPerTweet: 3,
  },

  // Thread settings
  threads: {
    maxLength: 5,
    useNumbering: true,
    endWithCTA: true,
  },
};
```

### Tweet Schedule (data/schedule.json)

Cron-style schedule mapping times (UTC) to tweet types:

```json
{
  "06:00": {
    "type": "market_insight",
    "instruction": "{{persona}} Create a tweet (less than {{maxLength}} characters) analyzing the current crypto market conditions. Focus on major movers and trends."
  },
  "10:00": {
    "type": "educational",
    "instruction": "{{persona}} Create an educational tweet (less than {{maxLength}} characters) explaining a DeFi or Web3 concept in simple terms."
  },
  "14:00": {
    "type": "news_roundup",
    "instruction": "{{persona}} Create a tweet (less than {{maxLength}} characters) summarizing the top 3 crypto news stories of the day."
  },
  "18:00": {
    "type": "project_update",
    "instruction": "{{persona}} Create a tweet (less than {{maxLength}} characters) highlighting an interesting project or protocol update."
  },
  "22:00": {
    "type": "engagement",
    "instruction": "{{persona}} Create an engaging tweet (less than {{maxLength}} characters) that asks the community a thought-provoking question about crypto or Web3."
  }
}
```

Template variables:
- `{{persona}}` — replaced with the persona name/bio context
- `{{maxLength}}` — replaced with character limit (280 or 4000 depending on tier)

### Content Generator (src/services/contentGenerator.ts)

Custom content generation logic that wraps the ChainGPT LLM:

```typescript
import { persona } from "../config/persona";

export async function generateTweetContent(
  type: string,
  instruction: string,
  newsContext?: string
): Promise<string> {
  // Build the prompt with persona context
  const prompt = buildPrompt(type, instruction, newsContext);

  // Call ChainGPT LLM (the existing AgenticOS service handles this)
  // Customize the prompt engineering here

  return prompt;
}

function buildPrompt(type: string, instruction: string, newsContext?: string): string {
  let prompt = instruction
    .replace("{{persona}}", `You are ${persona.name}: ${persona.bio}. Your tone is ${persona.voice.tone}.`)
    .replace("{{maxLength}}", "280");

  if (newsContext) {
    prompt += `\n\nRelevant news context:\n${newsContext}`;
  }

  prompt += `\n\nGuidelines:
- ${persona.voice.style}
- Avoid: ${persona.voice.avoid.join(", ")}
- Include up to ${persona.hashtags.maxPerTweet} relevant hashtags`;

  return prompt;
}
```

### Webhook Configuration (for real-time news tweets)

Register a webhook to receive ChainGPT news events and auto-tweet:

```bash
# Register your webhook URL
curl -X POST http://localhost:8000/api/webhook/register \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://your-domain.com/api/webhook/"}'
```

Subscribe to specific news categories:
```bash
# Subscribe to DeFi (5) and NFT (8) news
curl -X POST https://webapi.chaingpt.org/category-subscription/subscribe \
  -H "api-key: YOUR_CHAINGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"categoryIds": [5, 8]}'
```

Available category IDs for subscription:
| ID | Category |
|----|----------|
| 2 | Blockchain Gaming |
| 3 | DAO |
| 5 | DeFi |
| 8 | NFT |
| 9 | Stablecoins |
| 64 | Cryptocurrency |
| 74 | Web3.0 |
| 78 | Exchange |

---

## AgenticOS API Endpoints Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/login` | Initiate Twitter OAuth 2.0 flow |
| GET | `/api/login/callback` | OAuth callback (handles token exchange) |
| POST | `/api/webhook/register` | Register webhook URL with ChainGPT |
| POST | `/api/webhook/` | Receives incoming ChainGPT news events |

---

## Deployment Options

### Option A: Render (One-Click)

1. Push your customized fork to GitHub
2. Create a new Web Service on Render
3. Set build command: `bun install`
4. Set start command: `bun start`
5. Add all environment variables from `.env`
6. Update Twitter callback URL to your Render domain

### Option B: Self-Hosted (VPS)

```bash
# On your server
git clone https://github.com/YOUR_USER/my-crypto-agent.git
cd my-crypto-agent
curl -fsSL https://bun.sh/install | bash
bun install

# Use PM2 or systemd for process management
npm install -g pm2
pm2 start --interpreter ~/.bun/bin/bun src/index.ts --name crypto-agent
pm2 save
pm2 startup
```

### Option C: Docker

Generate a Dockerfile:
```dockerfile
FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
EXPOSE 8000

CMD ["bun", "start"]
```

```bash
docker build -t my-crypto-agent .
docker run -d --env-file .env -p 8000:8000 my-crypto-agent
```

---

## Twitter API Setup Checklist

- [ ] Create project at https://developer.twitter.com
- [ ] Create an App within the project
- [ ] Enable OAuth 2.0 with PKCE
- [ ] Set client type to Confidential
- [ ] Add callback URL: `https://your-domain.com/api/login/callback`
- [ ] Enable required scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
- [ ] Copy Client ID and Client Secret
- [ ] Complete the OAuth flow by visiting `/api/login`
- [ ] Verify token storage by checking that scheduled tweets post

---

## Credit Costs

- Each tweet generated via ChainGPT LLM costs 1 credit (0.5 base + 0.5 for context)
- News webhook events are free (they trigger content generation which costs credits)
- At 5 tweets/day: ~150 credits/month (~$1.50/month)

---

## Troubleshooting

- **OAuth callback fails:** Ensure the callback URL in Twitter dev portal exactly matches your server URL including protocol (https vs http)
- **Tweets not posting:** Check that all 4 OAuth scopes are enabled and tokens are not expired
- **Empty tweets:** Verify CHAINGPT_API_KEY is valid and has sufficient credits
- **Schedule not triggering:** Times in schedule.json are UTC; verify your server timezone
