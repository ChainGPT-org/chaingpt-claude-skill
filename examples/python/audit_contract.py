"""
ChainGPT Smart Contract Auditor — Audit from File (Python)

Demonstrates: file-based audit, streaming, follow-up questions
Install: pip install chaingpt python-dotenv

NOTE: The Python SDK's actual class names, method signatures, and import
paths may differ from what is shown here. These examples illustrate the
*concepts* (contract auditing, streaming, follow-up questions) but are
not guaranteed to match the latest SDK release. Always check the official
ChainGPT documentation at https://docs.chaingpt.org for up-to-date
Python SDK usage.
"""
import asyncio
import os
import sys
from dotenv import load_dotenv
from chaingpt.client import ChainGPTClient
from chaingpt.models.smart_contract import SmartContractAuditRequestModel
from chaingpt.types import ChatHistoryMode
from chaingpt.exceptions import ChainGPTError

load_dotenv()
API_KEY = os.environ["CHAINGPT_API_KEY"]

SAMPLE_CONTRACT = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Failed");
        balances[msg.sender] -= amount;
    }
}
"""


async def audit_contract(source: str):
    """Audit a contract and print the report."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        result = await client.auditor.audit_contract(
            SmartContractAuditRequestModel(
                question=f"Audit this Solidity contract for security vulnerabilities:\n\n{source}",
                chatHistory=ChatHistoryMode.OFF
            )
        )
        print(result.data.bot)


async def streaming_audit(source: str):
    """Stream the audit report for real-time output."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        request = SmartContractAuditRequestModel(
            question=f"Comprehensive audit:\n\n{source}",
            chatHistory=ChatHistoryMode.OFF
        )
        async for chunk in client.auditor.stream_audit(request):
            print(chunk.decode("utf-8"), end="", flush=True)
        print()


async def interactive_audit(source: str):
    """Audit with follow-up questions via chat history."""
    session = f"audit-{os.getpid()}"
    async with ChainGPTClient(api_key=API_KEY) as client:
        # Initial audit
        res = await client.auditor.audit_contract(
            SmartContractAuditRequestModel(
                question=f"Audit:\n\n{source}",
                chatHistory=ChatHistoryMode.ON,
                sdkUniqueId=session
            )
        )
        print("=== Initial Audit ===")
        print(res.data.bot)

        # Follow up
        followup = await client.auditor.audit_contract(
            SmartContractAuditRequestModel(
                question="Show me the fixed version of this contract with all vulnerabilities patched.",
                chatHistory=ChatHistoryMode.ON,
                sdkUniqueId=session
            )
        )
        print("\n=== Fixed Version ===")
        print(followup.data.bot)


async def main():
    # Read from file or use sample
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r") as f:
            source = f.read()
    else:
        source = SAMPLE_CONTRACT

    try:
        await audit_contract(source)
    except ChainGPTError as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
