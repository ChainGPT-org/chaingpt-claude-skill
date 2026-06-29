import { SmartContractGenerator } from '@chaingpt/smartcontractgenerator';
let _generator = null;
function getClient() {
    if (!_generator) {
        _generator = new SmartContractGenerator({ apiKey: process.env.CHAINGPT_API_KEY });
    }
    return _generator;
}
export const generatorTools = [
    {
        name: 'chaingpt_generate_contract',
        description: 'Generate a Solidity smart contract from a natural language description. Supports ERC-20 tokens, ERC-721 NFTs, staking, vesting, DAOs, DEX, multisig, and any EVM-compatible contract. Uses OpenZeppelin libraries. Costs 1 credit (2 with chat history). Use sessionId for follow-up modifications.',
        inputSchema: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Natural language description of the smart contract to generate. Be specific about token names, supplies, features, access control, etc.',
                },
                sessionId: {
                    type: 'string',
                    description: 'Session ID for multi-turn conversations. Use to request modifications to a previously generated contract.',
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
        description: 'Retrieve smart contract generation conversation history for a given session.',
        inputSchema: {
            type: 'object',
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
export async function handleGeneratorTool(name, args) {
    if (!args) {
        return { content: [{ type: 'text', text: 'Error: No arguments provided' }] };
    }
    try {
        if (name === 'chaingpt_generate_contract') {
            const useChatHistory = args.chatHistory || !!args.sessionId;
            const response = await getClient().createSmartContractBlob({
                question: args.description,
                chatHistory: useChatHistory ? 'on' : 'off',
                ...(args.sessionId ? { sdkUniqueId: args.sessionId } : {}),
            });
            // The generator SDK double-wraps: response.data.bot may be an object { data: { bot: string } }
            let botResponse = response?.data?.bot;
            if (botResponse && typeof botResponse === 'object') {
                botResponse = botResponse?.data?.bot ?? JSON.stringify(botResponse);
            }
            if (!botResponse || typeof botResponse !== 'string') {
                botResponse = JSON.stringify(response);
            }
            return { content: [{ type: 'text', text: botResponse }] };
        }
        if (name === 'chaingpt_generate_history') {
            const result = await getClient().getChatHistory({
                sdkUniqueId: args.sessionId,
                limit: args.limit || 10,
                offset: args.offset || 0,
                sortOrder: args.sortOrder || 'DESC',
            });
            return {
                content: [{ type: 'text', text: `Generator History:\n\n${JSON.stringify(result, null, 2)}` }],
            };
        }
        return { content: [{ type: 'text', text: `Unknown generator tool: ${name}` }] };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`ChainGPT Generator error: ${message}`);
    }
}
