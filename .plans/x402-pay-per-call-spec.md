# x402 Pay-Per-Call for the ChainGPT API — Integration Spec (v1)

> For the api.chaingpt.org backend team. Plugin-side counterpart ships as `chaingpt_x402_fetch` (v1.20).
> Goal: an AI agent pays $0.01 USDC per call with ZERO signup — no account, no credit purchase, no API key.
> This makes ChainGPT the first major AI API that agents can pay autonomously.

## Why

Today the revenue loop has a human bottleneck: sign up → buy credits → export a key → restart the agent.
x402 (Coinbase's HTTP 402 standard, already supported by the plugin's client tools) removes it:
the API answers `402 Payment Required` with machine-readable PaymentRequirements; the agent signs an
EIP-3009 USDC `transferWithAuthorization` (off-chain signature, no gas for the payer), retries with an
`X-PAYMENT` header; a facilitator verifies + settles on Base. Credits remain for humans; x402 is the
agent-native lane.

## Server-side changes (api.chaingpt.org)

1. **402 challenge.** On requests lacking BOTH a valid API key AND an `X-PAYMENT` header, paid endpoints
   return HTTP 402 with the standard body (the plugin's `chaingpt_x402_create_requirements` shows the
   exact shape):
   ```json
   { "x402Version": 1, "accepts": [{
       "scheme": "exact", "network": "base",
       "maxAmountRequired": "10000",            // 0.01 USDC, 6 decimals — mirror of 1 credit
       "resource": "https://api.chaingpt.org/chat/stream",
       "payTo": "<CHAINGPT_TREASURY_ADDRESS>",
       "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
       "maxTimeoutSeconds": 60,
       "extra": { "name": "USD Coin", "version": "2" }
   }], "error": "X-PAYMENT header is required" }
   ```
2. **Pricing map.** Start 1:1 with credits: chat/audit/news = 1 credit = `10000` (0.01 USDC).
   NFT generation tiers map the same way (velogen 0.5 credit → `5000`, etc). One env-driven table.
3. **Verification + settlement.** Use a facilitator (Coinbase's hosted facilitator on Base mainnet, or
   self-host the open-source one) — `POST /verify` per request (fast, off-chain signature check), then
   `POST /settle` (broadcasts the authorization; the facilitator can never alter amount or payee).
   Settle ASYNC in a worker queue; respond to the API call as soon as /verify passes.
4. **Replay protection.** EIP-3009 nonces are single-use on-chain, but verify-then-settle-async means
   the API must keep a short-lived cache (Redis, TTL = validBefore) of seen `(from, nonce)` pairs and
   reject duplicates at /verify time. The facilitator's /verify also enforces validAfter/validBefore.
5. **Failure semantics.** /verify fail → 402 with `error` detail. /settle fail later (insufficient
   balance moved away) → log + blocklist the payer address for 24h; the loss is bounded to one call.
6. **Rollout.** Phase 1: ONE endpoint (chat) behind a feature flag + staging facilitator on Base
   Sepolia (the plugin's `chaingpt_x402_facilitator action=supported facilitatorUrl=https://x402.org/facilitator`
   already exercises that). Phase 2: all credit-billed endpoints. Phase 3: announce (this is a launch-post-grade feature).

## Plugin-side (ships independently as v1.20)

`chaingpt_x402_fetch` — custody-free orchestrator:
1. GET/POST the URL. 2xx → return the body.
2. 402 → decode PaymentRequirements, build the unsigned EIP-3009 typed data
   (existing `chaingpt_x402_build_payment` logic), return it for the USER to sign + the exact retry recipe.
3. (Follow-up, gated on a policy extension) agent-wallet auto-pay: sign the authorization with the
   agent key inside a new `policy.x402` allowance (per-call USDC cap + daily USDC cap + payee allowlist).
   NOT in v1.20 — USDC value is a new cap dimension; ships only with its own policy fields + tests, same
   fail-closed discipline as the lamport caps.

## Economics sanity

- 0.01 USDC/call on Base: fees are the facilitator's batch-settlement problem, not per-call gas for us.
- Agents skip the 15% CGPT-payment bonus — credits stay strictly cheaper for committed users, so x402
  cannibalizes nothing; it converts users who would otherwise never sign up.
- Revenue attribution: payer address = stable pseudo-identity for rate limiting + abuse control.

## Open questions for the API team

1. Treasury address for `payTo` (suggest a fresh dedicated EOA swept daily).
2. Hosted facilitator (Coinbase, supports Base mainnet, takes a fee) vs self-hosted (open-source, ops burden)?
3. Per-payer rate limits pre-settlement (suggest: 10 unsettled calls max per address).
4. Does the existing gateway stack (AI_API_Engine) make 402-with-body responses awkward anywhere (CDN caching)?
