# Implementation Plan: Solana Signing Parity (v1.19.0)

> Authored 2026-06-10 by the Plan agent (full repo read), saved verbatim. Start: `git checkout main && git checkout -b feat/solana-signing-parity`. Target: 131 → 134 tools.

**Goal:** Give the agent wallet the same policy-fenced autonomous execution on Solana that it has on EVM. The existing unsigned-`VersionedTransaction` builders (`chaingpt_dex_jupiter_build_swap_tx`, `chaingpt_defi_marginfi_{deposit,withdraw}_tx`, `chaingpt_defi_kamino_{deposit,withdraw}_tx`, `chaingpt_solana_build_transfer_tx`) become autonomously executable inside hard caps via a new `chaingpt_agent_wallet_solana_sign_and_send` tool.

## 0. Architecture summary

A second Ed25519 keystore (`solana-keystore.json`) encrypted with the **same** AES-256-GCM + scrypt scheme and the **same** passphrase source (`lib/agent-secret.ts` — env var or OS keychain; no new keychain entry). A `solana` sub-object on `AgentPolicy` validated by `validatePolicyInput`, editable only via the existing localhost admin UI / text editor (no MCP write surface). One deterministic chokepoint `checkSolanaPolicy()` in `lib/agent-policy.ts`: global kill switch wins, `solana.enabled` must be true (fail closed for every pre-existing policy file), program-id allowlist over all top-level instruction program ids, per-tx lamport cap enforced via `simulateTransaction` fee-payer balance delta (refuse on sim failure — fail closed), velocity caps from the shared `activity.jsonl` ledger with a new chain-class filter so wei and lamports never sum together. The PreToolUse mainnet-guard hook asks on the new send tool, same as EVM.

## 1. Files to create

### 1.1 `mcp-server/src/lib/agent-keystore-solana.ts` (~150 lines)

Mirror of `agent-keystore.ts` for Ed25519. Reuses `resolvePassphrase` / `provisionKeychainPassphrase` / `detectKeychainBackend` from `lib/agent-secret.ts` unchanged (same keychain entry `chaingpt-mcp-agent-wallet` — one passphrase for both keystores; deliberate, document in file header).

```ts
import { Keypair } from '@solana/web3.js';
import type { SecretSource } from './agent-secret.js';

export interface SolanaKeystoreFile {
  version: 1;
  curve: 'ed25519';
  address: string;            // base58 public key
  ciphertext: string;         // base64 — encrypted 64-byte secretKey
  iv: string; salt: string; authTag: string;  // base64
  kdf: 'scrypt'; kdfN: number; cipher: 'aes-256-gcm';
  createdAt: string;
}

export function solanaKeystorePath(): string;
  // env CHAINGPT_SOLANA_KEYSTORE_FILE || join(homedir(), '.chaingpt-mcp', 'agent-wallet', 'solana-keystore.json')
export function isSolanaKeystoreInitialized(): boolean;
export function readSolanaKeystoreFile(): SolanaKeystoreFile | null;
export function initSolanaKeystore(): { address: string; path: string; passphraseSource: SecretSource };
  // Keypair.generate(); refuse to overwrite; mkdir 0700; write 0600 — identical flow to initKeystore()
export function loadSolanaKeypair(): Keypair;
  // decrypt → Keypair.fromSecretKey(plain) → verify pubkey.toBase58() === file.address → plain.fill(0)
```

**Shared-crypto refactor (FIRST):** extract the cipher core from `agent-keystore.ts` into exported helpers in that same file:

```ts
export function encryptSecret(plain: Buffer, pass: string):
  { ciphertext: string; iv: string; salt: string; authTag: string; kdf: 'scrypt'; kdfN: number; cipher: 'aes-256-gcm' };
export function decryptSecret(
  f: { ciphertext: string; iv: string; salt: string; authTag: string }, pass: string): Buffer;
```

Refactor `initKeystore`/`loadAccount` to call them (zero behavior change — existing keystore test suite is the regression net), then import both from `agent-keystore-solana.ts`.

### 1.2 `mcp-server/src/tools/agent_wallet_solana.ts` (~350 lines)

