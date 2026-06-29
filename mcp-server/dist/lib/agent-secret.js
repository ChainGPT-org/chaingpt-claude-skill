/**
 * Passphrase resolution for the agent-wallet keystore.
 *
 * The keystore is AES-256-GCM encrypted with a passphrase. Where that
 * passphrase comes from is resolved here, in priority order:
 *
 *   1. CHAINGPT_AGENT_WALLET_PASSPHRASE env var  — explicit power-user override.
 *      Highest priority. Never touches disk or keychain. Best for CI / headless.
 *   2. OS keychain                                — auto-managed secret.
 *      macOS Keychain (`security`) or Linux libsecret (`secret-tool`).
 *      Generated once at init, read back on every load. Never in LLM context.
 *
 * Why a keychain instead of "auto-generate and write a .passphrase file":
 *   writing the passphrase to disk next to the keystore is taping the key to
 *   the lock — anyone who can read keystore.json can read the passphrase. The
 *   OS keychain keeps the secret out of plaintext-on-disk AND out of the LLM's
 *   context. It is unlocked while the user is logged in, so a local attacker
 *   on an unlocked session could still reach it — a far higher bar than a
 *   plaintext file, and appropriate for a low-value bounded hot wallet.
 *
 * We shell out to the OS keychain CLI (no native node dependency like keytar,
 * which would add a node-gyp build step that breaks on some user machines).
 * If no keychain backend is available (e.g. headless Linux without
 * gnome-keyring), keychain support is simply absent and the env var is
 * required — exactly the pre-keychain behavior, so there is no regression.
 *
 * Security note: on macOS, `security add-generic-password -w <value>` passes
 * the secret as an argv element, briefly visible to `ps` on the local machine
 * during the ~10ms the command runs. For a single-user dev machine holding a
 * low-value hot wallet this is an accepted tradeoff; a power user who wants
 * zero process-list exposure should use the env var instead.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const SERVICE = 'chaingpt-mcp-agent-wallet';
const ACCOUNT = 'keystore-passphrase';
const ENV_VAR = 'CHAINGPT_AGENT_WALLET_PASSPHRASE';
// Test escape hatch: set CHAINGPT_DISABLE_KEYCHAIN=1 to force env-only
// resolution (used by the unit tests, which have no real keychain).
function keychainDisabled() {
    return process.env.CHAINGPT_DISABLE_KEYCHAIN === '1';
}
/** Which keychain CLI is available on this host, if any. */
export function detectKeychainBackend() {
    if (keychainDisabled())
        return null;
    if (process.platform === 'darwin') {
        if (commandExists('security'))
            return 'macos-keychain';
        return null;
    }
    if (process.platform === 'linux') {
        if (commandExists('secret-tool'))
            return 'libsecret';
        return null;
    }
    // Windows / others: no first-class CLI keychain we shell out to today.
    return null;
}
function commandExists(cmd) {
    try {
        // `command -v` is POSIX and doesn't execute the target.
        execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/** Read the passphrase from the OS keychain. Returns null if absent/unavailable. */
function keychainGet() {
    const backend = detectKeychainBackend();
    if (!backend)
        return null;
    try {
        if (backend === 'macos-keychain') {
            const out = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const v = out.replace(/\n$/, '');
            return v.length ? v : null;
        }
        if (backend === 'libsecret') {
            const out = execFileSync('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const v = out.replace(/\n$/, '');
            return v.length ? v : null;
        }
    }
    catch {
        // Not found / locked / no service running → treat as absent.
        return null;
    }
    return null;
}
/** Store a passphrase in the OS keychain. Throws if the backend write fails. */
function keychainSet(value) {
    const backend = detectKeychainBackend();
    if (!backend)
        throw new Error('No OS keychain backend available on this host.');
    if (backend === 'macos-keychain') {
        // -U updates the entry if it already exists rather than erroring.
        execFileSync('security', ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', value, '-U'], { stdio: 'ignore' });
        return;
    }
    if (backend === 'libsecret') {
        // secret-tool reads the secret from stdin (no argv exposure).
        execFileSync('secret-tool', ['store', '--label=ChainGPT MCP agent wallet passphrase', 'service', SERVICE, 'account', ACCOUNT], { input: value, stdio: ['pipe', 'ignore', 'ignore'] });
        return;
    }
}
/**
 * Resolve the keystore passphrase. Env var wins; otherwise the keychain.
 * Returns the value plus where it came from (for status display).
 */
export function resolvePassphrase() {
    const env = process.env[ENV_VAR]?.trim();
    if (env)
        return { value: env, source: 'env' };
    const kc = keychainGet();
    if (kc)
        return { value: kc, source: 'keychain' };
    return { value: null, source: 'none' };
}
/**
 * Generate a cryptographically strong passphrase and store it in the OS
 * keychain. Used at init when no env var is set and a keychain is available.
 * 32 random bytes → 43-char base64url. Returns the value + source.
 */
export function provisionKeychainPassphrase() {
    const value = randomBytes(32).toString('base64url'); // 256 bits, URL-safe, no padding
    keychainSet(value);
    return { value, source: 'keychain' };
}
/** Human-readable description of where the passphrase lives, for status output. */
export function describeSecretSource(source) {
    switch (source) {
        case 'env':
            return `env var ${ENV_VAR}`;
        case 'keychain':
            return `OS keychain (${detectKeychainBackend() ?? 'unknown backend'}, service="${SERVICE}")`;
        case 'none':
            return 'not set';
    }
}
