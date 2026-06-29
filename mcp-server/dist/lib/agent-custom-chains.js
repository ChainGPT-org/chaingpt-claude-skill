/**
 * Custom EVM chains added by the admin via the dashboard.
 *
 * The built-in chain registry (`lib/chains.ts`) covers the 10 mainnets the
 * plugin targets out-of-the-box. Admins who want to operate on niche L2s,
 * testnets, or chains we haven't added yet can register them here.
 *
 * Stored in JSON next to the policy file. Admin-managed only — no MCP tool
 * exposes a write to this file.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { policyPath } from './agent-policy.js';
import { CHAINS } from './chains.js';
export function customChainsPath() {
    // Derive from policy DIRECTORY (not via filename regex), so a non-policy.json
    // filename doesn't cause this path to collide with the policy file itself.
    return process.env.CHAINGPT_CUSTOM_CHAINS_FILE?.trim()
        || join(dirname(policyPath()), 'custom-chains.json');
}
const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const HTTPS_RE = /^https?:\/\/[^\s]+$/i;
export function loadCustomChains() {
    const path = customChainsPath();
    if (!existsSync(path))
        return [];
    try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((c) => {
            if (typeof c !== 'object' || c === null)
                return false;
            if (typeof c.slug !== 'string' || c.slug.length === 0)
                return false;
            if (typeof c.chainId !== 'number' || !Number.isInteger(c.chainId) || c.chainId < 1)
                return false;
            if (typeof c.name !== 'string' || c.name.length === 0)
                return false;
            if (typeof c.native !== 'string' || c.native.length === 0)
                return false;
            if (typeof c.rpcUrl !== 'string' || !/^https?:\/\//i.test(c.rpcUrl))
                return false;
            if (typeof c.addedAt !== 'string')
                return false;
            if (c.rpcFallbacks !== undefined) {
                if (!Array.isArray(c.rpcFallbacks))
                    return false;
                if (!c.rpcFallbacks.every((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))
                    return false;
            }
            if (c.explorer !== undefined && (typeof c.explorer !== 'string' || !/^https?:\/\//i.test(c.explorer)))
                return false;
            return true;
        });
    }
    catch {
        return [];
    }
}
export function saveCustomChains(chains) {
    const path = customChainsPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
        try {
            copyFileSync(path, path + '.bak');
            chmodSync(path + '.bak', 0o600);
        }
        catch { /* best-effort */ }
    }
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(chains, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
}
export function addCustomChain(input) {
    if (!SLUG_RE.test(input.slug))
        return { ok: false, error: `slug must be lowercase letters/digits/dashes, 2-31 chars (got "${input.slug}")` };
    if (CHAINS[input.slug])
        return { ok: false, error: `slug "${input.slug}" collides with a built-in chain` };
    if (!Number.isInteger(input.chainId) || input.chainId < 1)
        return { ok: false, error: `chainId must be a positive integer (got ${input.chainId})` };
    if (!input.name.trim())
        return { ok: false, error: 'name is required' };
    if (!input.native.trim())
        return { ok: false, error: 'native symbol is required' };
    if (!HTTPS_RE.test(input.rpcUrl))
        return { ok: false, error: 'rpcUrl must be a valid http(s) URL' };
    if (input.rpcFallbacks?.some((u) => !HTTPS_RE.test(u)))
        return { ok: false, error: 'rpcFallbacks entries must all be http(s) URLs' };
    if (input.explorer && !HTTPS_RE.test(input.explorer))
        return { ok: false, error: 'explorer must be a valid http(s) URL' };
    // Collisions with existing custom chains
    const existing = loadCustomChains();
    if (existing.some((c) => c.slug === input.slug))
        return { ok: false, error: `slug "${input.slug}" is already in use` };
    if (existing.some((c) => c.chainId === input.chainId))
        return { ok: false, error: `chainId ${input.chainId} is already in use` };
    // Collision with built-in chainIds
    for (const c of Object.values(CHAINS)) {
        if (c.chainId === input.chainId)
            return { ok: false, error: `chainId ${input.chainId} collides with built-in ${c.slug}` };
    }
    const next = { ...input, addedAt: new Date().toISOString() };
    const list = [...existing, next];
    saveCustomChains(list);
    return { ok: true, chains: list };
}
export function removeCustomChain(slug) {
    // Case-insensitive match — admin may pass "Zora" or "ZORA" via the UI form
    const normalized = slug.toLowerCase();
    const list = loadCustomChains().filter((c) => c.slug.toLowerCase() !== normalized);
    saveCustomChains(list);
    return list;
}
/**
 * Merge custom chains into a ChainInfo lookup map for use by the resolver
 * and the RPC fallback chain. Returns a fresh object on every call so
 * updates are visible without restart.
 */
export function mergedChains() {
    const merged = { ...CHAINS };
    for (const c of loadCustomChains()) {
        merged[c.slug] = {
            slug: c.slug,
            chainId: c.chainId,
            name: c.name,
            native: c.native,
            publicRpc: c.rpcUrl,
            publicRpcFallbacks: c.rpcFallbacks,
            explorer: c.explorer,
        };
    }
    return merged;
}
export function resolveChainWithCustom(input) {
    if (input === undefined || input === null || input === '')
        return undefined;
    const s = String(input).trim().toLowerCase();
    const merged = mergedChains();
    if (merged[s])
        return merged[s];
    const asNum = Number(s);
    if (!isNaN(asNum)) {
        for (const c of Object.values(merged)) {
            if (c.chainId === asNum)
                return c;
        }
    }
    return undefined;
}
export function rpcEndpointsWithCustom(slug) {
    // Case-insensitive lookup so "Base" and "base" both resolve.
    const merged = mergedChains();
    const c = merged[slug] ?? merged[slug.toLowerCase()];
    if (!c)
        return [];
    const list = [];
    if (c.publicRpc)
        list.push(c.publicRpc);
    if (c.publicRpcFallbacks)
        list.push(...c.publicRpcFallbacks);
    return list;
}
