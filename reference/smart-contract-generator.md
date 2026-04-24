# Smart Contract Generator - API & SDK Reference

## Overview

The ChainGPT Smart Contract Generator creates Solidity smart contracts from natural language descriptions. It supports all EVM-compatible chains including Ethereum, BNB Chain, Arbitrum, Avalanche, Berachain, Polygon, Optimism, Base, and any other EVM network.

---

## REST API

### Generate Contract (Streaming)

```
POST https://api.chaingpt.org/chat/stream
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Must be `"smart_contract_generator"` |
| `question` | string | Yes | Natural language contract description |
| `chatHistory` | string | No | `"on"` or `"off"` (default `"off"`) |
| `sdkUniqueId` | string | No | Session ID for grouping conversations |

**Response:**

```json
{
  "status": "success",
  "data": {
    "user": "Create an ERC-20 token called MyToken with symbol MTK and 1 million supply",
    "bot": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\nimport \"@openzeppelin/contracts/token/ERC20/ERC20.sol\";\n..."
  }
}
```

### Retrieve Chat History

```
GET https://api.chaingpt.org/chat/chatHistory
Authorization: Bearer <API_KEY>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | int | 10 | Number of records to return |
| `offset` | int | 0 | Pagination offset |
| `sortBy` | string | `"createdAt"` | Sort field |
| `sortOrder` | string | `"DESC"` | `"ASC"` or `"DESC"` |

---

## JavaScript SDK

### Installation

```bash
npm install --save @chaingpt/smartcontractgenerator
```

### Initialization

```javascript
const { SmartContractGenerator } = require("@chaingpt/smartcontractgenerator");

const generator = new SmartContractGenerator({
  apiKey: "YOUR_API_KEY",
});
```

### Methods

#### createSmartContractBlob(options)

Returns a complete response as a Promise.

```javascript
const response = await generator.createSmartContractBlob({
  question: "Create an ERC-20 token called MyToken with symbol MTK and 1 million supply",
  chatHistory: "on",
  sdkUniqueId: "my-session-123",
});

console.log(response.data.bot); // Solidity code
```

#### createSmartContractStream(options)

Returns a readable stream for real-time output.

```javascript
const stream = await generator.createSmartContractStream({
  question: "Create an ERC-721 NFT contract with minting, royalties, and metadata URI",
  chatHistory: "off",
});

stream.on("data", (chunk) => process.stdout.write(chunk.toString()));
stream.on("end", () => console.log("\nStream complete"));
```

#### getChatHistory(options)

Retrieves previous generation history.

```javascript
const history = await generator.getChatHistory({
  limit: 20,
  offset: 0,
  sortBy: "createdAt",
  sortOrder: "DESC",
});

console.log(history.data.rows);
```

### Error Handling

```javascript
const { Errors } = require("@chaingpt/smartcontractgenerator");

try {
  const response = await generator.createSmartContractBlob({ question: "..." });
} catch (error) {
  if (error instanceof Errors.SmartContractGeneratorError) {
    console.error("Generator error:", error.message);
  }
}
```

---

## Python SDK

### Installation

```bash
pip install chaingpt
```

### Initialization

```python
from chaingpt import ChainGPTClient
from chaingpt.models import SmartContractGeneratorRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")
```

### Methods

#### generate_contract (Blob)

```python
request_data = SmartContractGeneratorRequestModel(
    question="Create a staking contract that accepts ERC-20 tokens with a 12% APY and 30-day lock period",
    chat_history="on",
    sdk_unique_id="my-session-456"
)

response = client.smart_contract.generate_contract(request_data)
print(response.data.bot)  # Solidity code
```

The model field is automatically set to `"smart_contract_generator"` by the SDK.

#### stream_contract (Streaming)

```python
import asyncio

async def stream_contract():
    request_data = SmartContractGeneratorRequestModel(
        question="Create a vesting contract with cliff period, linear release over 24 months, and revocable by admin",
        chat_history="off"
    )

    async for chunk in client.smart_contract.stream_contract(request_data):
        print(chunk, end="", flush=True)

asyncio.run(stream_contract())
```

#### get_chat_history

```python
history = client.smart_contract.get_chat_history(
    limit=20,
    offset=0,
    sort_by="createdAt",
    sort_order="DESC"
)

for row in history.data.rows:
    print(row)
```

---

## cURL Examples

