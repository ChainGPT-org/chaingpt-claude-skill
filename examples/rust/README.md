# Rust example — ChainGPT AI News (reqwest + serde)

Minimal Rust program that calls the public ChainGPT AI News endpoint using `reqwest` (blocking, single-file) + `serde`. No SDK dependency.

## Run

```bash
cd examples/rust
CHAINGPT_API_KEY=your-key cargo run --release
```

Override the endpoint for local testing against the mock server:

```bash
CHAINGPT_API_KEY=anything CHAINGPT_API_BASE=http://localhost:3001/news/getNews \
  cargo run --release
```

## What it does

Sends a POST with a `NewsRequest` JSON body (limit, sortBy, sortOrder, languages) and the API key in the `Authorization: Bearer` header. Decodes the response and prints the latest 5 items.

## Why blocking reqwest

The blocking client keeps the example single-file: no tokio runtime, no async/.await, no executor boilerplate. For a real service you'd use the async variant — switch `default-features` and drop `blocking`, then make `main` an async tokio function.

## TLS backend

`rustls-tls` instead of the default `native-tls`. Rustls is a pure-Rust TLS implementation — no OpenSSL system dependency, makes the binary trivially portable to Alpine / scratch containers.

## Why this exists

Showing the bare-reqwest form makes it obvious the API is JSON-over-HTTP — anyone with an HTTP client can use it, no SDK necessary. The full surface (streaming, NFT, image generation, smart-contract generator) is documented at <https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk>.
