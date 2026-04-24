import { GeneralChat } from '@chaingpt/generalchat';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

let _generalChat: GeneralChat | null = null;
function getClient(): GeneralChat {
  if (!_generalChat) {
    _generalChat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY! });
  }
  return _generalChat;
}

export const chatTools: Tool[] = [
  {
    name: 'chaingpt_chat',
    description:
      'Send a question to ChainGPT Web3 AI LLM. Returns crypto/blockchain answers with live on-chain data including token prices, wallet analysis, whale tracking, DeFi positions, and more. Costs 0.5 credits (1.0 with chat history).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the Web3 AI (1-10,000 characters)',
        },
        chatHistory: {
          type: 'boolean',
          description: 'Enable multi-turn conversation memory (+0.5 credits)',
          default: false,
        },
        sessionId: {
          type: 'string',
          description:
            'Unique session ID for conversation continuity (required when chatHistory is true)',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'chaingpt_chat_with_context',
    description:
      'Chat with ChainGPT using custom context injection — the AI will answer as if it is your project\'s assistant, with knowledge of your company, token, and branding. Costs 0.5 credits (1.0 with chat history).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask',
        },
        companyName: {
          type: 'string',
          description: 'Company or project name',
        },
        companyDescription: {
          type: 'string',
          description: 'Description of the company/project',
        },
        companyWebsiteUrl: {
          type: 'string',
          description: 'Website URL',
        },
        tokenName: {
          type: 'string',
          description: 'Token name (e.g. "ChainGPT")',
        },
        tokenSymbol: {
          type: 'string',
          description: 'Token symbol (e.g. "CGPT")',
        },
        tokenAddress: {
          type: 'string',
          description: 'Token contract address',
        },
        blockchain: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Blockchain networks the token is on. Values: ETHEREUM, BSC, ARBITRUM, BASE, BLAST, AVALANCHE, POLYGON, SCROLL, OPTIMISM, LINEA, ZKSYNC, POLYGON_ZKEVM, GNOSIS, FANTOM, MOONRIVER, MOONBEAM, BOBA, METIS, LISK, AURORA, SEI, IMMUTABLE_ZK, GRAVITY, TAIKO, CRONOS, FRAXTAL, ABSTRACT, WORLD_CHAIN, MANTLE, MODE, CELO, BERACHAIN',
        },
        tone: {
          type: 'string',
          description: 'AI response tone preset',
          enum: [
            'PROFESSIONAL',
            'FRIENDLY',
            'INFORMATIVE',
            'FORMAL',
            'CONVERSATIONAL',
            'AUTHORITATIVE',
            'PLAYFUL',
            'INSPIRATIONAL',
            'CONCISE',
            'EMPATHETIC',
            'ACADEMIC',
            'NEUTRAL',
            'SARCASTIC_MEME_STYLE',
          ],
        },
        chatHistory: {
          type: 'boolean',
          description: 'Enable multi-turn conversation memory',
          default: false,
        },
        sessionId: {
          type: 'string',
          description: 'Unique session ID for conversation continuity',
        },
      },
      required: ['question'],
    },
  },
];

export async function handleChatTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (!args) {
    return { content: [{ type: 'text', text: 'Error: No arguments provided' }] };
  }

  try {
    if (name === 'chaingpt_chat') {
      const response = await getClient().createChatBlob({
        question: args.question as string,
        chatHistory: args.chatHistory ? 'on' : 'off',
        ...(args.sessionId ? { sdkUniqueId: args.sessionId as string } : {}),
      });

      const botResponse = (response as any)?.data?.bot ?? JSON.stringify(response);
      return { content: [{ type: 'text', text: botResponse }] };
    }

    if (name === 'chaingpt_chat_with_context') {
      const contextInjection: Record<string, unknown> = {};

      if (args.companyName) contextInjection.companyName = args.companyName;
      if (args.companyDescription) contextInjection.companyDescription = args.companyDescription;
      if (args.companyWebsiteUrl) contextInjection.companyWebsiteUrl = args.companyWebsiteUrl;

      if (args.tokenName || args.tokenSymbol || args.tokenAddress) {
        contextInjection.cryptoToken = true;
        const tokenInformation: Record<string, unknown> = {};
        if (args.tokenName) tokenInformation.tokenName = args.tokenName;
        if (args.tokenSymbol) tokenInformation.tokenSymbol = args.tokenSymbol;
        if (args.tokenAddress) tokenInformation.tokenAddress = args.tokenAddress;
        if (args.blockchain) tokenInformation.blockchain = args.blockchain;
        contextInjection.tokenInformation = tokenInformation;
      }

      if (args.tone) {
        contextInjection.aiTone = 'PRE_SET_TONE';
        contextInjection.selectedTone = args.tone;
      }

      const response = await getClient().createChatBlob({
        question: args.question as string,
        chatHistory: args.chatHistory ? 'on' : 'off',
        ...(args.sessionId ? { sdkUniqueId: args.sessionId as string } : {}),
        useCustomContext: true,
        contextInjection,
      } as any);

      const botResponse = (response as any)?.data?.bot ?? JSON.stringify(response);
      return { content: [{ type: 'text', text: botResponse }] };
    }

    return { content: [{ type: 'text', text: `Unknown chat tool: ${name}` }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ChainGPT Chat error: ${message}`);
  }
}
