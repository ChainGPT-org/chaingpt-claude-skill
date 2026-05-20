/**
 * Shared formatter for `simulateTransaction` results on custody-free Solana
 * signed-action tools (Marginfi, Kamino, …).
 *
 * The key correctness signal: a Solana/Anchor program logs
 * `Program log: Instruction: <name>` only AFTER it has successfully
 * deserialized the instruction data AND resolved every account. So if that
 * line appears, our instruction ENCODING is correct and any subsequent error
 * is the program rejecting on business rules (state) — e.g. insufficient
 * balance or no position yet. We deliberately do NOT pattern-match the error
 * string for tokens like "AccountNotFound", because program-level errors such
 * as Marginfi's `BankAccountNotFound` are benign state errors that would
 * false-positive a naive substring check.
 */

export interface SimValue {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
}

export function formatSimResult(sim: { value: SimValue }, programLabel: string): string {
  const { err, logs, unitsConsumed } = sim.value;
  if (err === null) {
    return [
      `Simulation: ✅ OK (the ${programLabel} program accepted the instruction)`,
      unitsConsumed ? `  compute units: ${unitsConsumed}` : '',
    ].filter(Boolean).join('\n');
  }
  const errStr = typeof err === 'string' ? err : JSON.stringify(err);
  const logStr = (logs ?? []).join('\n');
  const reachedHandler = /Program log: Instruction:/.test(logStr);
  // Errors that fire BEFORE the handler runs => the instruction never
  // deserialized / accounts didn't resolve => real encoding/account problem.
  const preHandlerEncodingError = /InstructionDidNotDeserialize|InvalidInstructionData|insufficient account keys|Failed to (de)?serialize|Program failed to complete|An account required by the instruction is missing/i.test(
    errStr + '\n' + logStr,
  );
  const encodingProblem = !reachedHandler && preHandlerEncodingError;
  return [
    `Simulation: ⚠ returned an error — ${errStr}`,
    encodingProblem
      ? `  ⛔ ENCODING/ACCOUNT problem — the instruction did not deserialize or an account failed to resolve. DO NOT sign this tx.`
      : reachedHandler
        ? `  ✅ Encoding verified: the ${programLabel} program deserialized the instruction and ran its handler. This is a STATE error (e.g. insufficient balance, or no position yet) — the tx is correctly built; it just won't succeed for THIS account/amount right now.`
        : `  This is likely a STATE error — the encoding appears fine. Review the logs below before signing.`,
    `  Program logs (tail):`,
    ...(logs ?? []).slice(-8).map((l) => `    ${l}`),
  ].join('\n');
}