Three tools + handler, following the handler shapes in `tools/agent_wallet.ts`:

```ts
export const agentWalletSolanaTools: Tool[] = [
  { name: 'chaingpt_agent_wallet_solana_init' },
  { name: 'chaingpt_agent_wallet_solana_address' },
  { name: 'chaingpt_agent_wallet_solana_sign_and_send',
    inputSchema: { properties: {
      txBase64: { type: 'string' },           // unsigned VersionedTransaction from any existing builder
      memo:     { type: 'string' },           // journaled; required if policy.solana.requireMemo
      waitForConfirmation: { type: 'boolean', default: true },
      skipPreflight: { type: 'boolean', default: false },
    }, required: ['txBase64'] } },
];
```

**`sign_and_send` handler flow (security-critical sequence):**

1. `isSolanaKeystoreInitialized()` or refuse with init hint.
2. `VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'))` — refuse on parse error.
3. **Structural checks (deterministic, pre-RPC):**
   - `msg.header.numRequiredSignatures === 1` — refuse multi-signer txs (v1 scope: agent is sole signer).
   - Fee payer `msg.staticAccountKeys[0].toBase58() === agentAddress` — refuse otherwise ("rebuild the unsigned tx with the agent's address as payer/user").
   - `programIds = [...new Set(msg.compiledInstructions.map(ix => msg.staticAccountKeys[ix.programIdIndex].toBase58()))]`. Complete for top-level: programs cannot come from LUTs.
4. **Cheap policy short-circuit pre-RPC:** killSwitch / `!solana.enabled` → refuse without touching the network.
5. **Simulate** via `withRpcFallback('mainnet', conn => conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [feePayer] } }))` (same trick as `marginfi_signed.ts:200`) + `conn.getBalance(feePayer)`. Compute `simLamportDelta = preBalance - postSimBalance`. On any exception → `sim = { ok: false }`.
6. **Policy gate:** `checkSolanaPolicy({ programIds, feePayer, memo, sim }, loadPolicy(), spendStats(24, 'solana'))`. On refusal: same ⛔ block format as EVM.
7. Additionally refuse when `sim.ok && sim.err !== null` via `formatSimResult` — a tx that simulates to failure is never broadcast autonomously.
8. **Sign + send:** `loadSolanaKeypair()`; refresh blockhash (`tx.message.recentBlockhash = (await conn.getLatestBlockhash('finalized')).blockhash` — safe, sole signer), `tx.sign([keypair])`, `sendRawTransaction`, optional `confirmTransaction`.
9. **Journal:** `logActivity({ ts, chain: 'solana', chainId: 0, from: agentAddress, to: programIds.join(','), valueWei: max(0, simLamportDelta).toString(), hash: signature, memo, policyDigest })`.
10. Output: signature, `https://solscan.io/tx/<sig>`, lamports delta, memo, policy digest.

### 1.3 `mcp-server/src/__tests__/agent_wallet_solana.test.ts` — see §4.

## 2. Files to modify

### 2.1 `mcp-server/src/lib/agent-policy.ts`

```ts
export interface SolanaPolicy {
  enabled: boolean;                    // master opt-in. Missing/false ⇒ refuse (fail closed)
  allowedPrograms?: string[];          // base58. undefined ⇒ any; [] ⇒ EXPLICIT EMPTY: none
  blockedPrograms?: string[];          // wins over allowedPrograms
  maxTxLamports?: string;              // enforced via simulated fee-payer delta; sim failure ⇒ refuse
  maxDailySpendLamports?: string;      // rolling 24h, solana-class ledger entries
  maxDailyTxCount?: number;
  requireMemo?: boolean;
}
// AgentPolicy gains: solana?: SolanaPolicy;

export interface SolanaTxIntent {
  programIds: string[]; feePayer: string; memo?: string;
  sim: { ok: boolean; lamportDelta?: bigint; err?: string };
}
export function checkSolanaPolicy(intent, policy = loadPolicy(), spend?: SpendWindow): PolicyCheck;
```

