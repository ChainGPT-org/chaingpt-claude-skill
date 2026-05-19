# Go example — ChainGPT AI News (stdlib only)

Minimal Go program that calls the public ChainGPT AI News endpoint using only `net/http` + `encoding/json`. No SDK dependency.

## Run

```bash
cd examples/go
CHAINGPT_API_KEY=your-key go run main.go
```

Override the endpoint for local testing against the mock server:

```bash
CHAINGPT_API_KEY=anything CHAINGPT_API_BASE=http://localhost:3001/news/getNews go run main.go
```

## What it does

Sends a POST with a `NewsRequest` JSON body (limit, sortBy, sortOrder, languages) and the API key in the `Authorization: Bearer` header. Decodes the response and prints the latest 5 items.

## Why this exists

Most ChainGPT integrations are TypeScript or Python today. Showing the bare-stdlib Go form makes it obvious the API is just JSON-over-HTTP — anyone with a `net/http` client can use it, no SDK necessary.

If you want the full feature surface (token-by-token streaming, all categories, image generation, NFT minting), the public API gateway docs map every endpoint: <https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk>.
