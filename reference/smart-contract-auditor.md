# Smart Contract Auditor - API & SDK Reference

## Overview

The ChainGPT Smart Contract Auditor analyzes Solidity smart contracts for vulnerabilities, logic issues, gas inefficiencies, and compliance problems. It produces a scored audit report (0-100%) with categorized findings and remediation suggestions.

---

## What It Detects

- **Reentrancy vulnerabilities** - Cross-function and cross-contract reentrancy
- **Integer overflow/underflow** - Arithmetic issues in pre-0.8.0 and unchecked blocks
- **Access control issues** - Missing modifiers, privilege escalation, unprotected functions
- **Logic and compliance problems** - Business logic flaws, ERC standard non-compliance
- **Gas inefficiencies** - Redundant storage reads, unoptimized loops, unnecessary operations
- **Front-running risks** - Transaction ordering dependencies
- **Denial of service vectors** - Unbounded loops, block gas limit issues
- **Centralization risks** - Single owner points of failure

### Audit Report Format

- Overall security score (0-100%)
- Categorized findings by severity (Critical, High, Medium, Low, Informational)
- Line-by-line code references
- Remediation suggestions for each finding
- **PDF reports** — check [docs.chaingpt.org](https://docs.chaingpt.org) for latest availability

---

## REST API

### Audit Contract (Streaming)

```
POST https://api.chaingpt.org/chat/stream
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Must be `"smart_contract_auditor"` |
| `question` | string | Yes | Contract code + optional audit instructions |
| `chatHistory` | string | No | `"on"` or `"off"` (default `"off"`) |
| `sdkUniqueId` | string | No | Session ID for grouping conversations |

**Response:**

```json
{
  "status": "success",
  "data": {
    "user": "Audit this contract for vulnerabilities:\n\npragma solidity ^0.8.0;\n...",
    "bot": "## Smart Contract Audit Report\n\n**Overall Score: 72/100**\n\n### Critical Issues\n1. Reentrancy in withdraw()...\n\n### High Issues\n..."
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
| `sdkUniqueId` | string | - | Filter by session ID |

---

## JavaScript SDK

### Installation

```bash
npm install --save @chaingpt/smartcontractauditor
```

### Initialization

```javascript
const { SmartContractAuditor } = require("@chaingpt/smartcontractauditor");

const auditor = new SmartContractAuditor({
  apiKey: "YOUR_API_KEY",
});
```

### Methods

#### auditSmartContractBlob(options)

Returns a complete audit report as a Promise.

```javascript
const response = await auditor.auditSmartContractBlob({
  question: `Audit this contract for security vulnerabilities:

pragma solidity ^0.8.0;

contract SimpleVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        balances[msg.sender] -= amount;
    }
}`,
  chatHistory: "on",
  sdkUniqueId: "audit-session-001",
});

console.log(response.data.bot); // Full audit report
```

#### auditSmartContractStream(options)

Returns a readable stream for real-time audit output.

```javascript
const stream = await auditor.auditSmartContractStream({
  question: `Perform a comprehensive security audit:\n\n${contractCode}`,
  chatHistory: "off",
});

stream.on("data", (chunk) => process.stdout.write(chunk.toString()));
stream.on("end", () => console.log("\nAudit complete"));
```

#### getChatHistory(options)

Retrieves previous audit history.

```javascript
const history = await auditor.getChatHistory({
  limit: 20,
  offset: 0,
  sortBy: "createdAt",
  sortOrder: "DESC",
});

console.log(history.data.rows);
```

### Error Handling

```javascript
const { Errors } = require("@chaingpt/smartcontractauditor");

try {
  const response = await auditor.auditSmartContractBlob({ question: "..." });
} catch (error) {
  if (error instanceof Errors.SmartContractAuditorError) {
    console.error("Auditor error:", error.message);
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
from chaingpt.models import SmartContractAuditRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")
```

### Methods

#### audit_contract (Blob)

```python
contract_code = """
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingPool {
    IERC20 public stakingToken;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewardDebt;
    uint256 public rewardRate = 100;
    uint256 public totalStaked;

    constructor(address _token) {
        stakingToken = IERC20(_token);
    }

    function stake(uint256 amount) external {
        stakingToken.transferFrom(msg.sender, address(this), amount);
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
    }

    function withdraw(uint256 amount) external {
        require(stakedBalance[msg.sender] >= amount);
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        stakingToken.transfer(msg.sender, amount);
    }

    function claimReward() external {
        uint256 reward = (stakedBalance[msg.sender] * rewardRate) / totalStaked;
        stakingToken.transfer(msg.sender, reward);
    }
}
"""

request_data = SmartContractAuditRequestModel(
    question=f"Audit this staking contract for all vulnerabilities, gas issues, and best practice violations:\n\n{contract_code}",
    chat_history="on",
    sdk_unique_id="audit-session-py-001"
)

response = client.auditor.audit_contract(request_data)
print(response.data.bot)
```

#### stream_audit (Streaming)

```python
import asyncio

async def stream_audit():
    request_data = SmartContractAuditRequestModel(
        question=f"Perform a detailed security audit with severity ratings:\n\n{contract_code}",
        chat_history="off"
    )

    async for chunk in client.auditor.stream_audit(request_data):
        print(chunk, end="", flush=True)

asyncio.run(stream_audit())
```

#### get_audit_history

```python
history = client.auditor.get_audit_history(
    limit=10,
    offset=0,
    sort_by="createdAt",
    sort_order="DESC",
    sdk_unique_id="audit-session-py-001"
)

for row in history.data.rows:
    print(f"Audit from {row.created_at}: {row.user[:80]}...")
```

---

## cURL Examples

### Audit a Contract

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_auditor",
    "question": "Audit this contract for reentrancy, access control, and gas optimization:\n\npragma solidity ^0.8.0;\n\ncontract Vault {\n    mapping(address => uint256) public balances;\n\n    function deposit() external payable {\n        balances[msg.sender] += msg.value;\n    }\n\n    function withdraw(uint256 amount) external {\n        require(balances[msg.sender] >= amount);\n        (bool success, ) = msg.sender.call{value: amount}(\"\");\n        require(success);\n        balances[msg.sender] -= amount;\n    }\n\n    function withdrawAll() external {\n        uint256 bal = balances[msg.sender];\n        (bool success, ) = msg.sender.call{value: bal}(\"\");\n        require(success);\n        balances[msg.sender] = 0;\n    }\n}",
    "chatHistory": "off"
  }'