Rule order: 1 killSwitch → refuse. 2 `!solana?.enabled` → refuse (migration guarantee: every existing policy file refuses Solana until opt-in). 3 unrestricted → allow (AFTER enabled check — see Q3). 4 blockedPrograms intersection → refuse. 5 allowedPrograms (undefined skip / [] refuse-all / else every id ∈ list). 6 maxTxLamports: `!sim.ok` → refuse fail-closed; `delta > cap` → refuse. 7 velocity caps (same fail-closed structure as EVM). 8 requireMemo. 9 allow.

Also: `ALLOWED_POLICY_FIELDS` += `'solana'` (**mandatory** or dashboard saves fail); `validatePolicyInput` validates the sub-object (enabled boolean required; base58 regex `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`; BigInt-parseable lamports; unknown sub-fields rejected); `FAIL_CLOSED_POLICY` += `solana: { enabled: false }`; `DEFAULT_POLICY` += balanced block:

```ts
solana: {
  enabled: true,
  allowedPrograms: [
    '11111111111111111111111111111111',                 // System
    'ComputeBudget111111111111111111111111111111',      // ComputeBudget
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',      // SPL Token
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',      // Token-2022
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',     // Associated Token
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',      // Jupiter v6
    'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',      // Marginfi v2
    'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',      // Kamino kLend
  ],
  maxTxLamports: '100000000',          // 0.1 SOL
  maxDailySpendLamports: '300000000',  // 0.3 SOL / 24h
  maxDailyTxCount: 20,
  requireMemo: true,
}
```
(Verify each program id against `lib/solana-sign.ts` constants + SDK docs during implementation.)

### 2.2 `mcp-server/src/lib/agent-activity.ts`

```ts
export type ChainClass = 'evm' | 'solana' | 'all';
export function spendStats(windowHours = 24, chainClass: ChainClass = 'all'): { totalWei: bigint; txCount: number; ok: boolean };
```
Classifier: `e.chain === 'solana' ? 'solana' : 'evm'`. Default `'all'` keeps existing callers/tests unchanged; the two security chokepoints pass explicit classes. Document: `totalWei` = base units of the class (wei or lamports), never mixed when filtered.

### 2.3 `mcp-server/src/tools/agent_wallet.ts`

