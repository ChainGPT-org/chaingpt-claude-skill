import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createPublicClient,
  http,
  encodeAbiParameters,
  encodeDeployData,
  formatEther,
  formatGwei,
  parseEther,
  type Hex,
} from 'viem';
import {
  mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll,
  sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy, bscTestnet,
} from 'viem/chains';

import { CHAINS, resolveChain } from '../lib/chains.js';
import { compileSolidity } from '../lib/solc.js';
import { httpJson } from '../lib/http.js';

/**
 * Tier-2 deploy tooling. MAINNET-FIRST by design — testnet is a `network`
 * parameter, not the default. See feedback memory `feedback-mainnet-default`
 * for the rationale.
 *
 * Tools never take a private key. The plugin's job is to:
 *   1. Compile (solc)
 *   2. Estimate cost (eth_estimateGas + current gas price)
 *   3. Build the unsigned deployment transaction (to=null, data=bytecode+args)
 *   4. Return the tx object for the user's wallet to sign + broadcast
 *   5. After deploy, optionally call verify against Etherscan v2
 *
 * The user signs externally (WalletConnect, MetaMask, hardware wallet, ERC-4337
 * smart account, …). The plugin is custody-free.
 *
 * For mainnet deploys, the chaingpt-deploy SKILL enforces a mandatory audit
 * pass through chaingpt_audit_contract before the build-tx step.
 */

const EVM_DEPLOY_NETWORKS = [
  // Mainnets (default)
  'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'blast', 'linea', 'scroll',
  // Testnets (opt-in via the `network` parameter)
  'sepolia', 'base-sepolia', 'arbitrum-sepolia', 'optimism-sepolia', 'polygon-amoy', 'bsc-testnet',
];

const NETWORK_TO_VIEM = {
  ethereum: mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, blast, linea, scroll,
  sepolia, 'base-sepolia': baseSepolia, 'arbitrum-sepolia': arbitrumSepolia,
  'optimism-sepolia': optimismSepolia, 'polygon-amoy': polygonAmoy, 'bsc-testnet': bscTestnet,
} as const;

const NETWORK_TO_CHAIN_ID: Record<string, number> = {
  ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137, bsc: 56,
  avalanche: 43114, blast: 81457, linea: 59144, scroll: 534352,
  sepolia: 11155111, 'base-sepolia': 84532, 'arbitrum-sepolia': 421614,
  'optimism-sepolia': 11155420, 'polygon-amoy': 80002, 'bsc-testnet': 97,
};

const NETWORK_IS_MAINNET: Record<string, boolean> = {
  ethereum: true, base: true, arbitrum: true, optimism: true, polygon: true, bsc: true,
  avalanche: true, blast: true, linea: true, scroll: true,
  sepolia: false, 'base-sepolia': false, 'arbitrum-sepolia': false,
  'optimism-sepolia': false, 'polygon-amoy': false, 'bsc-testnet': false,
};

const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';
function etherscanKey(): string {
  return process.env.ETHERSCAN_API_KEY?.trim() || 'YourApiKeyToken';
}

function viemClient(network: string) {
  const chain = (NETWORK_TO_VIEM as any)[network];
  if (!chain) throw new Error(`Unknown network: ${network}`);
  return createPublicClient({ chain, transport: http() });
}

