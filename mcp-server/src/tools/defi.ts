import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Hex,
  type Address,
} from 'viem';
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche } from 'viem/chains';
import { fallback } from 'viem';
import { CHAINS, resolveChain, rpcEndpoints } from '../lib/chains.js';

/**
 * Tier-3d DeFi protocols on MAINNET. Custody-free.
 *
 * Protocols covered:
 *   - Aave V3 (supply / borrow / repay / withdraw / health-factor read) — 7 chains
 *   - Lido stETH staking (Ethereum mainnet only)
 *   - EigenLayer restaking (Ethereum mainnet only)
 *
 * Every state-changing tool returns an unsigned tx. User signs externally.
 * Mainnet ack required for all build-tx tools, same pattern as deploy / dex.
 */

// ─── Aave V3 Pool addresses per network ─────────────────────────────
const AAVE_POOL: Record<string, Address> = {
  ethereum: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  optimism: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  avalanche: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  bsc: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
};

const AAVE_NETWORKS = Object.keys(AAVE_POOL);

// ─── viem chain map ─────────────────────────────────────────────────
const VIEM_CHAIN_MAP = {
  ethereum: mainnet, base, arbitrum, optimism, polygon, bsc, avalanche,
} as const;

function publicClientFor(network: string) {
  const chain = (VIEM_CHAIN_MAP as any)[network];
  if (!chain) throw new Error(`Unsupported network: ${network}`);
  // viem's default transport for `mainnet` falls back to slow/unreliable public endpoints
  // that frequently rate-limit. Use the explicit RPC list from our chain registry as a
  // viem `fallback` transport — tries the primary first, then each fallback in turn.
  const endpoints = rpcEndpoints(network);
  const transports = endpoints.length > 0
    ? endpoints.map((url) => http(url, { timeout: 8_000 }))
    : [http(undefined, { timeout: 8_000 })];
  return createPublicClient({
    chain,
    transport: transports.length === 1 ? transports[0] : fallback(transports),
  });
}

// ─── Lido stETH (Ethereum mainnet only) ─────────────────────────────
const LIDO_STETH: Address = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';

// ─── EigenLayer StrategyManager (Ethereum mainnet only) ─────────────
const EIGEN_STRATEGY_MANAGER: Address = '0x858646372CC42E1A627fcE94aa7A7033e7CF075A';