### Generate an ERC-20 Token

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_generator",
    "question": "Create an ERC-20 token called ChainToken with symbol CHAIN, 18 decimals, 10 million total supply, mint and burn functions, and owner-only pause capability",
    "chatHistory": "off"
  }'
```

### Generate an ERC-721 NFT Contract

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_generator",
    "question": "Create an ERC-721 NFT contract with whitelisted presale minting at 0.05 ETH, public minting at 0.08 ETH, max supply of 10000, reveal mechanism, and 5% royalties via ERC-2981",
    "chatHistory": "off"
  }'
```

### Generate a Staking Contract

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_generator",
    "question": "Create a staking contract where users deposit an ERC-20 token and earn rewards at 15% APY, with a 7-day minimum lock, emergency withdraw with 10% penalty, and admin can update reward rate",
    "chatHistory": "on",
    "sdkUniqueId": "staking-session-001"
  }'
```

### Generate a Vesting Contract

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_generator",
    "question": "Create a token vesting contract with 6-month cliff, 24-month linear vesting, multiple beneficiaries, revocable by owner, and emergency release function",
    "chatHistory": "off"
  }'
```

### Retrieve Chat History

```bash
curl -X GET "https://api.chaingpt.org/chat/chatHistory?limit=10&offset=0&sortBy=createdAt&sortOrder=DESC" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Full JavaScript Examples

### Blob: ERC-20 Token Generation

```javascript
const { SmartContractGenerator } = require("@chaingpt/smartcontractgenerator");

async function generateERC20() {
  const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY });

  const response = await generator.createSmartContractBlob({
    question: "Create an ERC-20 token called RewardToken with symbol RWD, 18 decimals, 50 million supply, burnable, pausable, with snapshot functionality for governance",
    chatHistory: "off",
  });

  console.log("Generated contract:");
  console.log(response.data.bot);
}

generateERC20();
```

### Stream: Staking Contract Generation

```javascript
const { SmartContractGenerator } = require("@chaingpt/smartcontractgenerator");

async function streamStakingContract() {
  const generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY });

  const stream = await generator.createSmartContractStream({
    question: "Create a multi-pool staking contract supporting 3 lock tiers (30, 90, 180 days) with increasing APY (10%, 18%, 30%), auto-compounding rewards, and emergency withdrawal with penalty",
    chatHistory: "on",
    sdkUniqueId: "staking-stream-001",
  });

  let fullCode = "";
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    fullCode += text;
    process.stdout.write(text);
  });

  stream.on("end", () => {
    console.log("\n\nGeneration complete. Total length:", fullCode.length);
  });
}

streamStakingContract();
```

---

## Full Python Examples

### Blob: ERC-721 NFT Contract

```python
from chaingpt import ChainGPTClient
from chaingpt.models import SmartContractGeneratorRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")

request_data = SmartContractGeneratorRequestModel(
    question="Create an ERC-721A NFT contract with batch minting, merkle tree whitelist verification, max 3 per wallet in presale, max 5 per wallet in public, 0.06 ETH mint price, and provenance hash for fair distribution",
    chat_history="off"
)

response = client.smart_contract.generate_contract(request_data)
print(response.data.bot)
```

### Stream: Vesting Contract

```python
import asyncio
from chaingpt import ChainGPTClient
from chaingpt.models import SmartContractGeneratorRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")

async def stream_vesting():
    request_data = SmartContractGeneratorRequestModel(
        question="Create a vesting contract for a team token allocation: 6-month cliff, 36-month linear vesting, revocable by multisig admin, supports multiple beneficiaries with different allocations, and emits events for each claim",
        chat_history="on",
        sdk_unique_id="vesting-session-001"
    )

    async for chunk in client.smart_contract.stream_contract(request_data):
        print(chunk, end="", flush=True)

