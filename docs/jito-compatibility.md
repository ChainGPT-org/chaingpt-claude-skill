# Jito dependency compatibility

The Pyth path `@pythnetwork/solana-utils@0.4.2 → jito-ts@3.0.1` previously
resolved Solana Web3.js 1.77.4. Its Node bundle imports private paths
`rpc-websockets/dist/lib/client` and `rpc-websockets/dist/lib/client/websocket`.
The nested rpc-websockets 7.11.2 package no longer supplies those resolvable
JavaScript paths. Node continues searching and encounters the root 9.3.9
package's exports boundary, producing `ERR_PACKAGE_PATH_NOT_EXPORTED`.
This prevents both Jito and Pyth solana-utils public imports. The same
[upstream import failure](https://github.com/pyth-network/pyth-crosschain/issues/1838)
was reported through the Pyth consumer path; local reproduction establishes
the failure in this repository's exact locked graph.

The MCP manifest overrides **only Jito's** `@solana/web3.js` dependency with
the exact pin **1.91.9**. This version imports the explicit `.cjs` paths provided
by the existing nested rpc-websockets 7.11.2 package and retains the legacy
`SendTransactionError(message, logs)` constructor used by Jito's `simulateBundle`.
Solana 1.92+ changes that constructor to an options object; using the application's
1.99.0 pin for Jito would discard simulation error details and logs. A regression
test reproduced that second incompatibility before the pin was corrected.

Other Solana consumers retain their existing resolutions, including the application's
1.99.0 and Marginfi's 1.98.0 copies. Jito remains at 3.0.1; Jayson, gRPC and all
security overrides remain unchanged. The Jito lockfile subtree updates Solana
1.77.4 to 1.91.9, removes its unused superstruct 0.14.2 copy, and adds nested copies
of Noble curves 1.9.7 and hashes 1.8.0, both already resolved elsewhere in the graph.
No runtime shims, lifecycle scripts or application code are introduced. Revisit
the scoped override alongside future Jito changes: it intentionally exceeds Jito's
legacy `~1.77.3` range and must preserve its error API as well as its import paths.

## Regression coverage

`mcp-server/src/__tests__/jito-compatibility.test.ts` exercises the actual installed
CommonJS packages through Pyth's Jito resolution path:

- Full Jito and Pyth solana-utils public imports and scoped dependency pins.
- Legacy, versioned and lookup-table transaction packet round trips with identical
  signed bytes; tip recipient, amount, blockhash and cryptographically valid
  signature; bundle capacity limits.
- Pyth's signing helper through Jito's SearcherClient and real protobuf request
  codec, starting unsigned, using the wallet's separate signed return object and
  verifying the submitted signature, including wallet
  refusal and submission-error propagation without retries.
- Jito bundle simulation success and failure, preserving error messages and logs.
- A real loopback WebSocket slot subscription, notification and unsubscribe using
  the Solana implementation resolved by Jito.

The moderate dependency suite additionally makes a fixture-only `Connection.getVersion()`
call through that same Jito path. Before the dependency change, all eight initial
Jito cases failed at the original private import. The added error-path cases
and HTTP RPC check extend that regression coverage.

Use fresh scripts-disabled installs before validation:

```bash
npm ci --prefix mcp-server --ignore-scripts
npm ci --prefix mock-server --ignore-scripts
bash scripts/test-all.sh --fast
npm audit --prefix mcp-server --package-lock-only
npm audit --prefix mock-server --package-lock-only
```

Verification on Node.js 26.9.0 with fresh scripts-disabled MCP installation passed
**634 MCP tests and 61 mock tests**, including **13 added cases**, both TypeScript
checks and all seven offline harness layers. All 47 Solidity blocks compiled;
six launcher/guard checks passed and boot smoke listed 155 unique tools. An isolated
build reproduced all 76 committed JavaScript files byte for byte. Both full lockfile
audits reported zero known findings. The 16 incident-scanner regression tests passed.
Go/Rust example checks were skipped because those toolchains were unavailable.

Repository GitHub Actions remains disabled. Local checks use disposable keys and
fixtures with external networking blocked. They do not establish acceptance by
the live Jito block engine, mainnet execution or funded-chain acceptance.
