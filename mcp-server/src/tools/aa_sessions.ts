import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { decodeAbiParameters, encodeFunctionData, type Address, type Hex } from 'viem';
import {
  buildSession,
  getPermissionId,
  encodeEnableSessions,
  encodeRemoveSession,
  appendSessionRecord,
  readSessionRecords,
  SMART_SESSIONS_ADDRESS,
  ERC20_SPENDING_LIMIT_POLICY,
  SMART_SESSION_READ_ABI,
  type SessionCaps,
} from '../lib/smart-sessions.js';
import {
  encodeSingleExecute,
  encodeInstallModule,
  encodeIsModuleInstalled,
  readAccountId,
  classifyAccountId,
} from '../lib/erc7579.js';
import { readKeystoreFile } from '../lib/agent-keystore.js';
import { resolveChainWithCustom, rpcEndpointsWithCustom } from '../lib/agent-custom-chains.js';
import { jsonRpcFallback } from '../lib/http.js';

/**
 * ERC-4337 session grants — custody-free payload builders.
 *
 * The user's smart account grants the agent's existing EOA a SCOPED on-chain
 * session via the Smart Sessions module: per-token cumulative spend caps,
 * time bounds, optional usage caps. We BUILD the grant/revoke calldata; the
 * account OWNER signs the resulting userOp externally (chaingpt_aa_userop_hash
 * → sign → chaingpt_aa_submit_userop). The plugin never sees the owner key.
 *
 * The agent then acts through chaingpt_agent_wallet_4337_sign_and_send —
 * and the CHAIN enforces the caps at validation time, even if the local
 * policy file were fully compromised.
 */

function chainRpcs(slug: string): { chainId: number; rpcs: string[] } {
  const c = resolveChainWithCustom(slug);
  if (!c?.chainId) throw new Error(`chain "${slug}" is not a known EVM chain.`);
  const rpcs = rpcEndpointsWithCustom(slug);
  if (!rpcs.length) throw new Error(`no RPC endpoints configured for ${slug}.`);
  return { chainId: c.chainId, rpcs };
}

export const aaSessionTools: Tool[] = [
  {
    name: 'chaingpt_aa_session_build_grant',
    description:
      "Build the UNSIGNED payload that grants the agent's wallet a scoped ON-CHAIN session on the user's " +
      'ERC-7579 smart account (Smart Sessions module): cumulative per-token spend caps + a required expiry, ' +
      'enforced by audited policy contracts at EntryPoint validation — the chain refuses over-cap spends ' +
      'even if the local machine is compromised. Output: permissionId + the execute()-wrapped account ' +
      'callData + the sign-and-submit recipe (owner signs externally; chaingpt_aa_submit_userop sends). ' +
      'Custody-free. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string', description: 'EVM chain slug (e.g. base).' },
        account: { type: 'string', description: "The user's smart account (userOp sender / grantor)." },
        agentAddress: { type: 'string', description: "Session key address. Defaults to the agent wallet's EOA when initialized." },
        tokenCaps: {
          type: 'array',
          description: 'Cumulative on-chain per-token caps. Each: { token: 0x…, cap: base-units string }.',
          items: {
            type: 'object',
            properties: { token: { type: 'string' }, cap: { type: 'string' } },
            required: ['token', 'cap'],
          },
        },
        validUntil: { type: 'number', description: 'REQUIRED expiry (Unix seconds). Unbounded grants are refused.' },
        validAfter: { type: 'number', description: 'Optional start time (Unix seconds).' },
        maxUses: { type: 'number', description: 'Optional max number of userOps under this session.' },
        salt: { type: 'string', description: 'Optional bytes32 salt — vary to issue parallel sessions for the same key.' },
        moduleInstalled: {
          type: 'boolean',
          description: 'Is the Smart Sessions module already installed on the account? Default: auto-detect via RPC (falls back to true).',
        },
      },
      required: ['chain', 'account', 'tokenCaps', 'validUntil'],
    },
  },
  {
    name: 'chaingpt_aa_session_build_revoke',
    description:
      'Build the UNSIGNED payload that revokes an on-chain session (removeSession(permissionId)) — the ' +
      'incident-response kill: after inclusion the session key can sign nothing, regardless of local state. ' +
      'Owner signs externally, same flow as the grant. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string' },
        account: { type: 'string', description: "The user's smart account." },
        permissionId: { type: 'string', description: 'The session to revoke (from build_grant / session_status).' },
      },
      required: ['chain', 'account', 'permissionId'],
    },
  },
  {
    name: 'chaingpt_aa_session_status',
    description:
      "Read a session's ON-CHAIN state: account kind, module installed?, permission enabled?, and the " +
      'authoritative remaining per-token allowance straight from the spending-limit policy contract. ' +
      'Falls back to locally cached grants when args are omitted. Read-only. 0 ChainGPT credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string' },
        account: { type: 'string' },
        permissionId: { type: 'string' },
      },
      required: [],
    },
  },
];

