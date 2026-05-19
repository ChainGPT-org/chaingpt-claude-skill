/**
 * Pre-built policy templates the admin can apply with one click from the
 * dashboard. Each template is a complete AgentPolicy that the admin can
 * then tweak. Templates serve double duty as documentation — they show
 * realistic combinations of the policy fields.
 *
 * To stay safe, NO template grants the agent unbounded authority. Even
 * "power user" has a value cap and a scam blocklist. The most permissive
 * template still has explicit allowed chains.
 */

import type { AgentPolicy } from './agent-policy.js';

// Canonical mainnet addresses we reference across templates
const OPENOCEAN_V4 = '0x6352a56caadc4f1e25cd6c75970fa768a3304e64';      // multi-chain router
const ONEINCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';        // multi-chain router
const AAVE_V3_POOL_ETH = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const AAVE_V3_POOL_BASE = '0xa238dd80c259a72e81d7e4664a9801593f98d1c5';
const LIDO_STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
const ACROSS_SPOKE_BASE = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64';
const ACROSS_SPOKE_ETH = '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5';
const ACROSS_SPOKE_ARB = '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a';

// ERC-20 transfer / approve selectors (often blocked outside known routers)
const SEL_TRANSFER = '0xa9059cbb';
const SEL_APPROVE = '0x095ea7b3';
const SEL_TRANSFER_FROM = '0x23b872dd';

// Known-bad addresses (placeholder — admin should curate)
const BLOCKED_KNOWN_DRAINER = '0x098b716b8aaf21512996dc57eb0615e2383e2f96';

const isoNow = () => new Date().toISOString();

