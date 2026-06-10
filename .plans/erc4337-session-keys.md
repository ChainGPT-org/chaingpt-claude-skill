I have everything needed — repo patterns, branch code, and verified on-chain/contract facts. Here is the complete plan.

---

# Implementation Plan: ERC-4337 Session Keys (v1.21.0)

> Authored 2026-06-10 by the Plan agent (full repo read on `feat/solana-signing-parity` + live web/contract-source research), saved verbatim. Start: `git checkout main && git checkout -b feat/erc4337-session-keys` (after PR #76 merges; baseline = 134 tools / 391 vitest — re-verify counts at branch time since `feat/x402-fetch` may land first). Target: 134 → 139 tools.

**Goal:** Graduate the trust story from "our code enforces the caps" to "the chain enforces the caps even if the machine is compromised." The user's smart account grants the agent's existing EOA a scoped on-chain session: per-token cumulative spend caps, target+selector allowlists, time bounds, usage caps — all enforced by audited validator modules at EntryPoint validation time. The local policy gate (`checkPolicy`) stays in front: local caps AND chain caps, defense in depth. Custody-free throughout: we build grant/revoke payloads, the user signs externally; the agent signs only with its own bounded session key from the existing keystore.

## 0. Decision record — stack choice (design Q1, evidence-based)

**Chosen: the ERC-7579 Smart Sessions module (`erc7579/smartsessions`, co-authored by Rhinestone + Biconomy) at its deterministic cross-chain address, with Biconomy Nexus as the v1 reference account. Zero new npm dependencies — everything encodes with viem (already `^2.49.3`).**

| Criterion | Smart Sessions (chosen) | ZeroDev Kernel permissions | Safe (4337Module + modules) |
|---|---|---|---|
| Cumulative per-token spend cap on-chain | **Yes** — `ERC20SpendingLimitPolicy` keeps `alreadySpent + approvedAmount ≤ spendingLimit` per token per permission, decoding `transfer/transferFrom/approve/increaseAllowance` calldata (verified in source) | **No cumulative policy.** CallPolicy = per-call param conditions only; RateLimit = count/interval. Bounded ≠ metered | AllowanceModule has real per-token windows but is **not 4337** (delegate EOA calls directly); via Safe7579 adapter it just uses Smart Sessions anyway |
| Target/selector allowlist | Yes — `ActionData(target, selector, policies[])`; unregistered actions fail validation | Yes (CallPolicy) | Via Smart Sessions on Safe7579 |
| Time bounds | Yes — `TimeFramePolicy` feeds `validUntil/validAfter` into 4337 validationData (EntryPoint enforces) | Yes (TimestampPolicy) | Via Smart Sessions |
| EntryPoint v0.7 (matches our shipped foundation) | Yes | Yes (Kernel v3.1+) | Safe4337Module v0.3 yes |
| Audit maturity | 5 reports in-repo: ChainLight, Ackee v1 + update, Cantina core + external-policies; v1.0.0 released Dec 2024, stable since | Kernel audited (ChainLight, Kalos); permission contracts vendor-specific | Safe contracts best-audited in class, but the session-expressive path still routes through Safe7579 (Ackee-audited adapter) + Smart Sessions |
| Custody-free grant payload buildable without vendor SDK/cloud | **Yes** — `enableSessions(Session[])` / `installModule` calldata + userOp; owner signs the userOpHash externally via existing `chaingpt_aa_userop_hash` | Grant flow is SDK-centric (`serializePermissionAccount` approval); possible but vendor-coupled | Heavier: adapter install choreography first |
| Vendor neutrality | Module works on Nexus, Kernel v3, Safe7579 — one integration, three account vendors; matches the no-lock-in stance already written in `lib/erc4337.ts`'s header | Locks to Kernel | Locks to Safe |
| Agent-side signature encoding | Trivial, pure: `encodePacked(0x00, permissionId, ecdsaSig)` (USE mode, verified in module-sdk source) | Kernel nonce-key + sig prefix encoding, vendor-specific | n/a |

Rejected alternates, for the record: **MetaMask Advanced Permissions (ERC-7715/7710)** — still experimental, Snaps Sepolia-only as of early 2026; revisit as a wallet-UX layer later. **`@rhinestone/module-sdk`** as a dependency — it is in maintenance mode (0.4.0, features moved to `@rhinestone/sdk`) and the smartsessions repo is AGPL-3.0; we vendor only ABI fragments + deterministic addresses + our own viem encoders (facts, not code), keeping the plugin MIT-clean and dependency-free.

**Pinned constants (verify by `eth_getCode` at impl time — see Q1):** SmartSession `0x00000000008bDABA73cD9815d79069c247Eb4bDA` (module-sdk 0.4 pin; an earlier release lives at `0x00000000002B0eCfbD0496EE71e01257dA0E37DE` and is confirmed on Base Sepolia — pin exactly one after bytecode check); `ERC20SpendingLimitPolicy 0x000000000033212e272655d8a22402db819477a6` (module-sdk calls it SPENDING_LIMITS_POLICY); `TimeFramePolicy 0x0000000000D30f611fA3bf652ac6879428586930`; `UsageLimitPolicy 0x00000000001d4479FA2A947026204d0283ceDe4B`; `ValueLimitPolicy 0x000000000021dC45451291BCDfc9f0B46d6f0278`; `OwnableValidator 0x000000000013fdB5234E4E3162a810F54d9f7E98` (doubles as the stateless session validator: `validateSignatureWithData(hash, sig, abi.encode(threshold, owners[]))` — verified in core-modules source).

## 1. Architecture summary

The agent's existing secp256k1 EOA (from `lib/agent-keystore.ts`, unchanged) becomes the session key. Grant = the user's smart account enables a `Session{ sessionValidator: OwnableValidator, sessionValidatorInitData: abi.encode(1, [agentAddress]), salt, userOpPolicies: [TimeFrame, UsageLimit?], actions: [{token, transfer-selector, [ERC20SpendingLimitPolicy, …]}, …] }` on the SmartSession module. We build that as calldata + a ready-to-sign userOp; the user signs the userOpHash with their owner key (existing custody-free flow); a new `chaingpt_aa_submit_userop` proxies `eth_sendUserOperation`. `permissionId = keccak256(abi.encode(sessionValidator, sessionValidatorInitData, salt))` — pure, computed locally. Agent-side: a new `chaingpt_agent_wallet_4337_sign_and_send` builds `execute(single, target, value, data)` userOps with nonce key `[3 zero bytes][0x00][SmartSession address]` (Nexus NonceLib layout, verified in source), runs the existing local policy gate first (new fail-closed `erc4337` sub-policy + the standard EVM `checkPolicy` on the inner intent), signs the v0.7 userOpHash with `loadAccount()`, wraps it `0x00 ++ permissionId ++ sig`, submits via the admin-supplied bundler URL, journals to the activity ledger. The chain refuses anything outside the granted scope at validation time — even if the local policy file says `unrestricted: true`. That asymmetry is the headline demo.

## 2. Files to create

### 2.1 `mcp-server/src/lib/erc7579.ts` (~200 lines)
Account-side primitives, account-vendor-aware:
```ts
export const ERC7579_EXECUTE_SELECTOR = '0xe9ae5c53';            // execute(bytes32,bytes)
export const MODULE_TYPE_VALIDATOR = 1n;
export function encodeSingleExecute(target: Address, value: bigint, data: Hex): Hex;
  // execute(bytes32(0) /* CALLTYPE_SINGLE+EXECTYPE_DEFAULT */, abi.encodePacked(target, value, data))
export function encodeInstallModule(module: Address, initData: Hex): Hex;     // installModule(1, module, initData)
export function nexusNonceKey(validator: Address): bigint;
  // uint192: [3 bytes 0][1 byte 0x00 MODE_VALIDATION][20 bytes validator] — Nexus NonceLib layout
export const ENTRYPOINT_GET_NONCE_ABI; export const ACCOUNT_ID_ABI; export const IS_MODULE_INSTALLED_ABI;
export async function readAccountId(rpcs: string[], account: Address): Promise<string>;   // ERC-7579 accountId()
export type AccountKind = { kind: 'nexus'; version: string } | { kind: 'kernel' | 'safe' | 'unknown'; raw: string };
export function classifyAccountId(id: string): AccountKind;   // 'biconomy.nexus.1.x' → nexus; v1 signs only for nexus
```

### 2.2 `mcp-server/src/lib/smart-sessions.ts` (~350 lines)
Module-side pure encoders + readers (the heart of the feature; everything offline-testable):
```ts
export const SMART_SESSIONS_ADDRESS, OWNABLE_VALIDATOR_ADDRESS,
  ERC20_SPENDING_LIMIT_POLICY, TIME_FRAME_POLICY, USAGE_LIMIT_POLICY, VALUE_LIMIT_POLICY: Address;
export interface SessionCaps {
  agentAddress: Address;                       // the session key — agent's existing EOA
  tokenCaps: { token: Address; cap: bigint }[]; // cumulative on-chain per-token (base units)
  targets?: { target: Address; selector: Hex }[]; // extra protocol actions (each gets the token-cap policies? NO — sudo-free action registration; see Q11)
  validUntil: number; validAfter?: number;     // REQUIRED time bound (we refuse unbounded grants)
  maxUses?: bigint; nativeValueCap?: bigint; salt?: Hex;
}
export function buildSession(caps: SessionCaps): Session;          // assembles PolicyData/ActionData structs
export function getPermissionId(session: Session): Hex;            // keccak256(abi.encode(validator, initData, salt))
export function encodeEnableSessions(sessions: Session[]): Hex;    // enableSessions(Session[]) calldata
export function encodeRemoveSession(permissionId: Hex): Hex;       // removeSession(bytes32)
export function encodeUseSignature(permissionId: Hex, sig: Hex): Hex; // encodePacked(0x00, permissionId, sig)
export const MOCK_ECDSA_SIG: Hex;                                  // 65-byte mock for gas estimation
export const SMART_SESSION_READ_ABI;  // isPermissionEnabled(bytes32,address); ERC20 policy getPolicyData(configId,multiplexer,token,sender) → (limit, spent, approved)
export interface SessionRecord { account: Address; chainId: number; permissionId: Hex; session: SessionJson; createdAt: string; }
export function sessionsCachePath(): string;   // join(dirname(policyPath()), 'sessions-4337.json')
export function appendSessionRecord(r: SessionRecord): void;  export function readSessionRecords(): SessionRecord[];
  // NON-AUTHORITATIVE convenience cache (0600). Chain is the source of truth; status tool re-verifies on-chain.
```

### 2.3 `mcp-server/src/tools/aa_sessions.ts` (~450 lines) — 3 custody-free tools
```ts
export const aaSessionTools: Tool[] = [
  { name: 'chaingpt_aa_session_build_grant',
    // inputs: chain (slug, resolveChainWithCustom — testnets via custom-chains), account (user SCW),
    //   agentAddress (default: keystore address if initialized), tokenCaps[{token, cap}], targets?[{target, selector}],
    //   validUntil (REQUIRED — refuse unbounded), validAfter?, maxUses?, nativeValueCapWei?, salt?,
    //   bundlerUrl? (if given: fetch nonce + estimate and emit a fully-populated unsigned userOp),
    //   factory?/factoryData? (passthrough for counterfactual accounts — we do not compute them)
    // output: permissionId; raw enableSessions calldata; execute()-wrapped account callData;
    //   (if module not installed, detected via isModuleInstalled eth_call: installModule calldata embedding the session);
    //   unsigned userOp JSON + userOpHash + "sign this externally, then chaingpt_aa_submit_userop" instructions;
    //   appends SessionRecord to the local cache
  },
  { name: 'chaingpt_aa_session_build_revoke' },   // same shape: removeSession(permissionId) calldata + wrapped userOp
  { name: 'chaingpt_aa_session_status' },
    // read-only eth_call fan-out: accountId(), isModuleInstalled(SmartSession), isPermissionEnabled(permissionId, account),
    // per-token getPolicyData → limit/spent/approved/REMAINING table, time window, usage count;
    // falls back to cached SessionRecords when args omitted; prints local-vs-chain cap comparison
];
export async function handleAaSessionTool(name, args): Promise<...>;
```
Schema-key discipline: the custody invariant regex (`aa.test.ts:50`) bans keys matching `sessionkey|session_key|signer\b|privatekey|…`. Use `agentAddress`, `account`, `permissionId`, `tokenCaps` — and extend the invariant test to walk `aaSessionTools` + the new agent tool too.

### 2.4 `mcp-server/src/tools/agent_wallet_4337.ts` (~400 lines) — 1 tool
```ts
{ name: 'chaingpt_agent_wallet_4337_sign_and_send',
  inputSchema: { properties: {
    chain: { type: 'string' },                  // no enum — custom chains (Base Sepolia) allowed
    account: { type: 'string' },                // user's SCW (the userOp sender)
    permissionId: { type: 'string' },
    target: { type: 'string' }, valueWei: { type: 'string', default: '0' }, data: { type: 'string', default: '0x' },
    bundlerUrl: { type: 'string' },             // admin-supplied, never stored
    memo: { type: 'string' }, waitForReceipt: { type: 'boolean', default: true },
    maxFeePerGas/maxPriorityFeePerGas: { type: 'string' },  // optional overrides
  }, required: ['chain', 'account', 'permissionId', 'target', 'bundlerUrl'] } }
```
**Handler flow (security-critical sequence, mirroring `agent_wallet_solana` §1.2 of the v1.19 plan):**
1. `isKeystoreInitialized()` or refuse with init hint.
2. **Cheap pre-RPC short-circuits:** `killSwitch` / `policy.erc4337?.enabled !== true` → refuse without touching the network.
3. `checkErc4337Gate({ account, bundlerUrl }, policy)` — account allowlist + bundler-host allowlist (new, §3.1).
4. Resolve chain via `resolveChainWithCustom`; read `accountId()`; refuse non-Nexus kinds in v1 with an explicit "v1 supports biconomy.nexus.1.x" error (Kernel/Safe7579 = follow-up).
5. Build `callData = encodeSingleExecute(target, value, data)`; nonce = `EntryPoint.getNonce(account, nexusNonceKey(SMART_SESSIONS_ADDRESS))` via existing `jsonRpcFallback`.
6. Estimate via `bundlerRpc eth_estimateUserOperationGas` with `signature = encodeUseSignature(permissionId, MOCK_ECDSA_SIG)`; fold estimates in; fees from RPC (`eth_maxPriorityFeePerGas` + `eth_feeHistory`-derived base, +25%) unless overridden.
7. **Local policy gate (the AND-composition):** `checkPolicy({ chainId, to: target, value, data, gas: callGasLimit, memo }, policy, spendStats(24, 'evm'))` — kill switch, chain/address allowlists, value cap, selector blocklist, velocity caps, memo all apply to the **inner execution**. Refusal uses the established ⛔ block format.
8. Sign: `loadAccount()`; `computeUserOpHash({ userOp, entryPoint: ENTRY_POINT_V07, chainId })` (existing lib); ECDSA per OwnableValidator's expected scheme (raw-hash vs EIP-191 — verify against `CheckSignatures.recoverNSignatures` at impl, Q2); `userOp.signature = encodeUseSignature(permissionId, sig)`.
9. Submit `eth_sendUserOperation`; on bundler validation rejection (AA22 / SmartSession policy revert), render a distinct "**chain-side refusal** — the on-chain session caps blocked this even though local policy allowed it" message (this is the product moment; map common AA error codes).
10. Optional receipt poll (reuse `handleUserOpReceipt` internals); journal `logActivity({ chain: chainSlug, chainId, from: agentAddress, to: target, valueWei, hash: userOpHash (tx hash when receipt arrives), memo, policyDigest })` — counts toward the EVM wei velocity window.
11. Output: userOpHash, tx hash, explorer link, inner target/value, permissionId, remaining on-chain token caps (one `getPolicyData` call), policy digest.

### 2.5 Tests — `__tests__/smart_sessions.test.ts`, `__tests__/aa_sessions.test.ts`, `__tests__/agent_wallet_4337.test.ts` (see §4)

## 3. Files to modify

### 3.1 `mcp-server/src/lib/agent-policy.ts`
```ts
export interface Erc4337Policy {
  enabled: boolean;                 // master opt-in. Missing/false ⇒ refuse (fail closed) — solana precedent, Q3
  allowedAccounts?: string[];       // SCW sender allowlist (lowercase hex). undefined ⇒ any; [] ⇒ none
  allowedBundlerHosts?: string[];   // hostname allowlist for bundlerUrl. undefined ⇒ any https host
}
// AgentPolicy gains: erc4337?: Erc4337Policy;
export function checkErc4337Gate(intent: { account: string; bundlerUrl: string }, policy?: AgentPolicy): PolicyCheck;
```
Rule order: killSwitch → refuse; `erc4337?.enabled !== true` (type-strict) → refuse; `unrestricted` → allow (after enabled, matching the Solana rationale: YOLO was granted per-surface); allowedAccounts (undefined/[] semantics identical to `allowedToAddresses`); allowedBundlerHosts (parse URL, https required). The inner intent then goes through the **unchanged** `checkPolicy` — no second EVM gate to drift. Also: `ALLOWED_POLICY_FIELDS += 'erc4337'` (mandatory or dashboard saves reject it), `validatePolicyInput` sub-object validation, `FAIL_CLOSED_POLICY += erc4337: { enabled: false }`, `DEFAULT_POLICY += erc4337: { enabled: false }` (**off by default** — unlike Solana, this surface acts on someone else's account; opt-in is the right default), template updates in `agent-policy-templates.ts` (balanced/locked-down `{enabled:false}`, unrestricted `{enabled:true}`, show-all-knobs everything).

### 3.2 `mcp-server/src/tools/aa.ts` — add the 5th foundation tool
```ts
{ name: 'chaingpt_aa_submit_userop' }   // inputs: bundlerUrl, userOp (USEROP_PROPS, signature REQUIRED non-empty), entryPoint?
```
Refuses empty/missing `signature` ("custody-free: sign externally first"). This deliberately retires the "why we don't ship eth_sendUserOperation" stance — the session-grant loop needs it, and the mainnet-guard hook gains an ask on it (§3.4). Update the SKILL.md rationale honestly (§3.5). Also switch `chainIdFor` to `resolveChainWithCustom` so userOpHash works for admin-registered testnets (additive).

### 3.3 `mcp-server/src/index.ts`
Register `...aaSessionTools` + `...agentWallet4337Tools`. Routing ORDER (before less-specific prefixes):
```ts
if (name.startsWith('chaingpt_agent_wallet_4337')) return handleAgentWallet4337Tool(name, args);
if (name.startsWith('chaingpt_agent_wallet_solana')) ...   // existing
if (name.startsWith('chaingpt_agent_wallet')) ...          // existing
if (name.startsWith('chaingpt_aa_session')) return handleAaSessionTool(name, args);
if (name.startsWith('chaingpt_aa_')) ...                   // existing
```
Version → 1.21.0.

### 3.4 `hooks/mainnet-guard.js` — two new explicit branches (existing regexes do NOT match): `/chaingpt_agent_wallet_4337_sign_and_send$/` and `/chaingpt_aa_submit_userop$/` → ask.

### 3.5 Docs/skills/version
- `skills/aa/SKILL.md`: rewrite the "Foundation vs session-key flow" + "does NOT do (yet)" sections — session issuance now SHIPPED via Smart Sessions (vendor-neutral, supersedes the per-vendor `chaingpt_aa_safe_*`/`chaingpt_aa_kernel_*` queue note); document grant → sign → submit → status → agent-use loop; keep the "plugin never sees the OWNER key" invariant front and center.
- `skills/agent-wallet/SKILL.md`: new "On-chain caps (ERC-4337 session keys)" section — threat-model graduation table (local gate vs chain gate; what each survives: prompt injection / policy-file tamper / full host compromise → only chain caps survive the last one, bounded by remaining allowance + expiry), composition recipe, revoke-on-incident runbook.
- README roadmap: check off "Per-provider ERC-4337 session-key issuance" (note the vendor-neutral pivot + Safe/Kernel follow-ups); all tool-count sites + badge 134→139; CHANGELOG 1.21.0; VERSION/plugin.json/marketplace.json/package.json; TESTING.md Base Sepolia recipe (§4 Live).

## 4. Test matrix (~40 new cases, all offline unless marked)

Pattern: tmp dirs + `CHAINGPT_DISABLE_KEYCHAIN=1` + env-pointed keystore/policy/activity/sessions files (as `agent_wallet.test.ts:8-26`).

**lib/smart-sessions + erc7579 (pure):** 1 `getPermissionId` golden vector (seed from the live Base Sepolia exercise, then frozen — guards encoder drift) · 2 `encodeUseSignature` layout = 1+32+65 bytes, decode round-trip · 3 `buildSession` → `encodeEnableSessions` decodes via viem `decodeFunctionData` with all PolicyData/ActionData fields intact · 4 token-cap initData = `abi.encode(address[],uint256[])` exact match · 5 TimeFrame initData = packed uint48 pair; refuse `validUntil: 0`/past · 6 `nexusNonceKey` bit layout (validator at bits 64..223, mode byte zero) · 7 `encodeSingleExecute` selector + packed tail · 8 `classifyAccountId` matrix (nexus/kernel/safe/unknown) · 9 sessions cache: 0600, append/read round-trip, corrupt file → `[]` (never throws).

**Policy gate:** 10 `erc4337` absent / `enabled:false` / `enabled:"true"` (string) → refuse — migration guarantee for every existing policy file · 11 killSwitch wins over unrestricted · 12 unrestricted (+enabled) allows gate · 13 allowedAccounts undefined/[]/match/case-insensitivity · 14 allowedBundlerHosts host parse, http refused · 15 `validatePolicyInput` accept/reject matrix incl. unknown sub-fields · 16 FAIL_CLOSED + DEFAULT policy contain `erc4337` · 17 `policyDigest` differs across erc4337 sub-policies (deep-canonical regression).

**Tools:** 18 tool surface (5 new names registered, routed, schemas valid) · 19 custody invariant extended: walk `aaSessionTools` + 4337 tool schemas against FORBIDDEN · 20 `chaingpt_aa_submit_userop` refuses empty signature · 21 grant builder refuses missing validUntil / bad token address / cap=0 (mirrors `InvalidLimit` on-chain) · 22 grant output contains permissionId + calldata + userOpHash instructions (mocked RPC for isModuleInstalled both branches: enableSessions vs installModule) · 23 revoke calldata decode · 24 4337 sign_and_send: keystore-missing hint · 25 disabled policy refuses pre-RPC (assert zero fetch calls — spy on `httpJson`) · 26 non-Nexus accountId refusal text · 27 inner-intent refusal (value cap exceeded) renders ⛔ with policy digest · 28 chain-side AA22/validation-revert mapped to the "chain refused" message · 29 ledger entry written with userOpHash + counts in `spendStats(24,'evm')` · 30 hook asks on both new tools (`echo | node hooks/mainnet-guard.js`) · 31 existing aa.test.ts suite still green (foundation untouched except additive tool).

**Live (manual, TESTING.md "Base Sepolia session-key recipe"):** add Base Sepolia as a custom chain (84532, `https://sepolia.base.org`) — no chains.ts change; create/fund a Nexus v1.x account (one-off documented script or Biconomy SDK outside the plugin) + deploy a mock ERC-20; grant with 100-token cap, 24h expiry, transfer-only action via build_grant → owner signs → `chaingpt_aa_submit_userop` (Pimlico Base Sepolia v0.7) → `session_status` shows enabled + remaining=100; agent sends 40 (succeeds), 40 (succeeds), 40 (**chain refuses** — cumulative 120 > 100); **headline test:** set local policy `unrestricted:true` + `erc4337.enabled:true`, retry the over-cap transfer → bundler/EntryPoint still refuses → screenshot for README; expiry refusal after validUntil; revoke → AA refusal; freeze the live permissionId/digest as the golden vectors for tests 1–4. Record whether the Nexus registry required Rhinestone attestations for `installModule` (Q6).

## 5. Gates

`npm run build` · `npm test` (391 → ~431) · `./scripts/test-all.sh --fast` (version-consistency layer catches the 134→139 sites) · full `test-all.sh` before merge · boot-layer smoke catches routing mistakes · live Base Sepolia loop completed once before tagging 1.21.0 (the on-chain-refusal proof is the release claim; do not ship the claim untested).

## 6. Open questions — recommended answers

**Q1 Which SmartSession deployment to pin?** Two candidates exist (`…2B0e…37DE` v1-release era, confirmed on Base Sepolia; `…8bDA…4bDA` pinned by module-sdk 0.4). Resolve at impl: `eth_getCode` both on Base Sepolia + Base mainnet, match against the smartsessions v1.0.0 release artifacts and Rhinestone docs deployments page; pin one constant + record its codehash in TESTING.md. **Q2 ECDSA scheme for OwnableValidator-as-session-validator** (raw userOpHash vs EIP-191): read `CheckSignatures.recoverNSignatures` source at impl; the Base Sepolia e2e is the arbiter; if both verify, prefer raw `account.sign({hash})`. **Q3 separate `erc4337.enabled` opt-in?** Yes — fail-closed, solana precedent; default **false** even in the balanced template (this surface spends from a third-party account). **Q4 do 4337 sends count against EVM wei velocity caps?** Yes — same ledger, `'evm'` class; note honestly that ERC-20 outflows journal `valueWei: innerValue` (usually 0) — the **chain** caps are the token fence, exactly the inversion this feature exists for. **Q5 ship `eth_sendUserOperation`?** Yes, as custody-free `chaingpt_aa_submit_userop` (signature required, hook-guarded); update SKILL.md's old rationale explicitly rather than silently. **Q6 Nexus registry attestation blocks installModule?** Possible on some factories; live test records the answer; fallback documented (factory with registry checks disabled, or pre-attested module — Rhinestone attests Smart Sessions on major chains). **Q7 ENABLE mode (enable+use in one userOp)?** Defer — explicit on-chain `enableSessions` grant is simpler, immediately status-readable, and avoids the EIP-712 multichain digest machinery. **Q8 EntryPoint v0.8 / EIP-7702 / Nexus ≥1.2?** Out of scope; `classifyAccountId` refuses unknown majors with a clear message; foundation stays v0.7. **Q9 paymaster sponsorship?** Pass-through fields only (already in USEROP_PROPS); `pm_sponsorUserOperation` is a follow-up. **Q10 who deploys the user's account?** Not us — TESTING.md recipe + optional factory/factoryData passthrough in build_grant. **Q11 do extra protocol `targets` get spend policies?** v1: extra targets get TimeFrame+UsageLimit only and a loud warning that token movements they cause are fenced solely by approval caps — recommend granting token-transfer actions only until UniversalActionPolicy support lands (follow-up).

## 7. What is genuinely enforceable on-chain (design Q4, no marketing)

Enforced at EntryPoint validation by audited contracts: cumulative per-token ERC-20 spend (`transfer/transferFrom/approve/increaseAllowance` decoded; spent+approved accounted together; max-allowance approvals revert by design), target+selector action scoping (anything unregistered fails validation), time windows (via validationData — the EntryPoint itself enforces), usage counts, cumulative native-value caps. **Not** enforced / honest caveats (document verbatim in SKILL.md): third-party contracts pulling via previously granted allowances are metered only at `approve` time; calls value≠0 to token targets are refused by the spend policy (native transfers need ValueLimitPolicy + a registered empty-selector action); USD-denominated caps remain local-only; per-day *resets* don't exist in ERC20SpendingLimitPolicy (caps are per-grant totals — re-grant to refresh; local velocity caps remain the rolling-window control); gas griefing bounded by the account's ETH/paymaster, SimpleGasPolicy deferred.

## 8. Sequencing (two PRs, commits each green)

**PR A — libs + policy (no user-facing surface):** 1 `feat(lib): erc7579 primitives — execute/installModule encoding, Nexus nonce key, accountId classifier` (tests 6–8) · 2 `feat(lib): smart-sessions encoders — Session builder, permissionId, USE signature, read ABIs, sessions cache` (tests 1–5, 9) · 3 `feat(policy): erc4337 sub-policy + checkErc4337Gate, fail-closed + templates + validation` (tests 10–17).
**PR B — tools + docs:** 4 `feat(aa): chaingpt_aa_submit_userop + custom-chain resolution` (tests 20, 31) · 5 `feat(tools): aa_session build_grant/build_revoke/status` (tests 18–19, 21–23) · 6 `feat(tools): agent_wallet_4337_sign_and_send + routing + hook` (tests 24–30) · 7 `docs+version: 1.21.0 — CHANGELOG, SKILL.md rewrites, TESTING recipe, counts 139` (after the live Base Sepolia loop; embed golden vectors + screenshot).

## 9. Honest v1 scope cuts

One module stack (Smart Sessions; Safe7579 + Kernel agent-side signing = follow-ups with the same lib), one reference account (Nexus 1.x), one chain exercised live (Base Sepolia; mainnet Base next), single-call executions only (no batch — approve+swap needs two ops), ERC-20 transfer caps as the flagship policy (UniversalActionPolicy param rules deferred), no ENABLE-mode, no paymaster issuance, no account deployment, no dashboard panel (status tool text + skill docs only — dashboard precedent: defer, like Solana's form section).

### Critical Files for Implementation
- /Users/r/code/chaingpt-claude-skill-audit/mcp-server/src/lib/erc4337.ts (foundation reused as-is: hash/pack/bundlerRpc)
- /Users/r/code/chaingpt-claude-skill-audit/mcp-server/src/tools/aa.ts (gains submit_userop; custody-invariant test pattern lives in its test)
- /Users/r/code/chaingpt-claude-skill-audit/mcp-server/src/lib/agent-policy.ts (erc4337 sub-policy + gate, ALLOWED_POLICY_FIELDS, templates sibling)
- /Users/r/code/chaingpt-claude-skill-audit/mcp-server/src/tools/agent_wallet.ts (handler/⛔/ledger/RPC-fallback patterns to mirror; spendStats call sites)
- /Users/r/code/chaingpt-claude-skill-audit/mcp-server/src/index.ts (tool registration + prefix routing order) and /Users/r/code/chaingpt-claude-skill-audit/hooks/mainnet-guard.js (two new ask branches)

Sources: [ZeroDev permissions docs](https://docs.zerodev.app/sdk/permissions/intro) · [ZeroDev SDK policies (GitHub)](https://github.com/zerodevapp/sdk) · [erc7579/smartsessions repo + audits + ERC20SpendingLimitPolicy source](https://github.com/erc7579/smartsessions) · [Rhinestone module-sdk source (constants, types, usage, policies)](https://github.com/rhinestonewtf/module-sdk) · [Rhinestone Smart Sessions overview](https://docs.rhinestone.dev/smart-wallet/smart-sessions/overview) · [Ackee Safe7579 audit summary](https://ackee.xyz/blog/rhinestone-erc-7579-safe-adapter-audit-summary/) · [Biconomy Nexus repo + audits + NonceLib source](https://github.com/bcnmy/nexus) · [Nexus CodeHawks competition](https://codehawks.cyfrin.io/c/2024-07-biconomy) · [SmartSession on Base Sepolia (Blockscout)](https://base-sepolia.blockscout.com/address/0x00000000002B0eCfbD0496EE71e01257dA0E37DE?tab=contract) · [Rhinestone core-modules OwnableValidator source](https://github.com/rhinestonewtf/core-modules) · [MetaMask ERC-7715 docs (experimental status)](https://docs.metamask.io/delegation-toolkit/0.12.0/experimental/erc-7715-request-permissions/)