- Both `spendStats(24)` call sites → `spendStats(24, 'evm')` (bit-identical when no Solana entries — test #23).
- `status`: append Solana section (keystore state, address, `policy.solana` summary, Solana 24h window via `spendStats(24,'solana')`, `fmtSol` helper).
- Dashboard activity rendering: `a.chain === 'solana'` → format value as SOL (/1e9), link solscan, skip 0x link.
- Dashboard Assets: SOL balance row when Solana keystore exists. Policy form section: DEFER (raw JSON editor suffices).

### 2.4 `mcp-server/src/index.ts`

- Register `...agentWalletSolanaTools`.
- Routing ORDER: `chaingpt_agent_wallet_solana` prefix BEFORE `chaingpt_agent_wallet`.
- Version → 1.19.0.

### 2.5 `hooks/mainnet-guard.js`

Add explicit `isAgentSolanaSend = /chaingpt_agent_wallet_solana_sign_and_send$/` branch (the EVM regex does NOT match it) → ask.

### 2.6 `agent-policy-templates.ts` — solana blocks: balanced-defi = §2.1 block; locked-down = `{enabled:false}`; unrestricted = `{enabled:true}`; show-all-knobs = every field.

### 2.7 Version + docs — VERSION/plugin.json/marketplace.json (desc 131→134)/package.json/index.ts/README (all "131" sites + badge) → 134/1.19.0; CHANGELOG; agent-wallet SKILL.md "Solana wallet" section (threat-model parity + composition recipe builder → decode → sign_and_send); scheduled-autonomy SKILL.md Solana DCA example; TESTING.md devnet recipe.

## 3. Key design decisions

1. **Program allowlist = top-level instructions only; say so.** LUTs can't supply programs so enumeration is complete for top-level; inner CPIs invisible. Honest claim: allowlist fences which protocols the agent may ENTER; sim-delta + velocity caps are the actual spend fence. Never advertise CPI-deep.
2. **Journal the simulated fee-payer delta.** Only chain-native scalar meaning "spend". SPL-token outflows aren't metered by lamport caps (fenced by allowlist + tx count) — document loudly; token-aware cap = follow-up.
3. **Refresh blockhash at sign time** (sole signer → safe to mutate). Kills the "blockhash not found" flake class. Durable nonces out of scope.
4. **Refuse multi-signer txs and foreign fee payers** — closes the co-signing/sponsoring injection hole.
5. **Sim-failure refusal even with no lamport cap** — never autonomously broadcast a tx that simulates to failure.

## 4. Test matrix (~24 new cases)

Pattern: tmp dirs + `CHAINGPT_DISABLE_KEYCHAIN=1` + env passphrase + env-pointed keystore/policy/activity files (as `agent_wallet.test.ts:8-26`).

1 tool surface (3 names) · 2 no policy-write surface · 3 init creates 0600/base58/ed25519 · 4 init refuses overwrite · 5 keypair roundtrip pubkey===address · 6 wrong passphrase + tampered ciphertext throw · 7 EVM keystore refactor regression (existing suite green) · 8 killSwitch refuse · 9 solana absent/enabled:false refuse (migration guarantee) · 10 blockedPrograms wins · 11 allowedPrograms undefined/[]/partial semantics · 12 maxTxLamports + sim.ok=false refuse · 13 delta>cap refuse, ==cap allow · 14 velocity fail-closed trio · 15 requireMemo · 16 unrestricted(+enabled) allows; +killSwitch refuses · 17 validatePolicyInput accept/reject matrix · 18 keystore-missing hint · 19 malformed base64 · 20 fee-payer mismatch (offline VersionedTransaction fixture, `solana.test.ts:205` pattern) · 21 killSwitch refusal touches no RPC · 22 spendStats mixed-ledger never-sum invariant · 23 spendStats('evm') ≡ spendStats() on evm-only ledger · 24 hook asks on solana send (echo | node hooks/mainnet-guard.js).

**Live (manual, TESTING.md):** devnet e2e (init → airdrop → System-only policy → build self-transfer → sign_and_send → confirmed sig + ledger entry + status window). Mainnet refusal proofs free (unfunded wallet sim-fails → refuse; off-allowlist → refuse). Optional smoke case: build+simulate (never send) when keystore exists.

## 5. Gates

`npm run build` · `npm test` (~365+24) · `./scripts/test-all.sh --fast` (validate catches version consistency) · full `test-all.sh` before merge. Boot layer catches routing mistakes.

## 6. Open questions — recommended answers

Q1 default `solana.enabled`: **true** with tight balanced caps (existing policy files lack the key → stay disabled; only new installs get it). Q2 same passphrase/keychain entry: **yes**. Q3 unrestricted bypasses enabled? **No** — enabled checked first. Q4 velocity sum when maxTxLamports unset: **always simulate anyway**; if sim unavailable and ANY solana cap set → refuse; no caps at all → allow, journal '0'. Q5 sim before cheap checks? **Handler short-circuits killSwitch/enabled pre-RPC**, then simulates, then full pure checkSolanaPolicy. Q6 ledger chainId for solana: **0** + `chain:'solana'` discriminator. Q7 SPL outflow not metered: ship documented, token-delta = follow-up. Q8 admin-UI form section: defer.

## 7. Sequencing (single PR, commits each green)

1. `refactor(keystore): extract encryptSecret/decryptSecret` (zero behavior change)
2. `feat(activity): chain-class filter on spendStats` + EVM callers `'evm'` + tests 22-23
3. `feat(keystore): Ed25519 solana keystore` (tests 3-7)
4. `feat(policy): solana sub-policy + checkSolanaPolicy + validation` (tests 8-17, templates)
5. `feat(tools): agent_wallet_solana init/address/sign_and_send + routing + hook` (tests 18-21, 24)
6. `feat(ui): status + dashboard solana surfacing`
7. `docs+version: 1.19.0`

Split option: PR A = 1-4 (pure lib, no user-facing change), PR B = 5-7.

### Critical files
- mcp-server/src/lib/agent-policy.ts · lib/agent-keystore.ts · tools/agent_wallet.ts · lib/agent-activity.ts · src/index.ts (routing order) · hooks/mainnet-guard.js