export interface PolicyTemplate {
  id: string;
  emoji: string;
  name: string;
  description: string;
  policy: AgentPolicy;
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'locked-down',
    emoji: '🔒',
    name: 'Locked down',
    description: 'Default. killSwitch ON — every signing operation is refused. Use while you set up.',
    policy: {
      version: 1,
      killSwitch: true,
      allowedChains: [],
      allowedToAddresses: [],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '0',
      maxTxGas: '500000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'Locked-down default. No signing happens until you swap to another template or relax this manually.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'readonly-explore',
    emoji: '🧪',
    name: 'Read-only explore',
    description: 'killSwitch off but no allowed addresses → nothing can be sent. Lets the agent read on-chain state freely while staying refusal-safe on writes.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [1, 8453, 42161],
      allowedToAddresses: [],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '0',
      maxTxGas: '500000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'Read-only exploration. allowedToAddresses is empty → every signing op is refused with "not in allowlist".',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'dca-base',
    emoji: '💰',
    name: 'DCA bot (Base + OpenOcean)',
    description: 'Conservative DCA bot. Base chain only, OpenOcean router only, 0.05 ETH per tx, memo required for audit trail.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [8453],
      allowedToAddresses: [OPENOCEAN_V4],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '50000000000000000', // 0.05 ETH
      maxTxGas: '500000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'DCA on Base only. Add a memo like "dca-buy-43" so every tx is traceable to a strategy iteration.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'yield-farmer',
    emoji: '🌾',
    name: 'Yield farmer (Aave + Lido + DEX)',
    description: 'Aave V3 + Lido + OpenOcean/1inch routers across Ethereum + Base. 1 ETH per tx cap. Higher gas budget for multicall-heavy supply tx.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [1, 8453],
      allowedToAddresses: [
        AAVE_V3_POOL_ETH,
        AAVE_V3_POOL_BASE,
        LIDO_STETH,
        OPENOCEAN_V4,
        ONEINCH_V6,
      ],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '1000000000000000000', // 1 ETH
      maxTxGas: '1500000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'Yield rebalancing. Refresh allowed routers when adding new protocols. Aave supply uses ~600k gas; multicall variants up to 1.2M.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'cross-chain',
    emoji: '🌉',
    name: 'Cross-chain rebalancer (Across + DEX)',
    description: 'Across SpokePool addresses + DEX routers on Ethereum, Base, Arbitrum. Use when the agent needs to move funds between L2s as part of a strategy.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [1, 8453, 42161],
      allowedToAddresses: [
        ACROSS_SPOKE_ETH,
        ACROSS_SPOKE_BASE,
        ACROSS_SPOKE_ARB,
        OPENOCEAN_V4,
        ONEINCH_V6,
      ],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '500000000000000000', // 0.5 ETH per leg
      maxTxGas: '800000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'Cross-chain rebalancing via Across v3. Each leg capped at 0.5 ETH — split larger transfers into multiple deposits.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'power-user',
    emoji: '⚡',
    name: 'Power user',
    description: 'Wide router allowlist across 5 chains, 5 ETH per-tx cap, scam-address blocklist, memo NOT required. For trusted advanced setups.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [1, 8453, 42161, 10, 137],
      allowedToAddresses: [
        OPENOCEAN_V4,
        ONEINCH_V6,
        AAVE_V3_POOL_ETH,
        AAVE_V3_POOL_BASE,
        LIDO_STETH,
        ACROSS_SPOKE_ETH,
        ACROSS_SPOKE_BASE,
        ACROSS_SPOKE_ARB,
      ],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '5000000000000000000', // 5 ETH
      maxTxGas: '2000000',
      blockedSelectors: [],
      requireMemo: false,
      notes: 'Power-user setup. Curate blockedToAddresses with known drainer/phisher addresses from chainabuse.com / Forta alerts.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'erc20-only',
    emoji: '🪙',
    name: 'ERC-20 only (no native transfer)',
    description: 'Approves + ERC-20 transfers permitted; raw ETH/native transfers refused (maxTxValueWei=0). Pairs well with stablecoin-only strategies.',
    policy: {
      version: 1,
      killSwitch: false,
      allowedChains: [1, 8453, 42161],
      allowedToAddresses: [OPENOCEAN_V4, ONEINCH_V6],
      blockedToAddresses: [BLOCKED_KNOWN_DRAINER],
      maxTxValueWei: '0',
      maxTxGas: '600000',
      blockedSelectors: [],
      requireMemo: true,
      notes: 'maxTxValueWei=0 forces value:0 on every tx — agent can only call contracts (ERC-20 transfers, swaps), never send native coin.',
      updatedAt: isoNow(),
    },
  },
  {
    id: 'show-all-knobs',
    emoji: '📋',
    name: 'Show all knobs (reference)',
    description: 'Every available policy field set to a non-trivial example value. killSwitch ON so you can study/copy safely. Apply, then customize.',
    policy: {
      version: 1,
      killSwitch: true,
      allowedChains: [1, 8453, 42161, 10, 137, 56, 43114, 81457, 59144, 534352],
      allowedToAddresses: [
        OPENOCEAN_V4,
        ONEINCH_V6,
        AAVE_V3_POOL_ETH,
        AAVE_V3_POOL_BASE,
        LIDO_STETH,
        ACROSS_SPOKE_ETH,
        ACROSS_SPOKE_BASE,
        ACROSS_SPOKE_ARB,
      ],
      blockedToAddresses: [
        BLOCKED_KNOWN_DRAINER,
        '0x0000000000000000000000000000000000000000',
        '0x000000000000000000000000000000000000dead',
      ],
      maxTxValueWei: '100000000000000000', // 0.1 ETH
      maxTxGas: '1000000',
      blockedSelectors: [SEL_TRANSFER_FROM], // example: block raw transferFrom
      requireMemo: true,
      notes: 'Reference template showing every policy field. killSwitch is ON for safety. Toggle it off + tune the rules to match your strategy. See the policy editor below for inline help on each field.',
      updatedAt: isoNow(),
    },
  },
];

export function findTemplate(id: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.id === id);
}
