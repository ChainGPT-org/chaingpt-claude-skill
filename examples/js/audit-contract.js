/**
 * ChainGPT Smart Contract Auditor — Audit from File Example
 *
 * Demonstrates: file-based auditing, streaming results, chat history for follow-ups
 * Install: npm install @chaingpt/smartcontractauditor dotenv
 */
import 'dotenv/config';
import { SmartContractAuditor, Errors } from '@chaingpt/smartcontractauditor';
import fs from 'fs';

const auditor = new SmartContractAuditor({ apiKey: process.env.CHAINGPT_API_KEY });

// 1. Audit a contract from a file
async function auditFromFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');

  const result = await auditor.auditSmartContractBlob({
    question: `Perform a comprehensive security audit of this Solidity smart contract:\n\n${source}`,
    chatHistory: 'off'
  });

  console.log('=== Audit Report ===');
  console.log(result.data.bot);
}

// 2. Streaming audit (better for large contracts)
async function auditStreaming(source) {
  const stream = await auditor.auditSmartContractStream({
    question: `Audit this contract for vulnerabilities, gas optimization, and best practices:\n\n${source}`,
    chatHistory: 'off'
  });

  stream.on('data', (chunk) => process.stdout.write(chunk.toString()));
  await new Promise((resolve) => stream.on('end', resolve));
}

// 3. Interactive audit with follow-up questions
async function interactiveAudit(source) {
  const sessionId = `audit-${Date.now()}`;

  // Initial audit
  console.log('--- Initial Audit ---');
  const result = await auditor.auditSmartContractBlob({
    question: `Audit this contract:\n\n${source}`,
    chatHistory: 'on',
    sdkUniqueId: sessionId
  });
  console.log(result.data.bot);

  // Follow-up: ask about specific vulnerability
  console.log('\n--- Follow-up: Reentrancy ---');
  const followUp = await auditor.auditSmartContractBlob({
    question: 'Is this contract vulnerable to reentrancy attacks? Show me the specific lines at risk.',
    chatHistory: 'on',
    sdkUniqueId: sessionId
  });
  console.log(followUp.data.bot);
}

// Example contract to audit
const sampleContract = `
// SPDX-License-Identifier: MIT
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
}`;

(async () => {
  try {
    // Audit the sample contract
    await auditFromFile('./contracts/MyToken.sol').catch(() => {
      console.log('No file found, using sample contract...\n');
      return interactiveAudit(sampleContract);
    });
  } catch (error) {
    if (error instanceof Errors.SmartContractAuditorError) {
      console.error('Audit Error:', error.message);
    } else {
      throw error;
    }
  }
})();
