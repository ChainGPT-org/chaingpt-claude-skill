import { encodeFunctionData, namehash, isAddress, getAddress, formatEther } from 'viem';
import { BASENAMES, CONTROLLER_ABI, RESOLVER_ABI, basePublicClient, normalizeBasename, resolveForward, resolveReverse, } from '../lib/basenames.js';
/**
 * Tier-7 Base — Basenames (`name.base.eth`) resolution + registration. Reads are
 * verified live against Base mainnet; registration returns an UNSIGNED tx
 * (custody-free). 0 ChainGPT credits.
 */
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
export const baseTools = [
    {
        name: 'chaingpt_base_resolve_name',
        description: 'Resolve a Basename (`name.base.eth`) on Base. Forward: name → address. Reverse: address → primary basename. ' +
            'Auto-detects direction from the input (a 0x address does reverse; a name does forward). Read-only. 0 credits.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'A basename (e.g. "jesse" or "jesse.base.eth") for forward, OR a 0x address for reverse.' },
                testnet: { type: 'boolean', description: 'Use Base Sepolia (84532) instead of mainnet (8453). Default false.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'chaingpt_base_name_availability',
        description: 'Check whether a Basename label is available to register and its price for a given duration (default 1 year). ' +
            'Read-only against Base. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The label to check (e.g. "alice" or "alice.base.eth").' },
                years: { type: 'number', description: 'Registration duration in years (default 1).' },
                testnet: { type: 'boolean', description: 'Use Base Sepolia. Default false.' },
            },
            required: ['name'],
        },
    },
    {
        name: 'chaingpt_base_register_name_tx',
        description: 'Build an UNSIGNED transaction to register a Basename via the RegistrarController (custody-free). Sets the ' +
            "resolver's address record to the owner and (optionally) a reverse record so the name resolves both ways " +
            'immediately. Returns the unsigned tx incl. the payable ETH value (the registration price). Mainnet requires ' +
            'acknowledgeMainnet:true. 0 ChainGPT credits.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The label to register (e.g. "alice").' },
                owner: { type: 'string', description: 'Address that will own the name and that it will resolve to.' },
                years: { type: 'number', description: 'Duration in years (default 1).' },
                reverseRecord: { type: 'boolean', description: 'Also set the reverse record (address → name). Default true.' },
                testnet: { type: 'boolean', description: 'Use Base Sepolia. Default false.' },
                acknowledgeMainnet: { type: 'boolean', description: 'Must be true to build a mainnet registration tx.', default: false },
            },
            required: ['name', 'owner'],
        },
    },
];
function chainIdFrom(args) {
    return (args.testnet ? 84532 : 8453);
}
async function handleResolve(args) {
    const q = String(args.query).trim();
    const chainId = chainIdFrom(args);
    const net = chainId === 8453 ? 'Base' : 'Base Sepolia';
    if (isAddress(q)) {
        const name = await resolveReverse(chainId, q);
        return name
            ? `${getAddress(q)}  →  ${name}   (${net} reverse)`
            : `${getAddress(q)} has no primary Basename set on ${net}.`;
    }
    const { full } = normalizeBasename(q);
    const addr = await resolveForward(chainId, full);
    return addr
        ? `${full}  →  ${addr}   (${net} forward)`
        : `${full} does not resolve to an address on ${net} (unregistered or no addr record).`;
}
async function handleAvailability(args) {
    const chainId = chainIdFrom(args);
    const { full, label } = normalizeBasename(String(args.name));
    const years = BigInt(Math.max(1, Math.floor(Number(args.years ?? 1))));
    const duration = years * SECONDS_PER_YEAR;
    const a = BASENAMES[chainId];
    const client = basePublicClient(chainId);
    const available = await client.readContract({ address: a.registrarController, abi: CONTROLLER_ABI, functionName: 'available', args: [label] });
    let priceLine = '';
    if (available) {
        const price = await client.readContract({ address: a.registrarController, abi: CONTROLLER_ABI, functionName: 'registerPrice', args: [label, duration] });
        priceLine = `\nPrice (${years}yr): ${formatEther(price)} ETH (${price} wei)`;
    }
    return [
        `${full} — ${available ? 'AVAILABLE ✅' : 'taken ❌'} on ${chainId === 8453 ? 'Base' : 'Base Sepolia'}${priceLine}`,
        available ? `\nNext: chaingpt_base_register_name_tx name="${label}" owner=<your address>` : '',
    ].filter(Boolean).join('');
}
async function handleRegisterTx(args) {
    const chainId = chainIdFrom(args);
    if (chainId === 8453 && args.acknowledgeMainnet !== true) {
        return `Refusing to build a mainnet Basename registration without acknowledgeMainnet:true. Verify the label, owner, and price first (chaingpt_base_name_availability), then re-call with acknowledgeMainnet:true.`;
    }
    const owner = String(args.owner);
    if (!isAddress(owner))
        throw new Error(`owner is not a valid EVM address: ${owner}`);
    const { full, label } = normalizeBasename(String(args.name));
    const years = BigInt(Math.max(1, Math.floor(Number(args.years ?? 1))));
    const duration = years * SECONDS_PER_YEAR;
    const reverseRecord = args.reverseRecord !== false;
    const a = BASENAMES[chainId];
    const client = basePublicClient(chainId);
    const available = await client.readContract({ address: a.registrarController, abi: CONTROLLER_ABI, functionName: 'available', args: [label] });
    if (!available)
        throw new Error(`${full} is not available — it is already registered.`);
    const price = await client.readContract({ address: a.registrarController, abi: CONTROLLER_ABI, functionName: 'registerPrice', args: [label, duration] });
    // data[] runs through the resolver at registration: set the addr record so the
    // name resolves to the owner immediately.
    const node = namehash(full);
    const setAddrData = encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setAddr', args: [node, getAddress(owner)] });
    const data = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: 'register',
        args: [{
                name: label,
                owner: getAddress(owner),
                duration,
                resolver: a.l2Resolver,
                data: [setAddrData],
                reverseRecord,
            }],
    });
    const tx = { chainId, to: a.registrarController, data, value: '0x' + price.toString(16) };
    return [
        `=== Basename registration — UNSIGNED (${chainId === 8453 ? 'Base mainnet' : 'Base Sepolia'}) ===`,
        ``,
        `name:     ${full}`,
        `owner:    ${getAddress(owner)}`,
        `duration: ${years} year(s)`,
        `price:    ${formatEther(price)} ETH (sent as tx value)`,
        `resolver: ${a.l2Resolver} (addr record set to owner; reverseRecord=${reverseRecord})`,
        ``,
        `--- Unsigned transaction (payable) ---`,
        JSON.stringify(tx, null, 2),
        ``,
        `Custody-free: sign + send with the owner wallet. The ETH value IS the registration fee.`,
    ].join('\n');
}
export async function handleBaseTool(name, args) {
    let text;
    const a = args ?? {};
    try {
        if (name === 'chaingpt_base_resolve_name')
            text = await handleResolve(a);
        else if (name === 'chaingpt_base_name_availability')
            text = await handleAvailability(a);
        else if (name === 'chaingpt_base_register_name_tx')
            text = await handleRegisterTx(a);
        else
            throw new Error(`Unknown Base tool: ${name}`);
    }
    catch (e) {
        text = `Error in ${name}: ${e?.message ?? e}`;
    }
    return { content: [{ type: 'text', text }] };
}