```

### Follow-Up Question on a Previous Audit

```bash
curl -X POST https://api.chaingpt.org/chat/stream \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart_contract_auditor",
    "question": "Can you show me the fixed version of the withdraw function with the reentrancy guard applied?",
    "chatHistory": "on",
    "sdkUniqueId": "audit-session-001"
  }'
```

### Retrieve Audit History

```bash
curl -X GET "https://api.chaingpt.org/chat/chatHistory?limit=5&offset=0&sortBy=createdAt&sortOrder=DESC&sdkUniqueId=audit-session-001" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Full JavaScript Examples

### Audit a Contract from a File

```javascript
const fs = require("fs");
const { SmartContractAuditor } = require("@chaingpt/smartcontractauditor");

async function auditFromFile(filePath) {
  const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY });
  const contractCode = fs.readFileSync(filePath, "utf-8");

  const response = await auditor.auditSmartContractBlob({
    question: `Perform a comprehensive security audit of this contract. Check for reentrancy, access control, integer issues, gas optimization, and compliance with relevant ERC standards:\n\n${contractCode}`,
    chatHistory: "on",
    sdkUniqueId: `audit-${filePath}`,
  });

  console.log(response.data.bot);
  return response.data.bot;
}

auditFromFile("./contracts/MyToken.sol");
```

