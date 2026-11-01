// Binds "audit before mainnet deploy" to the exact code: which sources chaingpt_audit_contract audited, and
// which creation bytecode chaingpt_deploy_compile produced from which source. In memory, per server process.
// ponytail: lost on restart (re-run audit + compile); persist if long-lived deploy sessions need it.
import { createHash } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const auditedSources = new Set<string>();
const sourceOfBytecode = new Map<string, string>();

export function recordAudit(source: string): void {
  auditedSources.add(sha(source.trim()));
}

export function recordCompile(source: string, bytecode: string): void {
  sourceOfBytecode.set(sha(bytecode.toLowerCase()), sha(source.trim()));
}

/** True only when this bytecode was compiled here from a source that was audited here. */
export function bytecodeAudited(bytecode: string): boolean {
  const source = sourceOfBytecode.get(sha(bytecode.toLowerCase()));
  return source !== undefined && auditedSources.has(source);
}