asyncio.run(stream_vesting())
```

---

## Pricing

| Action | Cost |
|--------|------|
| Contract generation (no history) | 1 credit |
| Contract generation (with chat history) | 2 credits |
| Chat history retrieval | Free |
| Rate limit | 200 requests/min |

---

## Supported Chains

The Smart Contract Generator produces Solidity code compatible with all EVM networks:

- Ethereum
- BNB Chain (BSC)
- Arbitrum (One & Nova)
- Avalanche (C-Chain)
- Polygon (PoS & zkEVM)
- Optimism
- Base
- Berachain
- Fantom
- Cronos
- Gnosis Chain
- Any EVM-compatible network

Output contracts use standard OpenZeppelin libraries and are ready for deployment via Hardhat, Foundry, Remix, or any EVM deployment toolchain.

---

## Response Examples

### Blob Response — ERC-20 Token Generation

```json
{
  "status": "success",
  "data": {
    "user": "Create an ERC-20 token called MyToken with symbol MTK and 1 million supply",
    "bot": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\nimport \"@openzeppelin/contracts/token/ERC20/ERC20.sol\";\nimport \"@openzeppelin/contracts/access/Ownable.sol\";\n\n/**\n * @title MyToken\n * @dev ERC-20 token with a fixed supply of 1,000,000 tokens.\n */\ncontract MyToken is ERC20, Ownable {\n    constructor() ERC20(\"MyToken\", \"MTK\") Ownable(msg.sender) {\n        _mint(msg.sender, 1_000_000 * 10 ** decimals());\n    }\n}\n"
  }
}
```

### Blob Response — Staking Contract

```json
{
  "status": "success",
  "data": {
    "user": "Create a staking contract that accepts ERC-20 tokens with a 12% APY and 30-day lock period",
    "bot": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\nimport \"@openzeppelin/contracts/token/ERC20/IERC20.sol\";\nimport \"@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol\";\nimport \"@openzeppelin/contracts/access/Ownable.sol\";\nimport \"@openzeppelin/contracts/utils/ReentrancyGuard.sol\";\n\n/**\n * @title StakingPool\n * @dev Staking contract with 12% APY and 30-day lock period.\n */\ncontract StakingPool is Ownable, ReentrancyGuard {\n    using SafeERC20 for IERC20;\n\n    IERC20 public immutable stakingToken;\n    uint256 public constant APY = 12;\n    uint256 public constant LOCK_PERIOD = 30 days;\n\n    struct StakeInfo {\n        uint256 amount;\n        uint256 stakedAt;\n        uint256 rewardDebt;\n    }\n\n    mapping(address => StakeInfo) public stakes;\n    uint256 public totalStaked;\n\n    event Staked(address indexed user, uint256 amount);\n    event Withdrawn(address indexed user, uint256 amount, uint256 reward);\n\n    constructor(address _stakingToken) Ownable(msg.sender) {\n        stakingToken = IERC20(_stakingToken);\n    }\n\n    function stake(uint256 _amount) external nonReentrant {\n        require(_amount > 0, \"Cannot stake 0\");\n        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);\n        stakes[msg.sender].amount += _amount;\n        stakes[msg.sender].stakedAt = block.timestamp;\n        totalStaked += _amount;\n        emit Staked(msg.sender, _amount);\n    }\n\n    function withdraw() external nonReentrant {\n        StakeInfo storage info = stakes[msg.sender];\n        require(info.amount > 0, \"No stake found\");\n        require(block.timestamp >= info.stakedAt + LOCK_PERIOD, \"Lock period not over\");\n        uint256 reward = _calculateReward(info.amount, info.stakedAt);\n        uint256 total = info.amount + reward;\n        totalStaked -= info.amount;\n        info.amount = 0;\n        stakingToken.safeTransfer(msg.sender, total);\n        emit Withdrawn(msg.sender, info.amount, reward);\n    }\n\n    function _calculateReward(uint256 _amount, uint256 _stakedAt) internal view returns (uint256) {\n        uint256 duration = block.timestamp - _stakedAt;\n        return (_amount * APY * duration) / (365 days * 100);\n    }\n}\n"
  }
}
```

### Chat History Response

```json
{
  "status": "success",
  "data": {
    "rows": [
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "user": "Create an ERC-20 token called MyToken with symbol MTK and 1 million supply",
        "bot": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n...",
        "createdAt": "2026-04-24T09:15:32.000Z",
        "sdkUniqueId": "my-session-123"
      },
      {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "user": "Now add a burn function to that token",
        "bot": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n...",
        "createdAt": "2026-04-24T09:16:45.000Z",
        "sdkUniqueId": "my-session-123"
      }
    ],
    "count": 2
  }
}
```

### Error — Invalid Model

```json
{
  "status": false,
  "message": "Validation error: 'model' must be 'smart_contract_generator'"
}
```

### Error — Insufficient Credits

```json
{
  "status": false,
  "message": "Insufficient credits. Your balance is 0.0 credits. This request requires 1.0 credits."
}
```
