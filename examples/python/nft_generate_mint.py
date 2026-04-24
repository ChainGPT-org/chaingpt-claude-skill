"""
ChainGPT AI NFT Generator — Generate + Mint Example (Python)

Demonstrates: image generation, prompt enhancement, minting
Install: pip install chaingpt python-dotenv

NOTE: The Python SDK's actual class names, method signatures, and import
paths may differ from what is shown here. These examples illustrate the
*concepts* (image generation, minting, prompt enhancement) but are not
guaranteed to match the latest SDK release. Always check the official
ChainGPT documentation at https://docs.chaingpt.org for up-to-date
Python SDK usage.
"""
import asyncio
import os
import time
from dotenv import load_dotenv
from chaingpt.client import ChainGPTClient
from chaingpt.models.nft import (
    NFTGenerateImageRequestModel,
    NFTGenerateQueueRequestModel,
    NFTMintRequestModel,
    NFTEnhancePromptRequestModel
)
from chaingpt.types import NFTImageModel, ImageEnhanceOption

load_dotenv()
API_KEY = os.environ["CHAINGPT_API_KEY"]
WALLET = os.environ.get("WALLET_ADDRESS", "0x0000000000000000000000000000000000000000")


async def generate_image():
    """Generate a single AI image."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        result = await client.nft.generate_image(NFTGenerateImageRequestModel(
            prompt="A neon samurai guarding a blockchain vault",
            model=NFTImageModel.NEBULA_FORGE_XL,
            height=1024,
            width=1024,
            steps=25,
            enhance=ImageEnhanceOption.ENHANCE_1X
        ))
        # Save image
        with open("generated_nft.png", "wb") as f:
            f.write(bytes(result.data))
        print("Image saved to generated_nft.png")


async def enhance_and_generate():
    """Enhance prompt then generate."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        # Enhance
        enhanced = await client.nft.enhance_prompt(
            NFTEnhancePromptRequestModel(prompt="a dragon in space")
        )
        print(f"Enhanced: {enhanced.data.enhancedPrompt}")

        # Generate with queue
        gen = await client.nft.generate_nft_queue(NFTGenerateQueueRequestModel(
            prompt=enhanced.data.enhancedPrompt,
            model=NFTImageModel.VELOGEN,
            height=512, width=512, steps=3,
            walletAddress=WALLET,
            chainId=56,  # BSC
            amount=1
        ))
        collection_id = gen.collectionId
        print(f"Queued: {collection_id}")

        # Poll progress
        while True:
            progress = await client.nft.get_progress(collection_id)
            if hasattr(progress, 'data') and progress.data and progress.data.generated:
                print(f"Done! Images: {progress.data.images}")
                break
            print("Generating...")
            await asyncio.sleep(3)

        # Mint
        mint = await client.nft.mint_nft(NFTMintRequestModel(
            collectionId=collection_id,
            name="Space Dragon #1",
            description="AI-generated cosmic dragon",
            symbol="DRGN",
            ids=[1]
        ))
        print(f"Minted! IPFS: {mint.image}")


async def list_chains():
    """List supported blockchains."""
    async with ChainGPTClient(api_key=API_KEY) as client:
        chains = await client.nft.get_chains(test_net=False)
        print("Supported chains:", chains)


async def main():
    await generate_image()
    # await enhance_and_generate()  # Uncomment with real WALLET_ADDRESS
    await list_chains()

if __name__ == "__main__":
    asyncio.run(main())
