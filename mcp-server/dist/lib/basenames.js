/**
 * Basenames — ENS-style naming on Base (`name.base.eth`). Read helpers +
 * contract addresses. Resolution flow verified live against Base mainnet
 * (jesse.base.eth ↔ 0x2211…).
 *
 * Forward (name → address): namehash(name) → Registry.resolver(node) → Resolver.addr(node)
 * Reverse (address → name): ReverseRegistrar.node(addr) → Registry.resolver(rnode) → Resolver.name(rnode)
 */
import { createPublicClient, http, fallback, namehash, getAddress } from 'viem';
import { rpcEndpoints } from './chains.js';
export const BASENAMES = {
    8453: {
        registry: '0xb94704422c2a1e396835a571837aa5ae53285a95',
        baseRegistrar: '0x03c4738ee98ae44591e1a4a4f3cab6641d95dd9a',
        registrarController: '0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5',
        l2Resolver: '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD',
        reverseRegistrar: '0x79ea96012eea67a83431f1701b3dff7e37f9e282',
    },
    84532: {
        registry: '0x1493b2567056c2181630115660963E13A8E32735',
        baseRegistrar: '0xa0c70ec36c010b55e3c434d6c6ebeec50c705794',
        registrarController: '0x49ae3cc2e3aa768b1e5654f5d3c6002144a59581',
        l2Resolver: '0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA',
        reverseRegistrar: '0x876eF94ce0773052a2f81921E70FF25a5e76841f',
    },
};
export const REGISTRY_ABI = [
    { name: 'resolver', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
];
export const RESOLVER_ABI = [
    { name: 'addr', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
    { name: 'name', type: 'function', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'string' }] },
    { name: 'setAddr', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'a', type: 'address' }], outputs: [] },
];
export const REVERSE_REGISTRAR_ABI = [
    { name: 'node', type: 'function', stateMutability: 'view', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'bytes32' }] },
];
export const CONTROLLER_ABI = [
    { name: 'available', type: 'function', stateMutability: 'view', inputs: [{ name: 'name', type: 'string' }], outputs: [{ type: 'bool' }] },
    { name: 'registerPrice', type: 'function', stateMutability: 'view', inputs: [{ name: 'name', type: 'string' }, { name: 'duration', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
    {
        name: 'register', type: 'function', stateMutability: 'payable', outputs: [],
        inputs: [{
                name: 'request', type: 'tuple', components: [
                    { name: 'name', type: 'string' },
                    { name: 'owner', type: 'address' },
                    { name: 'duration', type: 'uint256' },
                    { name: 'resolver', type: 'address' },
                    { name: 'data', type: 'bytes[]' },
                    { name: 'reverseRecord', type: 'bool' },
                ],
            }],
    },
];
export function baseRpcEndpoints(chainId) {
    const network = chainId === 8453 ? 'base' : 'base-sepolia';
    const list = rpcEndpoints(network);
    // Power-user / reliability override: BASE_RPC_URL (or BASE_SEPOLIA_RPC_URL) wins.
    const env = chainId === 8453 ? process.env.BASE_RPC_URL : (process.env.BASE_SEPOLIA_RPC_URL ?? process.env.BASE_RPC_URL);
    if (env)
        return [env, ...list];
    if (list.length === 0)
        return [chainId === 8453 ? 'https://mainnet.base.org' : 'https://sepolia.base.org'];
    return list;
}
export function basePublicClient(chainId) {
    const transports = baseRpcEndpoints(chainId).map((url) => http(url, { timeout: 8_000 }));
    return createPublicClient({ transport: transports.length === 1 ? transports[0] : fallback(transports) });
}
/** Normalize a basename: ensure it ends with `.base.eth`. Returns { full, label }. */
export function normalizeBasename(input) {
    let full = input.trim().toLowerCase();
    if (!full.endsWith('.base.eth')) {
        full = full.replace(/\.base$/, '') + '.base.eth';
    }
    const label = full.slice(0, -'.base.eth'.length);
    if (!label || label.includes('.'))
        throw new Error(`Invalid basename "${input}" — expected a single label like "alice" or "alice.base.eth".`);
    return { full, label };
}
export async function resolveForward(chainId, name) {
    const { full } = normalizeBasename(name);
    const a = BASENAMES[chainId];
    const node = namehash(full);
    const resolver = await basePublicClient(chainId).readContract({ address: a.registry, abi: REGISTRY_ABI, functionName: 'resolver', args: [node] });
    if (!resolver || resolver === '0x0000000000000000000000000000000000000000')
        return null;
    const addr = await basePublicClient(chainId).readContract({ address: resolver, abi: RESOLVER_ABI, functionName: 'addr', args: [node] });
    if (!addr || addr === '0x0000000000000000000000000000000000000000')
        return null;
    return getAddress(addr);
}
export async function resolveReverse(chainId, address) {
    const a = BASENAMES[chainId];
    const client = basePublicClient(chainId);
    const rnode = await client.readContract({ address: a.reverseRegistrar, abi: REVERSE_REGISTRAR_ABI, functionName: 'node', args: [getAddress(address)] });
    const resolver = await client.readContract({ address: a.registry, abi: REGISTRY_ABI, functionName: 'resolver', args: [rnode] });
    if (!resolver || resolver === '0x0000000000000000000000000000000000000000')
        return null;
    const name = await client.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: 'name', args: [rnode] });
    return name || null;
}
