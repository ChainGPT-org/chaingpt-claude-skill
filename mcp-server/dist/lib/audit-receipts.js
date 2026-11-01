// Binds "audit before mainnet deploy" to the exact code: which sources chaingpt_audit_contract audited, and
// which creation bytecode chaingpt_deploy_compile produced from which source. In memory, per server process.
// ponytail: lost on restart (re-run audit + compile); persist if long-lived deploy sessions need it.
import { createHash } from 'node:crypto';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const auditedSources = new Set();
const sourceOfBytecode = new Map();
export function recordAudit(source) {
    auditedSources.add(sha(source.trim()));
}
export function recordCompile(source, bytecode) {
    sourceOfBytecode.set(sha(bytecode.toLowerCase()), sha(source.trim()));
}
/** True only when this bytecode was compiled here from a source that was audited here. */
export function bytecodeAudited(bytecode) {
    const source = sourceOfBytecode.get(sha(bytecode.toLowerCase()));
    return source !== undefined && auditedSources.has(source);
}
