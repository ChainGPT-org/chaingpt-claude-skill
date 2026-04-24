import { Nft } from '@chaingpt/nft';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

let _nft: Nft | null = null;
function getClient(): Nft {
  if (!_nft) {
    _nft = new Nft({ apiKey: process.env.CHAINGPT_API_KEY! });
  }
  return _nft;
}

export const nftTools: Tool[] = [
  {
    name: 'chaingpt_nft_generate_image',
    description:
      'Generate an AI image from a text prompt using ChainGPT NFT Generator. Returns base64-encoded image data. Costs 1 credit base (+ upscale/model surcharges). Models: velogen (fast, 1-4 steps), nebula_forge_xl (quality, 1-50 steps), VisionaryForge (quality, 1-50 steps), Dale3 (4.75 credits, fixed 1024x1024).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate',
        },
        model: {
          type: 'string',
          description: 'AI model to use for generation',
          enum: ['velogen', 'nebula_forge_xl', 'VisionaryForge', 'Dale3'],
          default: 'velogen',
        },
        width: {
          type: 'number',
          description: 'Image width in pixels (512-1024 depending on model)',
          default: 512,
        },
        height: {
          type: 'number',
          description: 'Image height in pixels (512-1024 depending on model)',
          default: 512,
        },
        steps: {
          type: 'number',
          description:
            'Inference steps. velogen: 1-4 (default 2), nebula/visionary: 1-50 (default 25), Dale3: N/A',
          default: 2,
        },
        enhance: {
          type: 'string',
          description: 'Upscale option. "1x" adds +1 credit, "2x" adds +2 credits',
          enum: ['original', '1x', '2x'],
          default: 'original',
        },
        style: {
          type: 'string',
          description: 'Art style to apply',
          enum: [
            '3d-model',
            'analog-film',
            'anime',
            'cinematic',
            'comic-book',
            'digital-art',
            'enhance',
            'fantasy-art',
            'isometric',
            'line-art',
            'low-poly',
            'neon-punk',
            'origami',
            'photographic',
            'pixel-art',
            'texture',
            'craft-clay',
          ],
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'chaingpt_nft_enhance_prompt',
    description:
      'Enhance a text prompt using AI for better NFT/image generation results. Returns an improved, detailed prompt. Costs 0.5 credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The original prompt to enhance',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'chaingpt_nft_get_chains',
    description:
      'List all blockchain networks supported for NFT minting, with their chain IDs. Free (0 credits).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        testNet: {
          type: 'boolean',
          description: 'If true, return testnet chains instead of mainnet',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'chaingpt_nft_generate_and_mint',
    description:
      'Full pipeline: generate an NFT image from a prompt, queue it for on-chain minting, poll for completion, and prepare mint metadata. Returns collection ID and IPFS metadata. Requires wallet address and target chain.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the NFT to generate',
        },
        model: {
          type: 'string',
          enum: ['velogen', 'nebula_forge_xl', 'VisionaryForge', 'Dale3'],
          default: 'velogen',
        },
        walletAddress: {
          type: 'string',
          description: 'Destination wallet address for the NFT',
        },
        chainId: {
          type: 'number',
          description:
            'Target blockchain chain ID (e.g. 1=Ethereum, 56=BSC, 137=Polygon, 8453=Base, 42161=Arbitrum)',
        },
        name: {
          type: 'string',
          description: 'NFT collection name',
        },
        description: {
          type: 'string',
          description: 'NFT collection description',
        },
        symbol: {
          type: 'string',
          description: 'NFT collection symbol (e.g. "MYNFT")',
        },
        steps: {
          type: 'number',
          description: 'Inference steps',
          default: 2,
        },
        enhance: {
          type: 'string',
          enum: ['original', '1x', '2x'],
          default: 'original',
        },
        style: {
          type: 'string',
          description: 'Art style',
        },
      },
      required: ['prompt', 'walletAddress', 'chainId', 'name'],
    },
  },
];