// ─── ABI fragments ──────────────────────────────────────────────────
const AAVE_POOL_ABI = [
  {
    type: 'function',
    name: 'getUserAccountData',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'supply',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const LIDO_SUBMIT_ABI = [
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'payable',
    inputs: [{ name: '_referral', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const EIGEN_DEPOSIT_ABI = [
  {
    type: 'function',
    name: 'depositIntoStrategy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategy', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const;

// ─── Tool definitions ───────────────────────────────────────────────

export const defiTools: Tool[] = [
  {
    name: 'chaingpt_defi_aave_health',
    description:
      'Read an account\'s Aave V3 health-factor and position summary on a given chain. Returns total collateral, ' +
      'total debt, available to borrow, LTV, liquidation threshold, and health factor (1.0 = liquidation imminent). ' +
      'Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Account address (0x…).' },
        network: { type: 'string', enum: AAVE_NETWORKS, description: 'Aave V3 network. Default: ethereum.', default: 'ethereum' },
      },
      required: ['user'],
    },
  },
  {
    name: 'chaingpt_defi_aave_supply_tx',
    description:
      'Build an UNSIGNED Aave V3 supply transaction. Requires `acknowledgeMainnet: true`. The user must have ' +
      'approved the Aave Pool to spend the asset first (use chaingpt_dex_approve_tx with spender=<pool>). ' +
      '0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'string', description: 'ERC-20 token contract to supply (0x…).' },
        amount: { type: 'string', description: 'Decimal amount, e.g. "1000".' },
        decimals: { type: 'number', description: 'Token decimals (required for parseUnits).' },
        onBehalfOf: { type: 'string', description: 'Recipient of the aToken position. Default: the from address.' },
        from: { type: 'string', description: 'Signer / from address (0x…).' },
        network: { type: 'string', enum: AAVE_NETWORKS, default: 'ethereum' },
        referralCode: { type: 'number', default: 0 },
        acknowledgeMainnet: { type: 'boolean', description: 'Pass true to acknowledge mainnet supply.' },
      },
      required: ['asset', 'amount', 'decimals', 'from'],
    },
  },
  {
    name: 'chaingpt_defi_aave_borrow_tx',
    description:
      'Build an UNSIGNED Aave V3 borrow transaction. Requires sufficient collateral + health factor. ' +
      'Requires `acknowledgeMainnet: true`. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'string' },
        amount: { type: 'string' },
        decimals: { type: 'number' },
        from: { type: 'string', description: 'Borrower address.' },
        network: { type: 'string', enum: AAVE_NETWORKS, default: 'ethereum' },
        interestRateMode: {
          type: 'number',
          enum: [1, 2],
          description: '1 = stable, 2 = variable. Default 2.',
          default: 2,
        },
        onBehalfOf: { type: 'string' },
        referralCode: { type: 'number', default: 0 },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['asset', 'amount', 'decimals', 'from'],
    },
  },
  {
    name: 'chaingpt_defi_aave_repay_tx',
    description:
      'Build an UNSIGNED Aave V3 repay transaction. Pass amount="max" for full repayment. ' +
      'Requires `acknowledgeMainnet: true`. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'string' },
        amount: { type: 'string', description: 'Decimal amount, or "max" for uint256-max.' },
        decimals: { type: 'number' },
        from: { type: 'string' },
        network: { type: 'string', enum: AAVE_NETWORKS, default: 'ethereum' },
        interestRateMode: { type: 'number', enum: [1, 2], default: 2 },
        onBehalfOf: { type: 'string' },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['asset', 'amount', 'decimals', 'from'],
    },
  },
  {
    name: 'chaingpt_defi_aave_withdraw_tx',
    description:
      'Build an UNSIGNED Aave V3 withdraw transaction. Pass amount="max" for full withdrawal of the supplied ' +
      'amount. Requires `acknowledgeMainnet: true`. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset: { type: 'string' },
        amount: { type: 'string' },
        decimals: { type: 'number' },
        from: { type: 'string' },
        to: { type: 'string', description: 'Recipient of the withdrawn asset. Default: from.' },
        network: { type: 'string', enum: AAVE_NETWORKS, default: 'ethereum' },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['asset', 'amount', 'decimals', 'from'],
    },
  },
  {
    name: 'chaingpt_defi_lido_stake_tx',
    description:
      'Build an UNSIGNED Lido stETH staking transaction on Ethereum mainnet. Sends native ETH; receives stETH ' +
      '(1:1 minus protocol fee). Requires `acknowledgeMainnet: true`. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        amountEth: { type: 'string', description: 'Amount of native ETH to stake, decimal e.g. "1.5".' },
        from: { type: 'string', description: 'Signer / from address (0x…).' },
        referral: {
          type: 'string',
          description: 'Optional referral address (0x…). Default: zero address.',
          default: '0x0000000000000000000000000000000000000000',
        },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['amountEth', 'from'],
    },
  },
  {
    name: 'chaingpt_defi_eigenlayer_deposit_tx',
    description:
      'Build an UNSIGNED EigenLayer deposit transaction (restake an LST like stETH / rETH / cbETH into a ' +
      'StrategyManager strategy). Ethereum mainnet only. Requires `acknowledgeMainnet: true` and the user must ' +
      'have approved the StrategyManager to pull the token first. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        strategy: {
          type: 'string',
          description:
            'EigenLayer Strategy address. Common: stETH=0x93c4b944D05dfe6df7645A86cd2206016c51564D, ' +
            'rETH=0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2, cbETH=0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc.',
        },
        token: { type: 'string', description: 'The underlying LST token contract address.' },
        amount: { type: 'string', description: 'Decimal amount of token to restake.' },
        decimals: { type: 'number', description: 'Token decimals (most LSTs are 18).' },
        from: { type: 'string' },
        acknowledgeMainnet: { type: 'boolean' },
      },
      required: ['strategy', 'token', 'amount', 'decimals', 'from'],
    },
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

