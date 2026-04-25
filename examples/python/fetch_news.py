"""
ChainGPT AI Crypto News — Fetch & Filter (Python)

Demonstrates: filtered queries, multi-category, search, pagination
Install: pip install chaingpt python-dotenv

NOTE: The Python SDK's actual class names, method signatures, and import
paths may differ from what is shown here. These examples illustrate the
*concepts* (news fetching, filtering, search) but are not guaranteed to
match the latest SDK release. Always check the official ChainGPT
documentation at https://docs.chaingpt.org for up-to-date Python SDK
usage.
"""
import asyncio
import os
from dotenv import load_dotenv
from chaingpt.client import ChainGPTClient
from chaingpt.exceptions import ChainGPTError

load_dotenv()
API_KEY = os.environ["CHAINGPT_API_KEY"]

# Reference IDs
CATEGORIES = {"DEFI": 5, "NFT": 8, "GAMING": 2, "EXCHANGE": 78, "CRYPTO": 64}
BLOCKCHAINS = {"BITCOIN": 11, "ETHEREUM": 15, "SOLANA": 22, "BNB": 12, "ARBITRUM": 28}
TOKENS = {"BTC": 79, "ETH": 80, "SOL": 85, "BNB": 82, "LINK": 96}


async def latest_defi_news():
    """Fetch latest DeFi news."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        result = await client.news.get_news(
            category_id=CATEGORIES["DEFI"],
            limit=5,
            sort_by="createdAt"
        )
        print("=== DeFi News ===")
        for article in result.data:
            print(f"  {article.title}")
            print(f"  {article.url}\n")


async def search_news(query: str):
    """Search news by keyword."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        result = await client.news.get_news(
            search_query=query,
            limit=10
        )
        print(f'=== Search: "{query}" ===')
        for article in result.data:
            print(f"  [{article.pubDate}] {article.title}")


async def multi_filter():
    """Ethereum DeFi news about ETH token."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        result = await client.news.get_news(
            category_id=CATEGORIES["DEFI"],
            sub_category_id=[BLOCKCHAINS["ETHEREUM"]],
            token_id=TOKENS["ETH"],
            limit=10
        )
        print("=== ETH DeFi News ===")
        for a in result.data:
            print(f"  {a.title}")
        print(f"Total available: {result.total}")


async def main():
    try:
        await latest_defi_news()
        await search_news("Bitcoin ETF")
        await multi_filter()
    except ChainGPTError as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