export const deployTools: Tool[] = [
  {
    name: 'chaingpt_deploy_compile',
    description:
      'Compile Solidity source code (single file or multi-contract) using solc 0.8.x. Returns bytecode, ABI, ' +
      'compiler version, and any warnings. The first step of any deploy flow. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Solidity source code. SPDX + pragma must be included.' },
        contractName: {
          type: 'string',
          description: 'Which contract to extract if the source defines multiple. Defaults to the last one.',
        },
        optimizerRuns: { type: 'number', description: 'Optimizer runs. Default 200 (OZ default).', default: 200 },
        evmVersion: {
          type: 'string',
          description: 'EVM target version (e.g. "paris", "shanghai", "cancun"). Optional.',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'chaingpt_deploy_estimate',
    description:
      'Estimate the gas cost (in gas units + USD) of deploying a contract on a given network. MAINNET is ' +
      'the default; pass `network` to override. Returns gas units, current gas price (gwei), total cost in ' +
      'native coin + USD when known. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bytecode: { type: 'string', description: 'Compiled bytecode (0x-prefixed).' },
        constructorAbi: {
          description:
            'Constructor ABI fragment from the compiled ABI (the entry with type="constructor"). Optional ' +
            'if the contract has no constructor or no arguments.',
        },
        constructorArgs: {
          type: 'array',
          description: 'Values to pass to the constructor. Must match `constructorAbi.inputs`. Optional.',
        },
        network: {
          type: 'string',
          enum: EVM_DEPLOY_NETWORKS,
          description: 'EVM network to estimate against. Default: ethereum (mainnet).',
          default: 'ethereum',
        },
        from: {
          type: 'string',
          description: 'Deployer address (0x…). Used by eth_estimateGas. Required for accurate estimate.',
        },
        valueEth: {
          type: 'string',
          description: 'Native-coin value to send with the deployment (e.g. "0.01"). Optional.',
        },
      },
      required: ['bytecode'],
    },
  },
  {
    name: 'chaingpt_deploy_build_tx',
    description:
      'Build an UNSIGNED deployment transaction object for the user\'s wallet to sign + broadcast. ' +
      'MAINNET is the default; pass `network` to override. NEVER takes a private key. Returns: chainId, to=null, ' +
      'data, value, gas, maxFeePerGas, maxPriorityFeePerGas, and a confirmation block summarizing what will be ' +
      'deployed and what it will cost. For mainnet, ALWAYS call chaingpt_audit_contract first per the deploy ' +
      'skill\'s pre-flight gate. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bytecode: { type: 'string', description: 'Compiled bytecode (0x-prefixed).' },
        constructorAbi: { description: 'Constructor ABI fragment. Optional.' },
        constructorArgs: { type: 'array', description: 'Constructor argument values.' },
        network: {
          type: 'string',
          enum: EVM_DEPLOY_NETWORKS,
          description: 'EVM network. Default: ethereum (mainnet).',
          default: 'ethereum',
        },
        from: { type: 'string', description: 'Deployer address (0x…). Optional but recommended.' },
        valueEth: { type: 'string', description: 'Native-coin value to send. Optional.' },
        contractName: { type: 'string', description: 'Name to display in the confirmation block. Optional.' },
        acknowledgeMainnet: {
          type: 'boolean',
          description:
            'You must pass acknowledgeMainnet=true to build a tx targeting a mainnet network. ' +
            'This is the safety prompt — confirm the user actually wants to deploy to a real chain.',
        },
      },
      required: ['bytecode'],
    },
  },
  {
    name: 'chaingpt_deploy_verify',
    description:
      'Submit verified-source publication to Etherscan v2 for an already-deployed contract. Works across all ' +
      'major EVM mainnets + testnets via one endpoint. Returns a verification GUID; poll with ' +
      'chaingpt_deploy_verify_status. Requires ETHERSCAN_API_KEY. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Deployed contract address (0x…).' },
        source: { type: 'string', description: 'Full Solidity source (the same string you compiled).' },
        contractName: { type: 'string', description: 'Contract name in the source.' },
        compilerVersion: {
          type: 'string',
          description: 'Compiler version (e.g. "v0.8.24+commit.e11b9ed9"). Must match what was used to compile.',
        },
        constructorArgs: {
          type: 'string',
          description: 'ABI-encoded constructor args, hex without 0x prefix. Empty string for no-arg.',
          default: '',
        },
        optimizerRuns: { type: 'number', description: 'Optimizer runs used. Default 200.', default: 200 },
        evmVersion: { type: 'string', description: 'EVM version used (e.g. "paris"). Default "default".', default: 'default' },
        network: {
          type: 'string',
          enum: EVM_DEPLOY_NETWORKS,
          description: 'Network the contract is deployed on.',
        },
        licenseType: {
          type: 'number',
          description: 'License code (1=Unlicense, 3=MIT, 5=GPL3, 14=Apache2). Default 3 (MIT).',
          default: 3,
        },
      },
      required: ['address', 'source', 'contractName', 'compilerVersion', 'network'],
    },
  },
  {
    name: 'chaingpt_deploy_verify_status',
    description:
      'Poll the status of a verification submission. Returns success/pending/failed plus the explorer link ' +
      'once verified. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        guid: { type: 'string', description: 'GUID returned by chaingpt_deploy_verify.' },
        network: { type: 'string', enum: EVM_DEPLOY_NETWORKS, description: 'Network the GUID belongs to.' },
        address: { type: 'string', description: 'Address being verified — used to build the explorer link.' },
      },
      required: ['guid', 'network'],
    },
  },
];

function chainNameForNetwork(network: string): string {
  return (
    CHAINS[network]?.name ??
    network
      .split('-')
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(' ')
  );
}