export async function handleNftTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'Error: No arguments provided' }] };
  }

  try {
    if (name === 'chaingpt_nft_generate_image') {
      const result = await getClient().generateImage({
        prompt: args.prompt as string,
        model: ((args.model as string) || 'velogen'),
        width: (args.width as number) || 512,
        height: (args.height as number) || 512,
        steps: (args.steps as number) || 2,
        ...(args.walletAddress ? { walletAddress: args.walletAddress as string } : {}),
        ...(args.enhance ? { enhance: args.enhance as string } : {}),
        ...(args.style ? { style: args.style as string } : {}),
      } as any);

      // Convert byte array to base64 data URI
      const data = (result as any).data;
      if (data && Array.isArray(data)) {
        const buffer = Buffer.from(data);
        const base64 = buffer.toString('base64');
        return {
          content: [
            {
              type: 'text',
              text: `Image generated successfully.\n\nBase64 data URI (JPEG):\ndata:image/jpeg;base64,${base64.substring(0, 200)}...\n\nFull base64 length: ${base64.length} characters\n\nTo display this image, the full base64 string would need to be rendered in an <img> tag or saved to a file.`,
            },
          ],
        };
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    if (name === 'chaingpt_nft_enhance_prompt') {
      const result = await getClient().enhancePrompt({
        prompt: args.prompt as string,
      });

      const enhanced =
        (result as any).enhancedPrompt ??
        (result as any).data?.enhancedPrompt ??
        JSON.stringify(result);

      return {
        content: [
          {
            type: 'text',
            text: `Enhanced prompt:\n\n${enhanced}`,
          },
        ],
      };
    }

    if (name === 'chaingpt_nft_get_chains') {
      const result = await getClient().getChains(
        (args.testNet as boolean) ?? false
      );

      return {
        content: [
          {
            type: 'text',
            text: `Supported chains for NFT minting:\n\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }

    if (name === 'chaingpt_nft_generate_and_mint') {
      // Step 1: Queue NFT generation
      const generation = await getClient().generateNftWithQueue({
        prompt: args.prompt as string,
        model: ((args.model as string) || 'velogen'),
        height: 512,
        width: 512,
        steps: (args.steps as number) || 2,
        walletAddress: args.walletAddress as string,
        chainId: args.chainId as number,
        amount: 1,
        ...(args.enhance ? { enhance: args.enhance as string } : {}),
        ...(args.style ? { style: args.style as string } : {}),
      } as any);

      const collectionId = (generation as any).collectionId;
      if (!collectionId) {
        return {
          content: [
            {
              type: 'text',
              text: `NFT generation queued but no collection ID returned. Response: ${JSON.stringify(generation)}`,
            },
          ],
        };
      }

      // Step 2: Poll for completion (max 60 attempts = ~3 minutes)
      let status = 'processing';
      let attempts = 0;
      while (status !== 'completed' && attempts < 60) {
        await new Promise((r) => setTimeout(r, 3000));
        const progress = await getClient().getNftProgress({ collectionId });
        status = (progress as any).status || 'unknown';
        attempts++;

        if (status === 'failed' || status === 'error') {
          return {
            content: [
              {
                type: 'text',
                text: `NFT generation failed. Collection ID: ${collectionId}, Status: ${status}`,
              },
            ],
          };
        }
      }

      if (status !== 'completed') {
        return {
          content: [
            {
              type: 'text',
              text: `NFT generation timed out after ${attempts * 3}s. Collection ID: ${collectionId}. You can check progress manually or try again.`,
            },
          ],
        };
      }

      // Step 3: Mint
      const minted = await getClient().mintNft({
        collectionId,
        name: args.name as string,
        description: (args.description as string) || '',
        ids: [1],
      } as any);

      return {
        content: [
          {
            type: 'text',
            text: `NFT generated and minted successfully!\n\nCollection ID: ${collectionId}\nName: ${args.name}\nSymbol: ${args.symbol}\nChain ID: ${args.chainId}\nWallet: ${args.walletAddress}\n\nMint result:\n${JSON.stringify(minted, null, 2)}`,
          },
        ],
      };
    }

    return { content: [{ type: 'text', text: `Unknown NFT tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT NFT error: ${message}`);
  }
}
