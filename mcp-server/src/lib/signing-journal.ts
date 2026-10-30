/** Durable, fail-closed signing reservations. This is safety state, not telemetry.
 * A reservation is never automatically released after an uncertain result.
 * The exclusive directory lock is shared by processes. A crash leaves a stale
 * lock deliberately: an administrator must reconcile before removing it.
 */
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, renameSync, fsyncSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export type AssetSpend = { asset: string; recipient: string; amount: string };
export interface Reservation {
  network?: string; policyDigest?: string;
  operationId: string; fingerprint: string; ts: string; chainClass: string;
  valueWei: string; assets: AssetSpend[]; state: 'reserved' | 'prepared' | 'broadcast' | 'confirmed';
  hash?: string; signedBytes?: string;
}
export function journalDir(activityFile: string): string { return join(dirname(activityFile), 'signing-reservations'); }
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function operationFingerprint(input: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return digest(JSON.stringify(canonical(input)));
}
function operationPath(file: string, id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:/-]{1,180}$/.test(id)) throw new Error('operationId is required (1–180 safe characters); reuse it for retries of ONE action.');
  return join(journalDir(file), digest(id) + '.json');
}
export function durableJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  const dir = openSync(dirname(path), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
export async function withSigningLock<T>(activityFile: string, fn: () => Promise<T>): Promise<T> {
  const dir = journalDir(activityFile);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, '.lock');
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('Signing busy or recovery required: reconcile the signing journal before retrying. Stale locks are never cleared automatically.'); }
  try { return await fn(); } finally { rmdirSync(lock); }
}
export function readReservations(activityFile: string): Reservation[] {
  let names: string[];
  try { names = readdirSync(journalDir(activityFile)); }
  catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
  return names.filter(n => n.endsWith('.json')).map(n => {
    const r = JSON.parse(readFileSync(join(journalDir(activityFile), n), 'utf8')) as Reservation;
    if (!['evm','solana','tron'].includes(r.chainClass) || !r.operationId || !r.fingerprint || !Number.isFinite(Date.parse(r.ts)) || !/^\d+$/.test(r.valueWei) || !Array.isArray(r.assets) || !['reserved','prepared','broadcast','confirmed'].includes(r.state)) throw new Error('Signing journal corrupt; reconcile before signing.');
    for (const a of r.assets) if (!a.asset || !a.recipient || !/^\d+$/.test(a.amount)) throw new Error('Signing asset journal corrupt.');
    return r;
  });
}
export function findOperation(activityFile: string, id: string, fingerprint: string): Reservation | undefined {
  operationPath(activityFile, id); // validate even on first use
  const existing = readReservations(activityFile).find(r => r.operationId === id);
  if (existing && existing.fingerprint !== fingerprint) throw new Error('operationId already belongs to a different action.');
  return existing;
}
export function saveReservation(activityFile: string, r: Reservation): void { durableJson(operationPath(activityFile, r.operationId), r); }
export function reserveOperation(activityFile: string, input: Omit<Reservation, 'ts' | 'state'>): Reservation {
  if (findOperation(activityFile, input.operationId, input.fingerprint)) throw new Error('Operation already reserved; do not sign it again.');
  const r: Reservation = { ...input, ts: new Date().toISOString(), state: 'reserved' };
  saveReservation(activityFile, r);
  return r;
}
export function replayMessage(r: Reservation): string {
  return `Operation ${r.operationId} is already ${r.state}${r.hash ? ` (${r.hash})` : ''}. No new transaction was signed. Reconcile this operation before creating a replacement.`;
}
