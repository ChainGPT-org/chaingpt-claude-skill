import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const utilTools: Tool[] = [
  {
    name: 'chaingpt_estimate_credits',
    description:
      'Estimate the credit cost for a ChainGPT API operation before executing it. Returns credit cost and USD equivalent. 1 credit = $0.01 USD.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product: {
          type: 'string',
          description: 'The ChainGPT product to estimate costs for',
          enum: ['chat', 'nft', 'audit', 'generator', 'news'],
        },
        options: {
          type: 'object',
          description: 'Product-specific options that affect pricing',
          properties: {
            chatHistory: {
              type: 'boolean',
              description: 'Whether chat history is enabled (chat, audit, generator)',
            },
            model: {
              type: 'string',
              description: 'NFT model name (velogen, nebula_forge_xl, VisionaryForge, Dale3)',
            },
            enhance: {
              type: 'string',
              description: 'NFT upscale option (original, 1x, 2x)',
            },
            steps: {
              type: 'number',
              description: 'NFT inference steps (affects cost for nebula/visionary at 26-50)',
            },
            characterPreserve: {
              type: 'boolean',
              description: 'NFT character preservation (+5 credits)',
            },
            promptEnhance: {
              type: 'boolean',
              description: 'Whether prompt enhancement is included (+0.5 credits)',
            },
            newsLimit: {
              type: 'number',
              description: 'Number of news records to fetch (charged per 10)',
            },
          },
        },
      },
      required: ['product'],
    },
  },
  {
    name: 'chaingpt_check_balance',
    description:
      'Get instructions for checking your ChainGPT API credit balance and topping up. The balance is not available via API — this returns the dashboard URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

interface CreditEstimate {
  estimatedCredits: number;
  estimatedUSD: string;
  breakdown: string[];
}

function estimateCredits(
  product: string,
  options: Record<string, unknown> = {}
): CreditEstimate {
  const breakdown: string[] = [];
  let credits = 0;

  switch (product) {
    case 'chat': {
      credits = 0.5;
      breakdown.push('Base chat request: 0.5 credits');
      if (options.chatHistory) {
        credits += 0.5;
        breakdown.push('Chat history enabled: +0.5 credits');
      }
      break;
    }

    case 'nft': {
      const model = (options.model as string) || 'velogen';
      const enhance = (options.enhance as string) || 'original';
      const steps = (options.steps as number) || 2;

      if (model === 'Dale3') {
        credits = 4.75;
        breakdown.push('Dale3 base (1024x1024): 4.75 credits');
        if (enhance !== 'original') {
          credits *= 2;
          breakdown.push('Dale3 enhanced: ~doubled');
        }
      } else {
        credits = 1;
        breakdown.push(`${model} base generation: 1 credit`);

        if (enhance === '1x') {
          credits += 1;
          breakdown.push('1x upscale: +1 credit');
        } else if (enhance === '2x') {
          credits += 2;
          breakdown.push('2x upscale: +2 credits');
        }

        if ((model === 'nebula_forge_xl' || model === 'VisionaryForge') && steps > 25) {
          const extra = Math.ceil((steps - 25) / 25) * 0.25;
          credits += extra;
          breakdown.push(`Steps ${steps} (>25): +${extra} credits`);
        }
      }

      if (options.characterPreserve) {
        credits += 5;
        breakdown.push('Character preserve: +5 credits');
      }

      if (options.promptEnhance) {
        credits += 0.5;
        breakdown.push('Prompt enhancement: +0.5 credits');
      }
      break;
    }

    case 'audit': {
      credits = 1;
      breakdown.push('Base audit: 1 credit');
      if (options.chatHistory) {
        credits += 1;
        breakdown.push('Chat history enabled: +1 credit');
      }
      break;
    }

    case 'generator': {
      credits = 1;
      breakdown.push('Base contract generation: 1 credit');
      if (options.chatHistory) {
        credits += 1;
        breakdown.push('Chat history enabled: +1 credit');
      }
      break;
    }

    case 'news': {
      const limit = (options.newsLimit as number) || 10;
      credits = Math.ceil(limit / 10);
      breakdown.push(`News fetch (${limit} records): ${credits} credit(s) (1 per 10 records)`);
      break;
    }

    default:
      breakdown.push(`Unknown product: ${product}`);
  }

  return {
    estimatedCredits: credits,
    estimatedUSD: `$${(credits * 0.01).toFixed(4)}`,
    breakdown,
  };
}

export async function handleUtilTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) args = {};

  try {
    if (name === 'chaingpt_estimate_credits') {
      const product = args.product as string;
      const options = (args.options as Record<string, unknown>) || {};
      const estimate = estimateCredits(product, options);

      const output = [
        `Credit Estimate for: ${product}`,
        `Estimated Credits: ${estimate.estimatedCredits}`,
        `Estimated Cost: ${estimate.estimatedUSD}`,
        '',
        'Breakdown:',
        ...estimate.breakdown.map((line) => `  - ${line}`),
        '',
        'Note: 1 credit = $0.01 USD. 15% bonus when paying with $CGPT tokens.',
      ];

      return { content: [{ type: 'text', text: output.join('\n') }] };
    }

    if (name === 'chaingpt_check_balance') {
      return {
        content: [
          {
            type: 'text',
            text: [
              'ChainGPT API Credit Balance',
              '',
              'Credit balance is not available via API. Check and top up at:',
              '',
              '  Dashboard: https://app.chaingpt.org',
              '  Add Credits: https://app.chaingpt.org/addcredits',
              '',
              'Pricing:',
              '  1 credit = $0.01 USD',
              '  1,000 credits = $10 USD',
              '  15% bonus when paying with $CGPT tokens',
              '',
              'Payment methods: USDT, USDC, ETH, BNB, TRX, $CGPT, or credit card.',
            ].join('\n'),
          },
        ],
      };
    }

    return { content: [{ type: 'text', text: `Unknown utility tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT utility error: ${message}`);
  }
}