### Stream Audit with Follow-Up

```javascript
const { SmartContractAuditor } = require("@chaingpt/smartcontractauditor");

async function auditWithFollowUp() {
  const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY });
  const sessionId = "detailed-audit-session";

  // First: run the audit
  const stream1 = await auditor.auditSmartContractStream({
    question: `Audit this contract:\n\n${contractCode}`,
    chatHistory: "on",
    sdkUniqueId: sessionId,
  });

  await new Promise((resolve) => {
    stream1.on("data", (chunk) => process.stdout.write(chunk.toString()));
    stream1.on("end", resolve);
  });

  // Follow-up: ask for fixes
  const stream2 = await auditor.auditSmartContractStream({
    question: "Show me the corrected version of the contract with all critical and high issues fixed",
    chatHistory: "on",
    sdkUniqueId: sessionId,
  });

  await new Promise((resolve) => {
    stream2.on("data", (chunk) => process.stdout.write(chunk.toString()));
    stream2.on("end", resolve);
  });
}

auditWithFollowUp();
```

---

## Full Python Examples

### Audit and Save Report

```python
from chaingpt import ChainGPTClient
from chaingpt.models import SmartContractAuditRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")

# Read contract from file
with open("contracts/Vault.sol", "r") as f:
    contract_code = f.read()

request_data = SmartContractAuditRequestModel(
    question=f"Full security audit with severity ratings and remediation steps:\n\n{contract_code}",
    chat_history="off"
)

response = client.auditor.audit_contract(request_data)

# Save audit report
with open("audit-report.md", "w") as f:
    f.write(response.data.bot)

print("Audit report saved to audit-report.md")
```

### Stream Audit with Piped Output

```python
import asyncio
import sys
from chaingpt import ChainGPTClient
from chaingpt.models import SmartContractAuditRequestModel

client = ChainGPTClient(api_key="YOUR_API_KEY")

async def stream_audit_to_stdout():
    with open(sys.argv[1], "r") as f:
        contract_code = f.read()

    request_data = SmartContractAuditRequestModel(
        question=f"Audit this contract:\n\n{contract_code}",
        chat_history="off"
    )

    async for chunk in client.auditor.stream_audit(request_data):
        print(chunk, end="", flush=True)

# Usage: python audit.py contracts/MyToken.sol
asyncio.run(stream_audit_to_stdout())
```

---

## Pricing

| Action | Cost |
|--------|------|
| Contract audit (no history) | 1 credit |
| Contract audit (with chat history) | 2 credits |
| Chat history retrieval | Free |
| Rate limit | 200 requests/min |

---

## Supported Chains

The auditor analyzes Solidity smart contracts for all EVM-compatible chains:

- Ethereum
- BNB Chain (BSC)
- Polygon (PoS & zkEVM)
- Arbitrum (One & Nova)
- Avalanche (C-Chain)
- Optimism
- Base
- Fantom
- Cronos
- Gnosis Chain

**Beta support:** Solana/Rust contract auditing (limited coverage, under active development).

The auditor understands chain-specific patterns (e.g., BNB Chain fee mechanics, L2 gas pricing) and adjusts findings accordingly.

---

## Response Examples

### Blob Response — Audit Report

