# Rust example — ChainGPT AI News (reqwest + serde)

Minimal Rust program that calls the public ChainGPT AI News endpoint using `reqwest` (blocking, single-file) + `serde`. No SDK dependency.

## Run

```bash
cd examples/rust
CHAINGPT_API_KEY=your-key cargo run --locked --release
```

Override the endpoint for local testing against the mock server:

```bash
CHAINGPT_API_KEY=anything CHAINGPT_API_BASE=http://localhost:3001/news/getNews \
  cargo run --locked --release
```

## What it does

Sends a POST with a `NewsRequest` JSON body (limit, sortBy, sortOrder, languages) and the API key in the `Authorization: Bearer` header. Decodes the response and prints the latest 5 items.

## Why blocking reqwest

The blocking client keeps `main` synchronous, with no async/.await or executor setup in the example. Reqwest manages its Tokio runtime internally. An async service can use reqwest's async client and configure its own runtime.

## TLS backend

`rustls-tls` instead of the default `native-tls` avoids an OpenSSL system dependency. Builds still need a compiler and linker for their target platform.

## Offline checks

The committed `Cargo.lock` pins the tested dependency graph. Prepare the toolchain
and dependency cache explicitly, then run checks without downloading or updating
dependencies:

```bash
cargo fetch --locked
cargo check --locked --offline
cargo test --locked --offline
cargo fmt --check
```

The full repository harness also uses `cargo check --locked --offline`. Keep
`Cargo.lock` under version control; `target/` contains generated build output.

## Why this exists

Showing the bare-reqwest form makes it obvious the API is JSON-over-HTTP — anyone with an HTTP client can use it, no SDK necessary. The full surface (streaming, NFT, image generation, smart-contract generator) is documented at <https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk>.
