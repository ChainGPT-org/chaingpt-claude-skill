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
`$@solana/web3.js`, npm's reference to the existing direct pin **1.99.0**.
That reviewed implementation uses rpc-websockets' public API. Other Solana
consumers retain their existing resolutions, including Marginfi's 1.98.0 copy.
Jito remains at 3.0.1; Jayson, gRPC and all security overrides remain unchanged.
No new package versions, runtime shims, lifecycle scripts or application code
are introduced. Six obsolete Jito-only lockfile entries are removed. Revisit
the scoped override alongside future changes to either Jito or the direct pin:
it intentionally exceeds Jito's legacy `~1.77.3` dependency range.

## Regression coverage

`mcp-server/src/__tests__/jito-compatibility.test.ts` exercises the actual installed
CommonJS packages through Pyth's Jito resolution path:

- Full Jito and Pyth solana-utils public imports and shared Solana implementation.
- Legacy, versioned and lookup-table transaction packet round trips with identical
  signed bytes; tip recipient, amount and blockhash; bundle capacity limits.
- Pyth's signing helper through Jito's SearcherClient and real protobuf request
  codec, including wallet refusal and submission-error propagation without retries.
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
**632 MCP tests and 61 mock tests**, including **11 added cases**, both TypeScript
checks and all seven offline harness layers. All 47 Solidity blocks compiled;
six launcher/guard checks passed and boot smoke listed 155 unique tools. An isolated
build reproduced all 76 committed JavaScript files byte for byte. Both full lockfile
audits reported zero known findings. The 16 incident-scanner regression tests passed.
Go/Rust example checks were skipped because those toolchains were unavailable.

Repository GitHub Actions remains disabled. Local checks use disposable keys and
fixtures with external networking blocked. They do not establish acceptance by
the live Jito block engine, mainnet execution or funded-chain acceptance.
