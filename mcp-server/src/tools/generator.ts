import { SmartContractGenerator } from '@chaingpt/smartcontractgenerator';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

let _generator: SmartContractGenerator | null = null;
function getClient(): SmartContractGenerator {
  if (!_generator) {
    _generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY! });
  }
  return _generator;
}

export const generatorTools: Tool[] = [
  {
    name: 'chaingpt_generate_contract',
    description:
      'Generate a Solidity smart contract from a natural language description. Supports ERC-20 tokens, ERC-721 NFTs, staking, vesting, DAOs, DEX, multisig, and any EVM-compatible contract. Uses OpenZeppelin libraries. Costs 1 credit (2 with chat history). Use sessionId for follow-up modifications.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description:
            'Natural language description of the smart contract to generate. Be specific about token names, supplies, features, access control, etc.',
        },
        sessionId: {
          type: 'string',
          description:
            'Session ID for multi-turn conversations. Use to request modifications to a previously generated contract.',
        },
        chatHistory: {
          type: 'boolean',
          description: 'Enable chat history for follow-up modifications (+1 credit)',
          default: false,
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'chaingpt_generate_history',
    description:
      'Retrieve smart contract generation conversation history for a given session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to retrieve history for',
        },
        limit: {
          type: 'number',
          description: 'Number of messages to return',
          default: 10,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset',
          default: 0,
        },
        sortOrder: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          default: 'DESC',
        },
      },
      required: ['sessionId'],
    },
  },
];

export async function handleGeneratorTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'Error: No arguments provided' }] };
  }

  try {
    if (name === 'chaingpt_generate_contract') {
      const useChatHistory = (args.chatHistory as boolean) || !!args.sessionId;

      const response = await getClient().createSmartContractBlob({
        question: args.description as string,
        chatHistory: useChatHistory ? 'on' : 'off',
        ...(args.sessionId ? { sdkUniqueId: args.sessionId as string } : {}),
      });

      const botResponse = (response as any)?.data?.bot ?? JSON.stringify(response);
      return { content: [{ type: 'text', text: botResponse }] };
    }

    return { content: [{ type: 'text', text: `Unknown generator tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Generator error: ${message}`);
  }
}
