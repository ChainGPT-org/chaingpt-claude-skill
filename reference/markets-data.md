# Markets Data — Hyperliquid · Polymarket

The 10 read-only market-data tools added in plugin v1.6.0. Live mainnet data; signed order placement is deferred to a follow-up release.

## Hyperliquid (6 tools)

Perpetual futures DEX on Hyperliquid L1 with an Arbitrum bridge. Public REST API at `https://api.hyperliquid.xyz`. All reads use `POST /info` with a JSON `type` discriminator. No API key.

### Tools

| Tool | `type` body | Purpose |
|---|---|---|
| `chaingpt_hl_markets` | `meta` / `spotMeta` | Enumerate perp or spot universe |
| `chaingpt_hl_mids` | `allMids` | Live mid prices (filterable) |
| `chaingpt_hl_orderbook` | `l2Book` | L2 orderbook |
| `chaingpt_hl_account` | `clearinghouseState` | Margin / positions / open orders |
| `chaingpt_hl_fills` | `userFills` | Recent fill history |
| `chaingpt_hl_funding` | `fundingHistory` | Hourly funding rates |

### Common workflow: "how is this wallet doing on HL?"

```text
chaingpt_hl_account user="0x…"
```

Returns: account value, total margin used, withdrawable, every open position with side / size / entry price / unrealized PnL / leverage / liquidation price.

### Funding-rate analysis

```text
chaingpt_hl_funding coin="BTC" hours=24
```

Returns the last 24h of hourly funding plus an auto-computed annualized rate at the bottom. Above ~50% annualized signals overheated long bias; below 0% signals shorts pay longs.

### Signed orders — deferred

Hyperliquid order placement requires EIP-712-signed L1 actions with msgpack-hashed payloads. The custody-free pattern when shipped:
1. `chaingpt_hl_place_order_payload` returns the action + the EIP-712 typed data
2. User wallet signs the typed data
3. `chaingpt_hl_submit_signed_action` broadcasts to `POST /exchange`

## Polymarket (4 tools)

Prediction markets settling on Polygon mainnet. Public APIs at two surfaces:
- `https://gamma-api.polymarket.com` — market discovery, events, search
- `https://clob.polymarket.com` — orderbook, last-trade, midpoint

No API key required for read endpoints.

### Tools

| Tool | API | Purpose |
|---|---|---|
| `chaingpt_pm_markets` | Gamma `/markets` | Market discovery + search |
| `chaingpt_pm_market` | Gamma `/markets?slug=` | Single market detail with CLOB token ids |
| `chaingpt_pm_orderbook` | CLOB `/book?token_id=` | L2 orderbook for one outcome |
| `chaingpt_pm_trades` | CLOB `/trades?token_id=` | Recent fills on one outcome |

### Common workflow: "what is the market saying about X?"

```text
chaingpt_pm_markets search="X" limit=5         # find the most-liquid market
chaingpt_pm_market slug="<from above>"         # read YES + NO token ids + implied prices
chaingpt_pm_orderbook tokenId="<yes-token>"    # confirm depth at the touch
chaingpt_pm_trades tokenId="<yes-token>"       # last 20 fills tell you who's paying up
```

### What makes a market real vs noise

When surfacing a market, lead with:
1. The question
2. Current implied probability (`outcomePrices[0]` for YES)
3. 24h volume (is anyone trading?)
4. Days to resolution
5. Top-of-book spread + depth (is the price tradeable in size?)

A YES at 75% with $50 of depth and $5/day volume = vibes. A YES at 75% with $50k depth and $1M/day volume = real consensus.

### Signed orders — deferred

Polymarket order placement uses 0x v4 limit-order shape with Polymarket-specific exchange contract addresses on Polygon. The custody-free pattern when shipped:
1. `chaingpt_pm_place_order_payload` returns the order + the EIP-712 typed data
2. User wallet signs against the Polymarket exchange contract
3. `chaingpt_pm_submit_signed_order` posts to the CLOB

## ChainGPT integration

Polymarket tools tie into ChainGPT's existing **PredictFi / Foresight AI** surface — same domain (event-outcome markets), but live mainnet data rather than ChainGPT-curated commentary. For Foresight AI's analytical layer, see `chaingpt_news_fetch` filtered to "Prediction" categories.

## Credit accounting

All 10 tools cost **0 ChainGPT credits** — both APIs are free. Credit funnel for these skills comes from upstream `chaingpt_news_fetch` / `chaingpt_intel_token` / `chaingpt_audit_contract` calls the user makes around perps and prediction-market decisions.
