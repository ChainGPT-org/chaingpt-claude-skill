"""
ChainGPT Web3 AI Chatbot — Async Streaming Example (Python)

Demonstrates: streaming, chat history, context injection
Install: pip install chaingpt python-dotenv
"""
import asyncio
import os
from dotenv import load_dotenv
from chaingpt.client import ChainGPTClient
from chaingpt.models import LLMChatRequestModel, ContextInjectionModel, TokenInformationModel
from chaingpt.types import ChatHistoryMode, AITone, PresetTone, BlockchainNetwork
from chaingpt.exceptions import InsufficientCreditsError, RateLimitError

load_dotenv()
API_KEY = os.environ["CHAINGPT_API_KEY"]


async def simple_chat():
    """Simple buffered chat request."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        response = await client.llm.chat(LLMChatRequestModel(
            question="What are the top Layer 2 solutions on Ethereum?",
            chatHistory=ChatHistoryMode.OFF
        ))
        print("Response:", response.data.bot)


async def streaming_chat():
    """Streaming response for real-time output."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        request = LLMChatRequestModel(
            question="Explain how AMMs work in DeFi",
            chatHistory=ChatHistoryMode.OFF
        )
        print("Streaming: ", end="", flush=True)
        async for chunk in client.llm.stream_chat(request):
            print(chunk.decode("utf-8"), end="", flush=True)
        print()


async def conversation_with_history():
    """Multi-turn conversation using chat history."""
    session_id = f"session-{os.getpid()}"
    questions = [
        "What is impermanent loss?",
        "How can I minimize it?",
        "Which DEXs handle this best?"
    ]
    async with ChainGPTClient(api_key=API_KEY) as client:
        for q in questions:
            print(f"\nYou: {q}")
            response = await client.llm.chat(LLMChatRequestModel(
                question=q,
                chatHistory=ChatHistoryMode.ON,
                sdkUniqueId=session_id
            ))
            print(f"Bot: {response.data.bot[:200]}...")


async def branded_chatbot():
    """Chat with custom context injection."""
    context = ContextInjectionModel(
        companyName="Acme DeFi",
        companyDescription="Decentralized lending on Ethereum and Polygon",
        cryptoToken=True,
        tokenInformation=TokenInformationModel(
            tokenName="AcmeToken",
            tokenSymbol="ACME",
            blockchain=[BlockchainNetwork.ETHEREUM, BlockchainNetwork.POLYGON]
        ),
        aiTone=AITone.PRE_SET_TONE,
        selectedTone=PresetTone.PROFESSIONAL
    )
    async with ChainGPTClient(api_key=API_KEY) as client:
        response = await client.llm.chat(LLMChatRequestModel(
            question="Tell me about your lending rates",
            useCustomContext=True,
            contextInjection=context,
            chatHistory=ChatHistoryMode.OFF
        ))
        print("Branded:", response.data.bot)


async def main():
    try:
        await simple_chat()
        await streaming_chat()
        await conversation_with_history()
        await branded_chatbot()
    except InsufficientCreditsError:
        print("Top up at https://app.chaingpt.org/addcredits")
    except RateLimitError:
        print("Rate limited — slow down requests")

if __name__ == "__main__":
    asyncio.run(main())
