/**
 * ChainGPT Web3 AI Chatbot — Streaming Example
 *
 * Demonstrates: streaming responses, chat history, and context injection
 * Install: npm install @chaingpt/generalchat dotenv
 */
import 'dotenv/config';
import { GeneralChat, Errors, AI_TONE, PRE_SET_TONES, BLOCKCHAIN_NETWORK } from '@chaingpt/generalchat';

const chat = new GeneralChat({ apiKey: process.env.CHAINGPT_API_KEY });

// 1. Simple streaming chat
async function streamChat(question) {
  const stream = await chat.createChatStream({
    question,
    chatHistory: 'off'
  });
  stream.on('data', (chunk) => process.stdout.write(chunk.toString()));
  stream.on('end', () => console.log('\n'));
}

// 2. Multi-turn conversation with history
async function conversationDemo() {
  const sessionId = `session-${Date.now()}`;

  const questions = [
    'What is Ethereum staking and how does it work?',
    'What are the risks involved?',
    'How much ETH do I need to stake?'
  ];

  for (const q of questions) {
    console.log(`\nYou: ${q}`);
    console.log('Bot: ');
    const stream = await chat.createChatStream({
      question: q,
      chatHistory: 'on',
      sdkUniqueId: sessionId
    });
    stream.on('data', (chunk) => process.stdout.write(chunk.toString()));
    await new Promise((resolve) => stream.on('end', resolve));
    console.log('\n');
  }
}

// 3. Custom context injection (branded chatbot)
async function brandedChatbot(question) {
  const response = await chat.createChatBlob({
    question,
    chatHistory: 'off',
    useCustomContext: true,
    contextInjection: {
      companyName: 'Acme DeFi',
      companyDescription: 'A decentralized lending protocol on Ethereum and Polygon',
      cryptoToken: true,
      tokenInformation: {
        tokenName: 'AcmeToken',
        tokenSymbol: 'ACME',
        blockchain: [BLOCKCHAIN_NETWORK.ETHEREUM, BLOCKCHAIN_NETWORK.POLYGON]
      },
      aiTone: AI_TONE.PRE_SET_TONE,
      selectedTone: PRE_SET_TONES.FRIENDLY
    }
  });
  console.log('Branded response:', response.data.bot);
}

// 4. Error handling
async function safeChat(question) {
  try {
    const res = await chat.createChatBlob({ question, chatHistory: 'off' });
    return res.data.bot;
  } catch (error) {
    if (error instanceof Errors.GeneralChatError) {
      console.error('ChainGPT Error:', error.message);
    }
    throw error;
  }
}

// Run examples
(async () => {
  console.log('=== Simple Stream ===');
  await streamChat('What are the top 3 DeFi protocols by TVL?');

  console.log('=== Multi-turn Conversation ===');
  await conversationDemo();

  console.log('=== Branded Chatbot ===');
  await brandedChatbot('Tell me about your lending protocol');
})();
