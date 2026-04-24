# AgenticOS — Open-Source Web3 AI Agent for X/Twitter

## Overview

- **Type:** Open-source TypeScript framework on Bun runtime
- **Purpose:** Autonomously generates and posts tweets for Web3 projects
- **AI Engine:** ChainGPT LLM (1 credit per tweet)
- **GitHub:** https://github.com/ChainGPT-org/AgenticOS

## Requirements

- Bun v1.0+, Node.js LTS
- Twitter API OAuth 2.0 (Client ID + Secret)
- ChainGPT API Key
- Encryption credentials: 32-character key, salt (hex), IV (hex)

## Environment Variables (.env)

```
PORT=8000
NODE_ENV=development
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
ENCRYPTION_KEY=          # 32 characters
ENCRYPTION_SALT=         # hex
ENCRYPTION_IV=           # hex
CHAINGPT_API_KEY=
PASSWORD_AUTH=
```

## Installation

```bash
git clone https://github.com/ChainGPT-org/AgenticOS.git && cd AgenticOS
curl -fsSL https://bun.sh/install | bash
bun install && bun start
```

## Tweet Schedule Format (data/schedule.json)

```json
{
  "05:10": {
    "type": "market_insight",
    "instruction": "{{persona}} Create a tweet (less than {{maxLength}} characters) about crypto market."
  }
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/login` | Initiates Twitter OAuth 2.0 |
| GET | `/api/login/callback` | OAuth callback |
| POST | `/api/webhook/register` | Register webhook URL with ChainGPT |
| POST | `/api/webhook/` | Receives ChainGPT news events |

## ChainGPT Webhook APIs

| Method | URL | Description |
|--------|-----|-------------|
| GET | `https://webapi.chaingpt.org/category-subscription/` | List categories + subscriptions (header: `api-key`) |
| POST | `https://webapi.chaingpt.org/category-subscription/subscribe` | Subscribe to categories: `{"categoryIds": [2, 3]}` |

## Twitter Developer Setup

1. Go to developer.twitter.com and create a Project & App with OAuth 2.0
2. Set callback URL: `https://your-domain.com/api/login/callback`
3. Client Type: **Confidential**
4. Required scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
5. Character limits: Free = 280 chars, X Premium = 4,000 chars

## Project Structure

```
AgenticOS/
  data/
    schedule.json
  src/
    config/
    controllers/
    jobs/
    routes/
    services/
    types/
    utils/
    index.ts
```

## Deployment

One-click deploy on Render:

1. Fork the repository
2. Go to `render.com/deploy?repo=YOUR_FORK`
3. Configure environment variables
4. Deploy
