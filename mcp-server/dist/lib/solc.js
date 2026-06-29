/**
 * Thin wrapper around the `solc` package (already a transitive dep of
 * @chaingpt/smartcontractgenerator). Provides a single compile() entry that
 * takes a Solidity source string and returns bytecode + ABI for the named
 * contract.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// solc has no ESM build; load via CJS interop
const solc = require('solc');
export function compileSolidity(source, opts = {}) {
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
    const errors = [];
    const warnings = [];
    for (const msg of output.errors ?? []) {
        if (msg.severity === 'error')
            errors.push(msg.formattedMessage ?? msg.message);
        else
            warnings.push(msg.formattedMessage ?? msg.message);
    }
    if (errors.length > 0) {
        const err = new Error(`Solidity compilation failed:\n${errors.join('\n')}`);
        err.errors = errors;
        err.warnings = warnings;
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
        throw new Error(`contractName "${opts.contractName}" not found in ${fileName}. ` +
            `Available: ${names.join(', ')}.`);
    }
    const pickName = opts.contractName ?? names[names.length - 1];
    const c = fileContracts[pickName];
    const bytecode = `0x${c.evm.bytecode.object}`;
    return {
        bytecode,
        abi: c.abi,
        warnings,
        errors,
        contractName: pickName,
        solcVersion: solc.version(),
    };
}
