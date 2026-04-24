# ChainGPT Error Codes & Troubleshooting

## HTTP Error Codes (All Products)

| Code | Meaning | Cause | Fix |
|------|---------|-------|-----|
| 400 | Bad Request | Missing/invalid required field | Verify `model` and `question`/`prompt` params |
| 401 | Unauthorized | Missing or invalid API key | Check `Authorization: Bearer <key>` header |
| 402 | Payment Required | Insufficient credits | Top up at https://app.chaingpt.org/addcredits |
| 403 | Forbidden | Credits exhausted or key revoked | Check credit balance, regenerate key if needed |
| 404 | Not Found | Wrong endpoint | LLM/Generator/Auditor use `/chat/stream` not `/chat`. News uses `/news` |
| 429 | Too Many Requests | Rate limit exceeded (200/min) | Implement exponential backoff, reduce request frequency |
| 5xx | Server Error | ChainGPT infrastructure issue | Retry after 1-5 second delay with exponential backoff |

## JavaScript SDK Error Classes

| Product | Error Class | Import |
|---------|------------|--------|
| LLM Chatbot | `Errors.GeneralChatError` | `import { Errors } from '@chaingpt/generalchat'` |
| NFT Generator | `Errors.NftError` | `import { Errors } from '@chaingpt/nft'` |
| Contract Generator | `Errors.SmartContractGeneratorError` | `import { Errors } from '@chaingpt/smartcontractgenerator'` |
| Contract Auditor | `Errors.SmartContractAuditorError` | `import { Errors } from '@chaingpt/smartcontractauditor'` |
| AI News | `Errors.AINewsError` | `import { Errors } from '@chaingpt/ainews'` |

## Python SDK Exception Hierarchy

```
ChainGPTError (base)
├── APIError (various HTTP codes)
├── AuthenticationError (401)
├── ValidationError (400)
├── InsufficientCreditsError (402/403)
├── RateLimitError (429)
├── NotFoundError (404)
├── ServerError (5xx)
├── TimeoutError (network timeout)
├── StreamingError (streaming issues)
└── ConfigurationError (invalid config)
```

## Common Patterns

### JavaScript Error Handling
```javascript
import { GeneralChat, Errors } from '@chaingpt/generalchat';
try {
  const res = await chat.createChatBlob({ question: '...', chatHistory: 'off' });
} catch (error) {
  if (error instanceof Errors.GeneralChatError) {
    console.error('ChainGPT Error:', error.message);
    // Check for specific HTTP status in error
  }
}
```

### Python Error Handling
```python
from chaingpt.exceptions import InsufficientCreditsError, RateLimitError, AuthenticationError
try:
    response = await client.llm.chat(request)
except InsufficientCreditsError:
    print("Top up credits at https://app.chaingpt.org/addcredits")
except RateLimitError:
    print("Rate limited — implement backoff")
except AuthenticationError:
    print("Check your API key")
```

### Retry Pattern (recommended)
```javascript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.status === 429 || e.status >= 500) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        continue;
      }
      throw e;
    }
  }
}
```

## Troubleshooting Guide

### "404 Not Found" on chat requests
Wrong endpoint. Use `POST /chat/stream` (not `/chat`). All chat-based products (LLM, Generator, Auditor) share this single endpoint.

### Streaming returns garbled text
Ensure responseType is set to "stream" in axios, or use the SDK which handles this automatically.

### Chat history not working
1. Ensure `chatHistory: "on"` in request
2. Provide consistent `sdkUniqueId` across requests
3. Costs +0.5 to +1 credit per request

### NFT generation stuck in "processing"
Poll GET /nft/progress/{collectionId} every 2-5 seconds. Large batches may take several minutes.

### Credits depleting faster than expected
Check: chat history doubles LLM costs, NFT upscaling adds 1-2 credits per image, Dale3 costs 4.75-14.25 credits per image, news API charges per 10 records not per request.