const MAINNET_REFUSAL = (action: string, network: string) =>
  `⚠ Mainnet ${action} refused. To execute on ${CHAINS[network]?.name ?? network} mainnet, pass ` +
  `acknowledgeMainnet: true. This is the safety prompt — DeFi mainnet actions are irreversible and put real ` +
  `funds at risk. Before setting that flag:\n` +
  `  1. Read your current Aave health with chaingpt_defi_aave_health if borrowing or withdrawing.\n` +
  `  2. Confirm the asset address matches the token you intend (cross-check on chaingpt_research_token).\n` +
  `  3. Confirm the from-address is the wallet you control.\n` +
  `  4. For supply / repay / deposit, confirm the approval is in place.\n` +
  `Then re-call with acknowledgeMainnet: true.`;

function formatTx(chainId: number, to: Address, data: Hex, valueWei = 0n) {
  return {
    chainId,
    to,
    data,
    value: '0x' + valueWei.toString(16),
  };
}

function maxUint(): bigint {
  return (1n << 256n) - 1n;
}

function chainIdOf(network: string): number {
  return CHAINS[network]?.chainId ?? 1;
}

export async function handleDefiTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_defi_aave_health') {
      const user = String(args.user || '').trim();
      if (!user) return { content: [{ type: 'text', text: 'Error: user is required.' }] };
      const network = String(args.network ?? 'ethereum');
      const pool = AAVE_POOL[network];
      if (!pool) return { content: [{ type: 'text', text: `Aave V3 not deployed on ${network}.` }] };

      const client = publicClientFor(network);
      const data = await client.readContract({
        address: pool,
        abi: AAVE_POOL_ABI,
        functionName: 'getUserAccountData',
        args: [user as Address],
      });

      // data is a tuple: [totalCollateral, totalDebt, availableBorrows, liquidationThreshold, ltv, healthFactor]
      const [totalCollateral, totalDebt, availableBorrows, liqThreshold, ltv, healthFactor] = data as readonly bigint[];

      // Aave base = 8 decimals (USD-pegged "base currency")
      const collateralUsd = Number(formatUnits(totalCollateral, 8));
      const debtUsd = Number(formatUnits(totalDebt, 8));
      const availableUsd = Number(formatUnits(availableBorrows, 8));
      // healthFactor is in WAD (1e18). 1.0 = liquidation imminent.
      const hf = Number(formatUnits(healthFactor, 18));
      const hfDisplay = healthFactor === maxUint() ? '∞ (no debt)' : hf.toFixed(3);

      const lines = [
        `Aave V3 health — ${user} on ${CHAINS[network]?.name ?? network}`,
        '',
        `Total collateral:         $${collateralUsd.toFixed(2)}`,
        `Total debt:               $${debtUsd.toFixed(2)}`,
        `Available to borrow:      $${availableUsd.toFixed(2)}`,
        `Current LTV:              ${(Number(ltv) / 100).toFixed(2)}%`,
        `Liquidation threshold:    ${(Number(liqThreshold) / 100).toFixed(2)}%`,
        `Health factor:            ${hfDisplay}`,
        '',
        hf < 1.05 && healthFactor !== maxUint() ? '⚠ Health factor is below 1.05 — liquidation risk is HIGH. Consider repaying or topping up collateral.' : '',
        hf >= 1.05 && hf < 1.5 ? 'ℹ Health factor is below 1.5 — caution on volatile markets.' : '',
      ].filter(Boolean);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_defi_aave_supply_tx') {
      const network = String(args.network ?? 'ethereum');
      const pool = AAVE_POOL[network];
      if (!pool) return { content: [{ type: 'text', text: `Aave V3 not deployed on ${network}.` }] };
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('supply', network) }] };
      }
      const asset = String(args.asset) as Address;
      const decimals = Number(args.decimals);
      const amount = parseUnits(String(args.amount) as `${number}`, decimals);
      const from = String(args.from) as Address;
      const onBehalfOf = ((args.onBehalfOf as string) || from) as Address;
      const refCode = Number(args.referralCode ?? 0);

      const data = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [asset, amount, onBehalfOf, refCode],
      });
      const tx = formatTx(chainIdOf(network), pool, data);

      return {
        content: [{
          type: 'text',
          text: [
            `Aave V3 supply — ${CHAINS[network]?.name ?? network}`,
            '',
            `Asset:           ${asset}`,
            `Amount:          ${args.amount} (× 10^${decimals})`,
            `On behalf of:    ${onBehalfOf}`,
            `Pool:            ${pool}`,
            '',
            'Pre-flight: did you approve the Aave Pool to spend this asset?',
            'If not: chaingpt_dex_approve_tx token=<asset> spender=' + pool,
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_defi_aave_borrow_tx') {
      const network = String(args.network ?? 'ethereum');
      const pool = AAVE_POOL[network];
      if (!pool) return { content: [{ type: 'text', text: `Aave V3 not deployed on ${network}.` }] };
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('borrow', network) }] };
      }
      const asset = String(args.asset) as Address;
      const decimals = Number(args.decimals);
      const amount = parseUnits(String(args.amount) as `${number}`, decimals);
      const from = String(args.from) as Address;
      const onBehalfOf = ((args.onBehalfOf as string) || from) as Address;
      const rateMode = BigInt(Number(args.interestRateMode ?? 2));
      const refCode = Number(args.referralCode ?? 0);

      const data = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'borrow',
        args: [asset, amount, rateMode, refCode, onBehalfOf],
      });
      const tx = formatTx(chainIdOf(network), pool, data);

      return {
        content: [{
          type: 'text',
          text: [
            `Aave V3 borrow — ${CHAINS[network]?.name ?? network}`,
            '',
            `Asset:           ${asset}`,
            `Amount:          ${args.amount} (× 10^${decimals})`,
            `Rate mode:       ${rateMode === 1n ? 'stable' : 'variable'}`,
            `Borrower:        ${from}`,
            `Pool:            ${pool}`,
            '',
            'Pre-flight: chaingpt_defi_aave_health to confirm your health factor allows this borrow.',
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_defi_aave_repay_tx') {
      const network = String(args.network ?? 'ethereum');
      const pool = AAVE_POOL[network];
      if (!pool) return { content: [{ type: 'text', text: `Aave V3 not deployed on ${network}.` }] };
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('repay', network) }] };
      }
      const asset = String(args.asset) as Address;
      const decimals = Number(args.decimals);
      const amountInput = String(args.amount);
      const amount = amountInput === 'max' ? maxUint() : parseUnits(amountInput as `${number}`, decimals);
      const from = String(args.from) as Address;
      const onBehalfOf = ((args.onBehalfOf as string) || from) as Address;
      const rateMode = BigInt(Number(args.interestRateMode ?? 2));

      const data = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'repay',
        args: [asset, amount, rateMode, onBehalfOf],
      });
      const tx = formatTx(chainIdOf(network), pool, data);

      return {
        content: [{
          type: 'text',
          text: [
            `Aave V3 repay — ${CHAINS[network]?.name ?? network}`,
            '',
            `Asset:           ${asset}`,
            `Amount:          ${amountInput === 'max' ? 'full debt (uint256 max)' : `${amountInput} (× 10^${decimals})`}`,
            `Rate mode:       ${rateMode === 1n ? 'stable' : 'variable'}`,
            `On behalf of:    ${onBehalfOf}`,
            `Pool:            ${pool}`,
            '',
            'Pre-flight: approve the Aave Pool to spend the asset if not already done.',
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_defi_aave_withdraw_tx') {
      const network = String(args.network ?? 'ethereum');
      const pool = AAVE_POOL[network];
      if (!pool) return { content: [{ type: 'text', text: `Aave V3 not deployed on ${network}.` }] };
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('withdraw', network) }] };
      }
      const asset = String(args.asset) as Address;
      const decimals = Number(args.decimals);
      const amountInput = String(args.amount);
      const amount = amountInput === 'max' ? maxUint() : parseUnits(amountInput as `${number}`, decimals);
      const from = String(args.from) as Address;
      const to = ((args.to as string) || from) as Address;

      const data = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'withdraw',
        args: [asset, amount, to],
      });
      const tx = formatTx(chainIdOf(network), pool, data);

      return {
        content: [{
          type: 'text',
          text: [
            `Aave V3 withdraw — ${CHAINS[network]?.name ?? network}`,
            '',
            `Asset:           ${asset}`,
            `Amount:          ${amountInput === 'max' ? 'full supply (uint256 max)' : `${amountInput} (× 10^${decimals})`}`,
            `Recipient:       ${to}`,
            `Pool:            ${pool}`,
            '',
            'Pre-flight: chaingpt_defi_aave_health — withdrawing collateral lowers your health factor.',
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_defi_lido_stake_tx') {
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('Lido stake', 'ethereum') }] };
      }
      const amountEth = String(args.amountEth || '');
      if (!amountEth) return { content: [{ type: 'text', text: 'amountEth is required.' }] };
      const referral = ((args.referral as string) || '0x0000000000000000000000000000000000000000') as Address;
      const valueWei = parseUnits(amountEth as `${number}`, 18);

      const data = encodeFunctionData({
        abi: LIDO_SUBMIT_ABI,
        functionName: 'submit',
        args: [referral],
      });
      const tx = formatTx(1, LIDO_STETH, data, valueWei);

      return {
        content: [{
          type: 'text',
          text: [
            `Lido stake — Ethereum mainnet`,
            '',
            `Amount:          ${amountEth} ETH`,
            `Receives:        ~${amountEth} stETH (1:1 minus protocol fee, accrues rewards)`,
            `Referral:        ${referral}`,
            `Lido contract:   ${LIDO_STETH}`,
            '',
            'Note: stETH rebases — your balance grows daily as staking rewards accrue.',
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_defi_eigenlayer_deposit_tx') {
      if (!args.acknowledgeMainnet) {
        return { content: [{ type: 'text', text: MAINNET_REFUSAL('EigenLayer deposit', 'ethereum') }] };
      }
      const strategy = String(args.strategy) as Address;
      const token = String(args.token) as Address;
      const decimals = Number(args.decimals);
      const amount = parseUnits(String(args.amount) as `${number}`, decimals);

      const data = encodeFunctionData({
        abi: EIGEN_DEPOSIT_ABI,
        functionName: 'depositIntoStrategy',
        args: [strategy, token, amount],
      });
      const tx = formatTx(1, EIGEN_STRATEGY_MANAGER, data);

      return {
        content: [{
          type: 'text',
          text: [
            `EigenLayer restake — Ethereum mainnet`,
            '',
            `Strategy:           ${strategy}`,
            `Underlying token:   ${token}`,
            `Amount:             ${args.amount} (× 10^${decimals})`,
            `StrategyManager:    ${EIGEN_STRATEGY_MANAGER}`,
            '',
            'Pre-flight: approve StrategyManager to spend the LST first via chaingpt_dex_approve_tx.',
            'Note: deposits to EigenLayer have a 7-day withdrawal queue. Plan accordingly.',
            '',
            '--- Unsigned transaction ---',
            JSON.stringify(tx, null, 2),
          ].join('\n'),
        }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown DeFi tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT DeFi error: ${message}`);
  }
}
