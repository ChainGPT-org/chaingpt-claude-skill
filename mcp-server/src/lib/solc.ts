/**
 * Thin wrapper around the `solc` package (already a transitive dep of
 * @chaingpt/smartcontractgenerator). Provides a single compile() entry that
 * takes a Solidity source string and returns bytecode + ABI for the named
 * contract.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// solc has no ESM build; load via CJS interop
const solc: any = require('solc');

export interface CompileResult {
  bytecode: `0x${string}`;
  abi: any[];
  warnings: string[];
  errors: string[];
  /** The selected contract name; useful when source contains multiple contracts. */
  contractName: string;
  /** Compiler version actually used. */
  solcVersion: string;
}

export interface CompileOpts {
  /** Filename to label the source (mostly for error messages). */
  fileName?: string;
  /** Which contract to extract (defaults to the last contract in the file). */
  contractName?: string;
  /** Optimizer runs; 200 is the OpenZeppelin default. */
  optimizerRuns?: number;
  /** Solidity EVM version; defaults to the latest supported by the installed solc. */
  evmVersion?: string;
}

export function compileSolidity(source: string, opts: CompileOpts = {}): CompileResult {
  const fileName = opts.fileName ?? 'Contract.sol';
  const input = {
    language: 'Solidity',
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: opts.optimizerRuns ?? 200 },
      ...(opts.evmVersion ? { evmVersion: opts.evmVersion } : {}),
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  };

  const raw = solc.compile(JSON.stringify(input));
  const output = JSON.parse(raw);

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const msg of output.errors ?? []) {
    if (msg.severity === 'error') errors.push(msg.formattedMessage ?? msg.message);
    else warnings.push(msg.formattedMessage ?? msg.message);
  }
  if (errors.length > 0) {
    const err = new Error(`Solidity compilation failed:\n${errors.join('\n')}`);
    (err as any).errors = errors;
    (err as any).warnings = warnings;
    throw err;
  }

  // Pick the contract: explicit name if given, else the last defined
  const fileContracts = output.contracts?.[fileName] ?? {};
  const names = Object.keys(fileContracts);
  if (names.length === 0) {
    throw new Error(`Compilation produced no contracts for ${fileName}.`);
  }
  // If contractName is explicitly provided, FAIL FAST when it's not found.
  // Silently falling back to "last defined" risks deploying unintended bytecode.
  if (opts.contractName !== undefined && !names.includes(opts.contractName)) {
    throw new Error(
      `contractName "${opts.contractName}" not found in ${fileName}. ` +
      `Available: ${names.join(', ')}.`
    );
  }
  const pickName = opts.contractName ?? names[names.length - 1];
  const c = fileContracts[pickName];
  const bytecode = `0x${c.evm.bytecode.object}` as `0x${string}`;
  return {
    bytecode,
    abi: c.abi,
    warnings,
    errors,
    contractName: pickName,
    solcVersion: solc.version(),
  };
}