export async function handleDeployTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'No arguments provided.' }] };
  }

  try {
    if (name === 'chaingpt_deploy_compile') {
      const source = String(args.source || '');
      if (!source) return { content: [{ type: 'text', text: 'Error: source is required.' }] };

      const result = compileSolidity(source, {
        contractName: args.contractName as string | undefined,
        optimizerRuns: args.optimizerRuns as number | undefined,
        evmVersion: args.evmVersion as string | undefined,
      });

      const ctorEntry = result.abi.find((x: any) => x.type === 'constructor');
      const lines = [
        `Compiled contract: ${result.contractName}`,
        `Solc:              ${result.solcVersion}`,
        `Bytecode size:     ${(result.bytecode.length - 2) / 2} bytes`,
        `ABI entries:       ${result.abi.length}`,
        ctorEntry ? `Constructor args:  ${(ctorEntry.inputs ?? []).map((i: any) => `${i.type} ${i.name}`).join(', ') || 'none'}` : 'Constructor:       none',
        result.warnings.length > 0 ? `\nWarnings (${result.warnings.length}):\n${result.warnings.slice(0, 5).map((w) => '  ' + w.split('\n')[0]).join('\n')}` : '',
        '',
        '— Use chaingpt_deploy_estimate next to size a deploy.',
        '',
        `--- bytecode (${(result.bytecode.length - 2) / 2} bytes) ---`,
        result.bytecode,
        '',
        '--- abi ---',
        JSON.stringify(result.abi, null, 2),
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_deploy_estimate' || name === 'chaingpt_deploy_build_tx') {
      const bytecode = String(args.bytecode || '');
      if (!bytecode.startsWith('0x')) {
        return { content: [{ type: 'text', text: 'Error: bytecode must start with 0x.' }] };
      }
      const network = String(args.network ?? 'ethereum');
      if (!NETWORK_TO_CHAIN_ID[network]) {
        return { content: [{ type: 'text', text: `Unknown network: ${network}` }] };
      }
      const isMainnet = NETWORK_IS_MAINNET[network];

      // Mainnet safety gate for build_tx
      if (name === 'chaingpt_deploy_build_tx' && isMainnet && !args.acknowledgeMainnet) {
        return {
          content: [{
            type: 'text',
            text:
              `⚠ Mainnet deploy refused. To deploy to ${chainNameForNetwork(network)} (chainId ${NETWORK_TO_CHAIN_ID[network]}), ` +
              `pass acknowledgeMainnet: true. This is a deliberate friction step — mainnet deploys spend real ` +
              `gas and are irreversible. Before setting that flag:\n` +
              `  1. Run chaingpt_audit_contract on the source.\n` +
              `  2. Run chaingpt_deploy_estimate to see the gas cost.\n` +
              `  3. Confirm the constructor args match what you intend.\n` +
              `  4. Confirm the from-address is the wallet you actually control.\n` +
              `Then re-call with acknowledgeMainnet: true.`,
          }],
        };
      }

      // Encode constructor args into the deploy data
      let data: Hex = bytecode as Hex;
      const constructorAbi = args.constructorAbi as any;
      const constructorArgs = (args.constructorArgs as any[]) ?? [];
      if (constructorAbi && Array.isArray(constructorAbi.inputs) && constructorAbi.inputs.length > 0) {
        if (constructorArgs.length !== constructorAbi.inputs.length) {
          return {
            content: [{
              type: 'text',
              text: `Constructor expects ${constructorAbi.inputs.length} args, got ${constructorArgs.length}.`,
            }],
          };
        }
        const encoded = encodeAbiParameters(constructorAbi.inputs, constructorArgs);
        data = (bytecode + encoded.slice(2)) as Hex;
      }

      const client = viemClient(network);
      const valueWei = args.valueEth ? parseEther(String(args.valueEth)) : 0n;
      const from = (args.from as string | undefined) as `0x${string}` | undefined;

      // Gas estimate
      let gasEstimate: bigint;
      try {
        gasEstimate = await client.estimateGas({
          account: from,
          data,
          value: valueWei,
        } as any);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{
            type: 'text',
            text:
              `Gas estimate failed on ${chainNameForNetwork(network)}: ${msg}\n` +
              `Common cause: the deployer address has 0 native balance, or the constructor reverts.`,
          }],
        };
      }
      const gasWithBuffer = (gasEstimate * 110n) / 100n; // 10% safety buffer

      // Current fees
      const feeData = await client.estimateFeesPerGas();
      const maxFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
      const maxPriority = feeData.maxPriorityFeePerGas ?? 0n;
      const estCostWei = gasWithBuffer * maxFee + valueWei;

      const native = CHAINS[network]?.native ?? 'ETH';
      const lines: string[] = [];
      lines.push(`Network:         ${chainNameForNetwork(network)} ${isMainnet ? '(mainnet)' : '(testnet)'}`);
      lines.push(`Chain ID:        ${NETWORK_TO_CHAIN_ID[network]}`);
      lines.push(`From:            ${from ?? '(not provided — estimate uses default)'}`);
      lines.push(`Gas estimate:    ${gasEstimate.toLocaleString()} (+10% buffer → ${gasWithBuffer.toLocaleString()})`);
      lines.push(`Max fee/gas:     ${formatGwei(maxFee)} gwei`);
      lines.push(`Priority fee:    ${formatGwei(maxPriority)} gwei`);
      lines.push(`Value:           ${formatEther(valueWei)} ${native}`);
      lines.push(`Estimated cost:  ${formatEther(estCostWei)} ${native}  (gas + value)`);

      if (name === 'chaingpt_deploy_estimate') {
        lines.push('');
        lines.push('Next: chaingpt_deploy_build_tx to produce the unsigned transaction.');
        if (isMainnet) {
          lines.push('Reminder: pass acknowledgeMainnet: true when calling build_tx for a mainnet network.');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // build_tx path — also serialize the tx for the user
      lines.push('');
      lines.push(`--- Unsigned transaction (paste into your wallet) ---`);
      const tx = {
        chainId: NETWORK_TO_CHAIN_ID[network],
        to: null,
        data,
        value: '0x' + valueWei.toString(16),
        gas: '0x' + gasWithBuffer.toString(16),
        maxFeePerGas: '0x' + maxFee.toString(16),
        maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
        type: '0x2',
      };
      lines.push(JSON.stringify(tx, null, 2));
      lines.push('');
      lines.push('Sign + broadcast via: MetaMask · Rabby · WalletConnect · hardware wallet · ERC-4337 smart account.');
      lines.push('After confirmation, capture the tx hash and call chaingpt_deploy_verify to publish source on Etherscan.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_deploy_verify') {
      const address = String(args.address || '').trim();
      const source = String(args.source || '');
      const contractName = String(args.contractName || '');
      const compilerVersion = String(args.compilerVersion || '');
      const network = String(args.network || '');
      const constructorArgs = String(args.constructorArgs ?? '');
      const optimizerRuns = Number(args.optimizerRuns ?? 200);
      const evmVersion = String(args.evmVersion ?? 'default');
      const licenseType = Number(args.licenseType ?? 3);

      if (!address || !source || !contractName || !compilerVersion || !network) {
        return { content: [{ type: 'text', text: 'Error: address, source, contractName, compilerVersion, network are required.' }] };
      }
      const chainId = NETWORK_TO_CHAIN_ID[network];
      if (!chainId) {
        return { content: [{ type: 'text', text: `Unknown network: ${network}` }] };
      }

      const body = new URLSearchParams({
        chainid: String(chainId),
        module: 'contract',
        action: 'verifysourcecode',
        codeformat: 'solidity-single-file',
        sourceCode: source,
        contractaddress: address,
        contractname: contractName,
        compilerversion: compilerVersion,
        optimizationUsed: '1',
        runs: String(optimizerRuns),
        constructorArguements: constructorArgs,
        evmversion: evmVersion,
        licenseType: String(licenseType),
        apikey: etherscanKey(),
      });

      const res = await fetch(ETHERSCAN_V2_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await res.json() as { status: string; message: string; result: string };
      if (data.status !== '1') {
        return {
          content: [{
            type: 'text',
            text: `Verification submission failed: ${data.message} — ${data.result}`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text:
            `Verification submitted for ${address} on ${chainNameForNetwork(network)}.\n` +
            `GUID: ${data.result}\n\n` +
            `Poll with chaingpt_deploy_verify_status to check progress.`,
        }],
      };
    }

    if (name === 'chaingpt_deploy_verify_status') {
      const guid = String(args.guid || '');
      const network = String(args.network || '');
      const address = String(args.address ?? '');
      const chainId = NETWORK_TO_CHAIN_ID[network];
      if (!chainId) return { content: [{ type: 'text', text: `Unknown network: ${network}` }] };

      const url =
        `${ETHERSCAN_V2_BASE}?chainid=${chainId}&module=contract&action=checkverifystatus` +
        `&guid=${guid}&apikey=${etherscanKey()}`;
      const data = await httpJson<{ status: string; message: string; result: string }>(url);

      const explorer = CHAINS[network]?.explorer;
      const link = explorer && address ? `\nExplorer: ${explorer}/address/${address}#code` : '';
      if (data.status === '1') {
        return { content: [{ type: 'text', text: `✓ Verified — ${data.result}${link}` }] };
      }
      // 'Pending in queue', 'Already Verified', or failure
      return {
        content: [{
          type: 'text',
          text: `Status: ${data.message} — ${data.result}${link}`,
        }],
      };
    }

    return { content: [{ type: 'text', text: `Unknown deploy tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Deploy error: ${message}`);
  }
}
