/**
 * ChainGPT AI NFT Generator — Generate + Mint Example
 *
 * Demonstrates: image generation, prompt enhancement, NFT minting on BSC
 * Install: npm install @chaingpt/nft dotenv
 */
import 'dotenv/config';
import { Nft, Errors } from '@chaingpt/nft';
import fs from 'fs';

const nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY });

// 1. Generate a single image
async function generateImage() {
  const result = await nft.generateImage({
    prompt: 'A cyberpunk samurai standing on a neon-lit blockchain bridge',
    model: 'nebula_forge_xl',
    height: 1024,
    width: 1024,
    steps: 25,
    enhance: '1x',
    style: 'neon-punk'
  });
  // Save the image bytes
  const buffer = Buffer.from(result.data);
  fs.writeFileSync('generated-nft.png', buffer);
  console.log('Image saved to generated-nft.png');
}

// 2. Full pipeline: Enhance → Generate → Mint
async function generateAndMint() {
  // Step 1: Enhance the prompt
  const enhanced = await nft.enhancePrompt({
    prompt: 'a dragon in space'
  });
  console.log('Enhanced prompt:', enhanced.data.enhancedPrompt);

  // Step 2: Generate NFT (synchronous — waits for completion)
  const genResult = await nft.generateNft({
    prompt: enhanced.data.enhancedPrompt,
    model: 'velogen',
    height: 512,
    width: 512,
    steps: 3,
    enhance: '1x',
    walletAddress: process.env.WALLET_ADDRESS,
    chainId: 56,  // BSC Mainnet
    amount: 1
  });
  console.log('Collection ID:', genResult.data.collectionId);

  // Step 3: Mint the NFT
  const mintResult = await nft.mintNft({
    collectionId: genResult.data.collectionId,
    name: 'Space Dragon #1',
    description: 'An AI-generated cosmic dragon NFT',
    symbol: 'DRGN',
    ids: [1]
  });
  console.log('Mint result:', mintResult);
  console.log('IPFS Image:', mintResult.image);
}

// 3. Async queue-based generation (for large batches)
async function batchGenerate() {
  const result = await nft.generateNftWithQueue({
    prompt: 'Abstract geometric crystal formations',
    model: 'nebula_forge_xl',
    height: 1024,
    width: 1024,
    steps: 30,
    walletAddress: process.env.WALLET_ADDRESS,
    chainId: 137,  // Polygon
    amount: 5
  });
  const collectionId = result.data.collectionId;
  console.log('Queued:', collectionId);

  // Poll progress
  let done = false;
  while (!done) {
    const progress = await nft.getNftProgress({ collectionId });
    console.log(`Progress: ${progress.progress || 0}%`);
    if (progress.data?.generated) {
      done = true;
      console.log('Images:', progress.data.images);
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// 4. List supported chains
async function listChains() {
  const chains = await nft.getChains(false); // mainnet
  console.log('Supported chains:', chains);
}

(async () => {
  try {
    await generateImage();
    // await generateAndMint();  // Uncomment when WALLET_ADDRESS is set
    // await batchGenerate();
    await listChains();
  } catch (error) {
    if (error instanceof Errors.NftError) {
      console.error('NFT Error:', error.message);
    } else {
      throw error;
    }
  }
})();