```json
{
  "status": "success",
  "data": {
    "user": "Audit this contract for reentrancy, access control, and gas optimization:\n\npragma solidity ^0.8.0;\n\ncontract Vault {\n    mapping(address => uint256) public balances;\n\n    function deposit() external payable {\n        balances[msg.sender] += msg.value;\n    }\n\n    function withdraw(uint256 amount) external {\n        require(balances[msg.sender] >= amount);\n        (bool success, ) = msg.sender.call{value: amount}(\"\");\n        require(success);\n        balances[msg.sender] -= amount;\n    }\n}",
    "bot": "## Smart Contract Audit Report\n\n**Contract:** Vault\n**Compiler:** Solidity ^0.8.0\n**Overall Security Score: 38/100** (Critical issues found)\n\n---\n\n### Critical Issues (1)\n\n**C-01: Reentrancy Vulnerability in `withdraw()`**\n- **Severity:** Critical\n- **Location:** `withdraw()` function, lines 10-14\n- **Description:** The contract sends ETH via `msg.sender.call{value: amount}` before updating the balance (`balances[msg.sender] -= amount`). This classic checks-effects-interactions violation allows an attacker to recursively call `withdraw()` before the balance is decremented.\n- **Impact:** Complete drainage of all ETH held in the contract.\n- **Remediation:** Apply the checks-effects-interactions pattern by moving the state update before the external call, or use OpenZeppelin's `ReentrancyGuard`:\n```solidity\nfunction withdraw(uint256 amount) external nonReentrant {\n    require(balances[msg.sender] >= amount);\n    balances[msg.sender] -= amount;\n    (bool success, ) = msg.sender.call{value: amount}(\"\");\n    require(success);\n}\n```\n\n### High Issues (1)\n\n**H-01: No Access Control on Critical Functions**\n- **Severity:** High\n- **Location:** Contract level\n- **Description:** The contract has no owner or admin role. While `deposit()` and `withdraw()` are user-facing, there is no emergency pause mechanism or admin withdrawal for stuck funds.\n- **Remediation:** Implement `Ownable` and `Pausable` from OpenZeppelin.\n\n### Medium Issues (1)\n\n**M-01: Missing Event Emissions**\n- **Severity:** Medium\n- **Location:** `deposit()` and `withdraw()` functions\n- **Description:** Neither function emits events, making off-chain monitoring and indexing impossible.\n- **Remediation:** Add `event Deposited(address indexed user, uint256 amount)` and `event Withdrawn(address indexed user, uint256 amount)` events.\n\n### Low Issues (1)\n\n**L-01: No Receive/Fallback Function**\n- **Severity:** Low\n- **Description:** The contract cannot receive ETH sent directly (without calling `deposit()`). ETH sent via `selfdestruct` or direct transfer will be locked.\n- **Remediation:** Add a `receive()` function or document that direct transfers are unsupported.\n\n### Gas Optimizations (1)\n\n**G-01: Custom Errors Instead of Require Strings**\n- **Description:** Using custom errors (`error InsufficientBalance()`) instead of require strings saves ~50 gas per revert.\n\n---\n\n**Summary:** This contract has a critical reentrancy vulnerability that must be fixed before deployment. The lack of access control and event emissions are secondary concerns. Estimated gas savings from optimizations: ~200 gas per transaction."
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
        "id": "d4e5f6a7-b8c9-0123-defg-h45678901234",
        "user": "Audit this contract for reentrancy...\n\npragma solidity ^0.8.0;\ncontract Vault { ... }",
        "bot": "## Smart Contract Audit Report\n\n**Overall Security Score: 38/100**\n...",
        "createdAt": "2026-04-24T14:22:10.000Z",
        "sdkUniqueId": "audit-session-001"
      },
      {
        "id": "e5f6a7b8-c9d0-1234-efgh-i56789012345",
        "user": "Can you show me the fixed version of the withdraw function with the reentrancy guard applied?",
        "bot": "Here is the corrected `withdraw()` function with a reentrancy guard...\n\n```solidity\nimport \"@openzeppelin/contracts/utils/ReentrancyGuard.sol\";\n...",
        "createdAt": "2026-04-24T14:23:45.000Z",
        "sdkUniqueId": "audit-session-001"
      }
    ],
    "count": 2
  }
}
```

### Error — Empty Contract

```json
{
  "status": false,
  "message": "Validation error: 'question' must contain valid Solidity contract code or an audit request"
}
```

### Error — Insufficient Credits

```json
{
  "status": false,
  "message": "Insufficient credits. Your balance is 0.5 credits. This request requires 1.0 credits."
}
```
