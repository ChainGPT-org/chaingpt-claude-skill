import { createPublicClient, http, fallback, getAddress } from 'viem';
import { httpJson } from '../lib/http.js';
import { rpcEndpoints } from '../lib/chains.js';
/**
 * Tier-7 ERC-8004 "Trustless Agents" — on-chain agent identity + reputation.
 * The Identity Registry is an ERC-721 ("AgentIdentity"/"AGENT") deployed as a
 * singleton at a vanity 0x8004… address across many chains. Reads verified live
 * against Base mainnet. Custody-free; reads + offline scaffolding. 0 credits.
 *
 * Write path (register / giveFeedback) intentionally deferred: ERC-8004 is a
 * DRAFT EIP and its write ABIs (esp. the Validation Registry) are still being
 * revised, so we don't ship unverified fund/identity-mutating calldata. The
 * read + AgentCard tools below are stable and verified.
 */
// Canonical singleton registries (same vanity addresses across 15+ chains).
export const ERC8004 = {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
};
// Chains where these singletons are deployed (per the ERC-8004 project).
const ERC8004_CHAINS = {
    ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, polygon: 137,
};
const IDENTITY_ABI = [
    { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
    { name: 'tokenURI', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
    { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
];
const AGENTCARD_TYPE = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
export const erc8004Tools = [
    {
        name: 'chaingpt_erc8004_resolve_agent',
        description: 'Resolve an ERC-8004 Trustless Agent by its agentId. Reads ownerOf + tokenURI from the Identity Registry ' +
            '(ERC-721) on the given chain, then decodes/fetches the agent\'s registration card (data: URI or https/ipfs). ' +
            'Shows owner, name, description, services, supported trust models, and x402 support. Read-only. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'The agent token id (e.g. "0").' },
                chain: { type: 'string', description: `Chain the registry is on. One of: ${Object.keys(ERC8004_CHAINS).join(', ')}. Default base.` },
            },
            required: ['agentId'],
        },
    },
    {
        name: 'chaingpt_erc8004_registries',
        description: 'Return the canonical ERC-8004 registry addresses (Identity + Reputation) and the chains they are deployed on. ' +
            'These are vanity-0x8004 singletons with the same address across chains. Reference info, no network. 0 credits.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'chaingpt_erc8004_agentcard',
        description: 'Generate an ERC-8004 agent registration card (the JSON served at the agent\'s tokenURI / ' +
            '`/.well-known/agent-card.json`). You provide name, description, services, trust models, x402 support; it ' +
            'emits the spec-compliant `registration-v1` JSON ready to host or embed as a data: URI. No network. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Agent name.' },
                description: { type: 'string', description: 'What the agent does.' },
                image: { type: 'string', description: 'Avatar/image URL (https or ipfs).' },
                services: { type: 'array', items: { type: 'object' }, description: 'Service endpoints (A2A/MCP/etc). Each e.g. {type, url}.' },
                supportedTrust: { type: 'array', items: { type: 'string' }, description: 'Trust models, e.g. ["reputation","crypto-economic","tee-attestation"].' },
                x402Support: { type: 'boolean', description: 'Does the agent accept x402 payments? Default false.' },
                agentId: { type: 'string', description: 'If already registered, the agentId to embed in registrations[].' },
                chain: { type: 'string', description: `Chain for the registrations[] entry (default base). One of: ${Object.keys(ERC8004_CHAINS).join(', ')}.` },
                emitDataUri: { type: 'boolean', description: 'Also output the data:application/json;base64 URI form. Default false.' },
            },
            required: ['name'],
        },
    },
];
function clientFor(chainKey) {
    const env = chainKey === 'base' ? process.env.BASE_RPC_URL : undefined;
    const endpoints = [...(env ? [env] : []), ...rpcEndpoints(chainKey)];
    if (endpoints.length === 0)
        endpoints.push('https://mainnet.base.org');
    const transports = endpoints.map((url) => http(url, { timeout: 8_000 }));
    return createPublicClient({ transport: transports.length === 1 ? transports[0] : fallback(transports) });
}
async function loadAgentCard(tokenURI) {
    try {
        if (tokenURI.startsWith('data:application/json;base64,')) {
            return JSON.parse(Buffer.from(tokenURI.split(',')[1], 'base64').toString('utf8'));
        }
        if (tokenURI.startsWith('data:application/json,')) {
            return JSON.parse(decodeURIComponent(tokenURI.split(',')[1]));
        }
        let url = tokenURI;
        if (url.startsWith('ipfs://'))
            url = `https://ipfs.io/ipfs/${url.slice('ipfs://'.length)}`;
        if (/^https?:\/\//.test(url))
            return await httpJson(url, { method: 'GET' });
    }
    catch { /* ignore */ }
    return null;
}
async function handleResolve(args) {
    const chainKey = String(args.chain ?? 'base');
    if (!(chainKey in ERC8004_CHAINS))
        throw new Error(`Unknown chain "${chainKey}". One of: ${Object.keys(ERC8004_CHAINS).join(', ')}.`);
    const agentId = BigInt(String(args.agentId));
    const client = clientFor(chainKey);
    let owner;
    try {
        owner = await client.readContract({ address: ERC8004.identity, abi: IDENTITY_ABI, functionName: 'ownerOf', args: [agentId] });
    }
    catch (e) {
        // Distinguish "token doesn't exist" (a contract revert) from an RPC failure —
        // reporting an RPC outage as "not registered" would be misleading.
        const msg = String(e?.shortMessage ?? e?.message ?? e);
        if (/revert|nonexistent|ERC721|owner query for nonexistent|execution reverted/i.test(msg)) {
            return `Agent #${agentId} is not registered in the ERC-8004 Identity Registry on ${chainKey}.`;
        }
        throw new Error(`Could not read the Identity Registry on ${chainKey} (RPC issue, not "unregistered"): ${msg}. Set BASE_RPC_URL to a reliable endpoint and retry.`);
    }
    let tokenURI = '';
    try {
        tokenURI = await client.readContract({ address: ERC8004.identity, abi: IDENTITY_ABI, functionName: 'tokenURI', args: [agentId] });
    }
    catch { /* */ }
    const card = tokenURI ? await loadAgentCard(tokenURI) : null;
    const lines = [
        `=== ERC-8004 Agent #${agentId} (${chainKey}) ===`,
        `owner:      ${getAddress(owner)}`,
        `registry:   eip155:${ERC8004_CHAINS[chainKey]}:${ERC8004.identity}`,
        `tokenURI:   ${tokenURI ? (tokenURI.length > 80 ? tokenURI.slice(0, 80) + '…' : tokenURI) : '(none)'}`,
    ];
    if (card) {
        lines.push(``, `name:        ${card.name ?? '(unnamed)'}`, `description: ${card.description ?? ''}`, card.image ? `image:       ${card.image}` : '', `active:      ${card.active ?? '?'}`, `x402:        ${card.x402Support ? 'yes' : 'no'}`, `trust:       ${Array.isArray(card.supportedTrust) ? card.supportedTrust.join(', ') : '(none)'}`, `services:    ${Array.isArray(card.services) ? card.services.length : 0}`);
    }
    else if (tokenURI) {
        lines.push(``, `(could not fetch/decode the agent card from tokenURI)`);
    }
    return lines.filter(Boolean).join('\n');
}
function handleRegistries() {
    return [
        `=== ERC-8004 canonical registries (vanity-0x8004 singletons) ===`,
        `Identity Registry:   ${ERC8004.identity}  (ERC-721 "AgentIdentity")`,
        `Reputation Registry: ${ERC8004.reputation}`,
        ``,
        `Deployed (same address) on: ${Object.entries(ERC8004_CHAINS).map(([k, v]) => `${k} (${v})`).join(', ')}`,
        `Identity + Reputation verified live on Base mainnet (8453).`,
        ``,
        `Resolve an agent: chaingpt_erc8004_resolve_agent agentId=<id> chain=base`,
    ].join('\n');
}
function handleAgentCard(args) {
    const chainKey = String(args.chain ?? 'base');
    const card = {
        type: AGENTCARD_TYPE,
        name: String(args.name),
        description: args.description ? String(args.description) : '',
        image: args.image ? String(args.image) : undefined,
        services: Array.isArray(args.services) ? args.services : [],
        x402Support: args.x402Support === true,
        active: true,
        supportedTrust: Array.isArray(args.supportedTrust) ? args.supportedTrust.map(String) : ['reputation'],
    };
    if (args.agentId != null) {
        card.registrations = [{
                agentId: Number(args.agentId),
                agentRegistry: `eip155:${ERC8004_CHAINS[chainKey] ?? 8453}:${ERC8004.identity}`,
            }];
    }
    const json = JSON.stringify(card, null, 2);
    const out = [
        `=== ERC-8004 agent card (registration-v1) ===`,
        `Host at the agent's tokenURI or /.well-known/agent-card.json:`,
        json,
    ];
    if (args.emitDataUri) {
        const b64 = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
        out.push(``, `data: URI form (use directly as tokenURI):`, `data:application/json;base64,${b64}`);
    }
    return out.join('\n');
}
export async function handleErc8004Tool(name, args) {
    let text;
    const a = args ?? {};
    try {
        if (name === 'chaingpt_erc8004_resolve_agent')
            text = await handleResolve(a);
        else if (name === 'chaingpt_erc8004_registries')
            text = handleRegistries();
        else if (name === 'chaingpt_erc8004_agentcard')
            text = handleAgentCard(a);
        else
            throw new Error(`Unknown ERC-8004 tool: ${name}`);
    }
    catch (e) {
        text = `Error in ${name}: ${e?.message ?? e}`;
    }
    return { content: [{ type: 'text', text }] };
}