export async function handleAaSessionTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  args = args ?? {};

  try {
    if (name === 'chaingpt_aa_session_build_grant') {
      const { chainId, rpcs } = chainRpcs(String(args.chain));
      const account = String(args.account) as Address;
      const agentAddress = (args.agentAddress ? String(args.agentAddress) : readKeystoreFile()?.address) as Address | undefined;
      if (!agentAddress) {
        return { content: [{ type: 'text', text: 'No agentAddress given and the agent wallet is not initialized — run chaingpt_agent_wallet_init or pass agentAddress.' }] };
      }
      const tokenCaps = (args.tokenCaps as Array<{ token: string; cap: string }>).map((t) => ({
        token: t.token as Address,
        cap: BigInt(t.cap),
      }));
      const caps: SessionCaps = {
        agentAddress,
        tokenCaps,
        validUntil: Number(args.validUntil),
        validAfter: args.validAfter !== undefined ? Number(args.validAfter) : undefined,
        maxUses: args.maxUses !== undefined ? BigInt(String(args.maxUses)) : undefined,
        salt: args.salt ? (String(args.salt) as Hex) : undefined,
      };
      const session = buildSession(caps);
      const permissionId = getPermissionId(session);
      const enableCalldata = encodeEnableSessions([session]);

      // Auto-detect module installation; degrade to "assume installed" with a warning.
      let installed: boolean | null = args.moduleInstalled !== undefined ? Boolean(args.moduleInstalled) : null;
      if (installed === null) {
        try {
          const raw = await jsonRpcFallback<Hex>(rpcs, 'eth_call', [
            { to: account, data: encodeIsModuleInstalled(SMART_SESSIONS_ADDRESS) },
            'latest',
          ]);
          installed = decodeAbiParameters([{ type: 'bool' }], raw)[0] as boolean;
        } catch { installed = null; }
      }

      // installModule(initData) on Smart Sessions takes the abi-encoded Session[] to enable at install time.
      const accountCallData = installed === false
        ? encodeSingleExecute(account, 0n, encodeInstallModule(SMART_SESSIONS_ADDRESS, enableCalldata))
        : encodeSingleExecute(SMART_SESSIONS_ADDRESS, 0n, enableCalldata);

      appendSessionRecord({
        account,
        chainId,
        permissionId,
        caps: {
          agentAddress,
          tokenCaps: tokenCaps.map((t) => ({ token: t.token, cap: t.cap.toString() })),
          validUntil: caps.validUntil,
        },
        createdAt: new Date().toISOString(),
      });

      const lines = [
        `=== Session grant (UNSIGNED) — chain ${args.chain} (${chainId}) ===`,
        ``,
        `Account (grantor):  ${account}`,
        `Session key:        ${agentAddress} (the agent wallet)`,
        `Permission id:      ${permissionId}`,
        `Expiry:             ${new Date(caps.validUntil * 1000).toISOString()}`,
        ...tokenCaps.map((t) => `Token cap:          ${t.cap} base units of ${t.token} (cumulative, chain-enforced)`),
        `Module installed:   ${installed === null ? 'UNKNOWN (RPC unreachable — assuming installed; pass moduleInstalled=false to embed installModule)' : installed}`,
        ``,
        `--- account callData (execute-wrapped) ---`,
        accountCallData,
        ``,
        `Owner sign-and-submit recipe (custody-free):`,
        `  1. Build the userOp: sender=${account}, callData=<above>, nonce via your account's owner-validator key.`,
        `  2. chaingpt_aa_estimate_userop bundlerUrl=<bundler> …  → gas fields`,
        `  3. chaingpt_aa_userop_hash chain=${args.chain} userOp=<filled>  → hash`,
        `  4. Sign the hash with the account OWNER wallet (never the agent key).`,
        `  5. chaingpt_aa_submit_userop bundlerUrl=<bundler> userOp=<with signature>`,
        ``,
        `Then verify: chaingpt_aa_session_status chain=${args.chain} account=${account} permissionId=${permissionId}`,
        `Agent usage:  chaingpt_agent_wallet_4337_sign_and_send (policy gate + chain caps both apply).`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'chaingpt_aa_session_build_revoke') {
      const { chainId } = chainRpcs(String(args.chain));
      const account = String(args.account);
      const permissionId = String(args.permissionId) as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(permissionId)) {
        return { content: [{ type: 'text', text: `permissionId must be a 0x bytes32 (got ${permissionId}).` }] };
      }
      const accountCallData = encodeSingleExecute(SMART_SESSIONS_ADDRESS, 0n, encodeRemoveSession(permissionId));
      return {
        content: [{
          type: 'text',
          text: [
            `=== Session REVOKE (UNSIGNED) — chain ${args.chain} (${chainId}) ===`,
            ``,
            `Account:        ${account}`,
            `Permission id:  ${permissionId}`,
            ``,
            `--- account callData (execute-wrapped) ---`,
            accountCallData,
            ``,
            `Owner signs + submits exactly like a grant (estimate → hash → sign → chaingpt_aa_submit_userop).`,
            `After inclusion the session key can sign NOTHING under this permission — chain-level kill.`,
          ].join('\n'),
        }],
      };
    }

    if (name === 'chaingpt_aa_session_status') {
      const records = readSessionRecords();
      let account = args.account ? (String(args.account) as Address) : undefined;
      let permissionId = args.permissionId ? (String(args.permissionId) as Hex) : undefined;
      let chainSlugForRpc = args.chain ? String(args.chain) : undefined;

      if ((!account || !permissionId || !chainSlugForRpc) && records.length > 0) {
        const last = records.at(-1)!;
        account = account ?? last.account;
        permissionId = permissionId ?? last.permissionId;
        if (!chainSlugForRpc) {
          // map chainId back to a slug if possible
          chainSlugForRpc = last.chainId === 8453 ? 'base' : last.chainId === 1 ? 'ethereum' : undefined;
        }
      }
      if (!account || !permissionId || !chainSlugForRpc) {
        const cached = records.map((r) => `  • ${r.permissionId} on account ${r.account} (chainId ${r.chainId}, created ${r.createdAt})`);
        return {
          content: [{
            type: 'text',
            text: [
              'Need chain + account + permissionId (or at least one locally cached grant).',
              records.length ? 'Cached grants:' : 'No cached grants on this machine.',
              ...cached,
            ].join('\n'),
          }],
        };
      }

      const { rpcs } = chainRpcs(chainSlugForRpc);
      const lines: string[] = [`=== Session status — ${chainSlugForRpc} ===`, ``];

      try {
        const id = await readAccountId(rpcs, account);
        lines.push(`Account:     ${account} (${id} → ${classifyAccountId(id).kind})`);
      } catch {
        lines.push(`Account:     ${account} (accountId() unreadable — not deployed or not ERC-7579)`);
      }
      try {
        const raw = await jsonRpcFallback<Hex>(rpcs, 'eth_call', [
          { to: account, data: encodeIsModuleInstalled(SMART_SESSIONS_ADDRESS) },
          'latest',
        ]);
        lines.push(`Module:      Smart Sessions ${decodeAbiParameters([{ type: 'bool' }], raw)[0] ? 'INSTALLED' : 'NOT installed'}`);
      } catch { lines.push('Module:      install state unreadable'); }
      try {
        const data = encodeFunctionData({ abi: SMART_SESSION_READ_ABI, functionName: 'isPermissionEnabled', args: [permissionId, account] });
        const raw = await jsonRpcFallback<Hex>(rpcs, 'eth_call', [{ to: SMART_SESSIONS_ADDRESS, data }, 'latest']);
        lines.push(`Permission:  ${permissionId} → ${decodeAbiParameters([{ type: 'bool' }], raw)[0] ? 'ENABLED' : 'not enabled'}`);
      } catch { lines.push(`Permission:  ${permissionId} (state unreadable)`); }

      const rec = records.find((r) => r.permissionId === permissionId);
      if (rec) {
        lines.push('');
        lines.push('Granted caps (local record — chain is authoritative):');
        for (const t of rec.caps.tokenCaps) lines.push(`  • ${t.cap} base units of ${t.token}`);
        lines.push(`  • expires ${new Date(rec.caps.validUntil * 1000).toISOString()}`);
      }
      lines.push('');
      lines.push(`Spending-limit policy: ${ERC20_SPENDING_LIMIT_POLICY} (per-token spent/remaining readable on-chain).`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: `Unknown aa-session tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT AA Sessions error: ${message}`);
  }
}
