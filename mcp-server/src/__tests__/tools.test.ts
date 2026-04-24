/**
 * MCP Server Tool Tests
 *
 * Tests tool input validation, handler functions with mocked SDK calls,
 * and error handling. Uses vitest with mocked ChainGPT SDK modules.
 *
 * Setup: npm install -D vitest
 * Run:   npx vitest run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock instances — hoisted so vi.mock factories can reference them ─

const {
  mockChatInstance,
  mockNftInstance,
  mockAuditorInstance,
  mockGeneratorInstance,
  mockNewsInstance,
} = vi.hoisted(() => ({
  mockChatInstance: {
    createChatBlob: vi.fn(),
  } as Record<string, any>,
  mockNftInstance: {
    generateImage: vi.fn(),
    enhancePrompt: vi.fn(),
    getChains: vi.fn(),
    generateNftWithQueue: vi.fn(),
    getNftProgress: vi.fn(),
    mintNft: vi.fn(),
  } as Record<string, any>,
  mockAuditorInstance: {
    auditSmartContractBlob: vi.fn(),
  } as Record<string, any>,
  mockGeneratorInstance: {
    createSmartContractBlob: vi.fn(),
  } as Record<string, any>,
  mockNewsInstance: {
    getNews: vi.fn(),
  } as Record<string, any>,
}));

// ─── Mock all ChainGPT SDK modules before imports ─────────────────

vi.mock('@chaingpt/generalchat', () => ({
  GeneralChat: vi.fn().mockImplementation(() => mockChatInstance),
}));

vi.mock('@chaingpt/nft', () => ({
  Nft: vi.fn().mockImplementation(() => mockNftInstance),
}));

vi.mock('@chaingpt/smartcontractauditor', () => ({
  SmartContractAuditor: vi.fn().mockImplementation(() => mockAuditorInstance),
}));

vi.mock('@chaingpt/smartcontractgenerator', () => ({
  SmartContractGenerator: vi.fn().mockImplementation(() => mockGeneratorInstance),
}));

vi.mock('@chaingpt/ainews', () => ({
  AINews: vi.fn().mockImplementation(() => mockNewsInstance),
}));

// Set env before importing handlers
process.env.CHAINGPT_API_KEY = 'test-api-key-123';

// ─── Import handlers after mocks ──────────────────────────────────

import { chatTools, handleChatTool } from '../tools/chat.js';
import { nftTools, handleNftTool } from '../tools/nft.js';
import { auditTools, handleAuditTool } from '../tools/audit.js';
import { generatorTools, handleGeneratorTool } from '../tools/generator.js';
import { newsTools, handleNewsTool } from '../tools/news.js';
import { utilTools, handleUtilTool } from '../tools/utils.js';

// ─── Helper to get mock instances ─────────────────────────────────

function getChatMock() {
  return mockChatInstance;
}

function getNftMock() {
  return mockNftInstance;
}

function getAuditorMock() {
  return mockAuditorInstance;
}

function getGeneratorMock() {
  return mockGeneratorInstance;
}

function getNewsMock() {
  return mockNewsInstance;
}

// ═══════════════════════════════════════════════════════════════════
// Tool Definition Tests
// ═══════════════════════════════════════════════════════════════════

describe('Tool Definitions', () => {
  it('should define all expected chat tools', () => {
    const names = chatTools.map((t) => t.name);
    expect(names).toContain('chaingpt_chat');
    expect(names).toContain('chaingpt_chat_with_context');
  });

  it('should define all expected NFT tools', () => {
    const names = nftTools.map((t) => t.name);
    expect(names).toContain('chaingpt_nft_generate_image');
    expect(names).toContain('chaingpt_nft_enhance_prompt');
    expect(names).toContain('chaingpt_nft_get_chains');
    expect(names).toContain('chaingpt_nft_generate_and_mint');
  });

  it('should define the audit tool', () => {
    expect(auditTools).toHaveLength(1);
    expect(auditTools[0].name).toBe('chaingpt_audit_contract');
  });

  it('should define the generator tool', () => {
    expect(generatorTools).toHaveLength(1);
    expect(generatorTools[0].name).toBe('chaingpt_generate_contract');
  });

  it('should define all expected news tools', () => {
    const names = newsTools.map((t) => t.name);
    expect(names).toContain('chaingpt_news_fetch');
    expect(names).toContain('chaingpt_news_categories');
  });

  it('should define all expected util tools', () => {
    const names = utilTools.map((t) => t.name);
    expect(names).toContain('chaingpt_estimate_credits');
    expect(names).toContain('chaingpt_check_balance');
  });

  it('chaingpt_chat requires "question" field', () => {
    const tool = chatTools.find((t) => t.name === 'chaingpt_chat')!;
    expect(tool.inputSchema.required).toContain('question');
  });

  it('chaingpt_nft_generate_image requires "prompt" field', () => {
    const tool = nftTools.find((t) => t.name === 'chaingpt_nft_generate_image')!;
    expect(tool.inputSchema.required).toContain('prompt');
  });

  it('chaingpt_nft_generate_and_mint requires all key fields', () => {
    const tool = nftTools.find((t) => t.name === 'chaingpt_nft_generate_and_mint')!;
    const required = tool.inputSchema.required as string[];
    expect(required).toContain('prompt');
    expect(required).toContain('walletAddress');
    expect(required).toContain('chainId');
    expect(required).toContain('name');
    expect(required).toContain('symbol');
  });

  it('chaingpt_generate_contract requires "description" field', () => {
    const tool = generatorTools.find((t) => t.name === 'chaingpt_generate_contract')!;
    expect(tool.inputSchema.required).toContain('description');
  });

  it('chaingpt_estimate_credits requires "product" field', () => {
    const tool = utilTools.find((t) => t.name === 'chaingpt_estimate_credits')!;
    expect(tool.inputSchema.required).toContain('product');
  });

  it('all tools have non-empty descriptions', () => {
    const allTools = [...chatTools, ...nftTools, ...auditTools, ...generatorTools, ...newsTools, ...utilTools];
    for (const tool of allTools) {
      expect(tool.description!.length).toBeGreaterThan(10);
    }
  });

  it('all tools have valid inputSchema type "object"', () => {
    const allTools = [...chatTools, ...nftTools, ...auditTools, ...generatorTools, ...newsTools, ...utilTools];
    for (const tool of allTools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleChatTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset call history on shared mock methods without clearing implementations
    Object.values(mockChatInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNftInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockAuditorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockGeneratorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNewsInstance).forEach(fn => fn.mockReset?.());
  });

  it('returns error when no arguments provided', async () => {
    const result = await handleChatTool('chaingpt_chat', undefined);
    expect(result.content[0].text).toContain('No arguments provided');
  });

  it('calls createChatBlob with correct params for basic chat', async () => {
    const mock = getChatMock();
    mock.createChatBlob.mockResolvedValue({ data: { bot: 'BTC is at $100k' } });

    const result = await handleChatTool('chaingpt_chat', { question: 'What is BTC price?' });

    expect(mock.createChatBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'What is BTC price?',
        chatHistory: 'off',
      })
    );
    expect(result.content[0].text).toBe('BTC is at $100k');
  });

  it('enables chat history when flag is true', async () => {
    const mock = getChatMock();
    mock.createChatBlob.mockResolvedValue({ data: { bot: 'response' } });

    await handleChatTool('chaingpt_chat', {
      question: 'test',
      chatHistory: true,
      sessionId: 'sess-1',
    });

    expect(mock.createChatBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        chatHistory: 'on',
        sdkUniqueId: 'sess-1',
      })
    );
  });

  it('handles context injection for chat_with_context', async () => {
    const mock = getChatMock();
    mock.createChatBlob.mockResolvedValue({ data: { bot: 'Context answer' } });

    const result = await handleChatTool('chaingpt_chat_with_context', {
      question: 'What does our token do?',
      companyName: 'TestProject',
      tokenName: 'TEST',
      tokenSymbol: 'TST',
      tone: 'PROFESSIONAL',
    });

    expect(mock.createChatBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'What does our token do?',
        useCustomContext: true,
      })
    );
    expect(result.content[0].text).toBe('Context answer');
  });

  it('returns unknown tool message for invalid name', async () => {
    const result = await handleChatTool('chaingpt_chat_nonexistent', { question: 'test' });
    expect(result.content[0].text).toContain('Unknown chat tool');
  });

  it('throws wrapped error on SDK failure', async () => {
    const mock = getChatMock();
    mock.createChatBlob.mockRejectedValue(new Error('Rate limit exceeded'));

    await expect(handleChatTool('chaingpt_chat', { question: 'test' })).rejects.toThrow(
      'ChainGPT Chat error: Rate limit exceeded'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// NFT Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleNftTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset call history on shared mock methods without clearing implementations
    Object.values(mockChatInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNftInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockAuditorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockGeneratorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNewsInstance).forEach(fn => fn.mockReset?.());
  });

  it('returns error when no arguments provided', async () => {
    const result = await handleNftTool('chaingpt_nft_generate_image', undefined);
    expect(result.content[0].text).toContain('No arguments provided');
  });

  it('generates image and returns base64 data', async () => {
    const mock = getNftMock();
    mock.generateImage.mockResolvedValue({ data: [137, 80, 78, 71, 0, 0] });

    const result = await handleNftTool('chaingpt_nft_generate_image', {
      prompt: 'A cyberpunk cat',
      model: 'velogen',
    });

    expect(mock.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A cyberpunk cat',
        model: 'velogen',
        width: 512,
        height: 512,
        steps: 2,
      })
    );
    expect(result.content[0].text).toContain('Image generated successfully');
    expect(result.content[0].text).toContain('base64');
  });

  it('returns raw JSON when image data is not an array', async () => {
    const mock = getNftMock();
    mock.generateImage.mockResolvedValue({ url: 'https://example.com/image.png' });

    const result = await handleNftTool('chaingpt_nft_generate_image', { prompt: 'test' });
    expect(result.content[0].text).toContain('url');
  });

  it('enhances prompt successfully', async () => {
    const mock = getNftMock();
    mock.enhancePrompt.mockResolvedValue({ enhancedPrompt: 'Ultra detailed cyberpunk cat' });

    const result = await handleNftTool('chaingpt_nft_enhance_prompt', { prompt: 'cyberpunk cat' });
    expect(result.content[0].text).toContain('Ultra detailed cyberpunk cat');
  });

  it('fetches supported chains', async () => {
    const mock = getNftMock();
    mock.getChains.mockResolvedValue([
      { name: 'Ethereum', chainId: 1 },
      { name: 'BSC', chainId: 56 },
    ]);

    const result = await handleNftTool('chaingpt_nft_get_chains', { testNet: false });
    expect(result.content[0].text).toContain('Supported chains');
    expect(result.content[0].text).toContain('Ethereum');
  });

  it('returns unknown tool for invalid name', async () => {
    const result = await handleNftTool('chaingpt_nft_nonexistent', { prompt: 'test' });
    expect(result.content[0].text).toContain('Unknown NFT tool');
  });

  it('throws wrapped error on SDK failure', async () => {
    const mock = getNftMock();
    mock.generateImage.mockRejectedValue(new Error('Insufficient credits'));

    await expect(
      handleNftTool('chaingpt_nft_generate_image', { prompt: 'test' })
    ).rejects.toThrow('ChainGPT NFT error: Insufficient credits');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Audit Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleAuditTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset call history on shared mock methods without clearing implementations
    Object.values(mockChatInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNftInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockAuditorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockGeneratorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNewsInstance).forEach(fn => fn.mockReset?.());
  });

  it('returns error when no arguments provided', async () => {
    const result = await handleAuditTool('chaingpt_audit_contract', undefined);
    expect(result.content[0].text).toContain('No arguments provided');
  });

  it('returns error when neither sourceCode nor followUpQuestion given', async () => {
    const result = await handleAuditTool('chaingpt_audit_contract', {});
    expect(result.content[0].text).toContain('Either sourceCode');
  });

  it('audits source code successfully', async () => {
    const mock = getAuditorMock();
    mock.auditSmartContractBlob.mockResolvedValue({
      data: { bot: 'Score: 85/100. No critical issues found.' },
    });

    const result = await handleAuditTool('chaingpt_audit_contract', {
      sourceCode: 'pragma solidity ^0.8.20; contract Test {}',
    });

    expect(mock.auditSmartContractBlob).toHaveBeenCalledWith(
      expect.objectContaining({ chatHistory: 'off' })
    );
    expect(result.content[0].text).toContain('Score: 85/100');
  });

  it('handles follow-up questions with session', async () => {
    const mock = getAuditorMock();
    mock.auditSmartContractBlob.mockResolvedValue({
      data: { bot: 'The reentrancy issue is on line 42.' },
    });

    const result = await handleAuditTool('chaingpt_audit_contract', {
      followUpQuestion: 'Where is the reentrancy bug?',
      sessionId: 'audit-sess-1',
    });

    expect(mock.auditSmartContractBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        chatHistory: 'on',
        sdkUniqueId: 'audit-sess-1',
      })
    );
    expect(result.content[0].text).toContain('reentrancy');
  });

  it('returns unknown tool for invalid name', async () => {
    const result = await handleAuditTool('chaingpt_audit_nonexistent', { sourceCode: 'test' });
    expect(result.content[0].text).toContain('Unknown audit tool');
  });

  it('throws wrapped error on SDK failure', async () => {
    const mock = getAuditorMock();
    mock.auditSmartContractBlob.mockRejectedValue(new Error('Service unavailable'));

    await expect(
      handleAuditTool('chaingpt_audit_contract', { sourceCode: 'contract T {}' })
    ).rejects.toThrow('ChainGPT Audit error: Service unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Generator Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleGeneratorTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset call history on shared mock methods without clearing implementations
    Object.values(mockChatInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNftInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockAuditorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockGeneratorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNewsInstance).forEach(fn => fn.mockReset?.());
  });

  it('returns error when no arguments provided', async () => {
    const result = await handleGeneratorTool('chaingpt_generate_contract', undefined);
    expect(result.content[0].text).toContain('No arguments provided');
  });

  it('generates a contract from description', async () => {
    const mock = getGeneratorMock();
    mock.createSmartContractBlob.mockResolvedValue({
      data: { bot: 'pragma solidity ^0.8.20; contract MyToken is ERC20 {}' },
    });

    const result = await handleGeneratorTool('chaingpt_generate_contract', {
      description: 'Create an ERC-20 token named TestCoin with 1M supply',
    });

    expect(mock.createSmartContractBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Create an ERC-20 token named TestCoin with 1M supply',
        chatHistory: 'off',
      })
    );
    expect(result.content[0].text).toContain('ERC20');
  });

  it('enables chat history when sessionId is provided', async () => {
    const mock = getGeneratorMock();
    mock.createSmartContractBlob.mockResolvedValue({ data: { bot: 'Updated contract' } });

    await handleGeneratorTool('chaingpt_generate_contract', {
      description: 'Add a burn function',
      sessionId: 'gen-sess-1',
    });

    expect(mock.createSmartContractBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        chatHistory: 'on',
        sdkUniqueId: 'gen-sess-1',
      })
    );
  });

  it('returns unknown tool for invalid name', async () => {
    const result = await handleGeneratorTool('chaingpt_generate_nonexistent', {
      description: 'test',
    });
    expect(result.content[0].text).toContain('Unknown generator tool');
  });

  it('throws wrapped error on SDK failure', async () => {
    const mock = getGeneratorMock();
    mock.createSmartContractBlob.mockRejectedValue(new Error('Timeout'));

    await expect(
      handleGeneratorTool('chaingpt_generate_contract', { description: 'test' })
    ).rejects.toThrow('ChainGPT Generator error: Timeout');
  });
});

// ═══════════════════════════════════════════════════════════════════
// News Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleNewsTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset call history on shared mock methods without clearing implementations
    Object.values(mockChatInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNftInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockAuditorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockGeneratorInstance).forEach(fn => fn.mockReset?.());
    Object.values(mockNewsInstance).forEach(fn => fn.mockReset?.());
  });

  it('returns categories reference for chaingpt_news_categories', async () => {
    const result = await handleNewsTool('chaingpt_news_categories', {});
    expect(result.content[0].text).toContain('Category IDs');
    expect(result.content[0].text).toContain('Blockchain (Sub-Category) IDs');
    expect(result.content[0].text).toContain('Token IDs');
    expect(result.content[0].text).toContain('DeFi');
    expect(result.content[0].text).toContain('Bitcoin');
    expect(result.content[0].text).toContain('CGPT');
  });

  it('fetches news articles and formats them', async () => {
    const mock = getNewsMock();
    mock.getNews.mockResolvedValue({
      data: [
        {
          title: 'ETH Update',
          description: 'Ethereum gets a new upgrade.',
          url: 'https://example.com/eth',
          pubDate: '2026-04-24',
          category: { name: 'DeFi' },
          subCategory: { name: 'Ethereum' },
          token: { symbol: 'ETH' },
          newsTags: ['ethereum'],
        },
      ],
      total: 1,
    });

    const result = await handleNewsTool('chaingpt_news_fetch', { limit: 5 });
    expect(result.content[0].text).toContain('ETH Update');
    expect(result.content[0].text).toContain('DeFi');
  });

  it('returns no articles message when empty', async () => {
    const mock = getNewsMock();
    mock.getNews.mockResolvedValue({ data: [], total: 0 });

    const result = await handleNewsTool('chaingpt_news_fetch', { search: 'nonexistent' });
    expect(result.content[0].text).toContain('No news articles found');
  });

  it('handles undefined args gracefully', async () => {
    const result = await handleNewsTool('chaingpt_news_categories', undefined);
    expect(result.content[0].text).toContain('Category IDs');
  });

  it('returns unknown tool for invalid name', async () => {
    const result = await handleNewsTool('chaingpt_news_nonexistent', {});
    expect(result.content[0].text).toContain('Unknown news tool');
  });

  it('throws wrapped error on SDK failure', async () => {
    const mock = getNewsMock();
    mock.getNews.mockRejectedValue(new Error('Network error'));

    await expect(handleNewsTool('chaingpt_news_fetch', {})).rejects.toThrow(
      'ChainGPT News error: Network error'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Utils Handler Tests
// ═══════════════════════════════════════════════════════════════════

describe('handleUtilTool', () => {
  it('estimates credits for basic chat', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'chat',
      options: {},
    });

    expect(result.content[0].text).toContain('Estimated Credits: 0.5');
    expect(result.content[0].text).toContain('$0.0050');
  });

  it('estimates credits for chat with history', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'chat',
      options: { chatHistory: true },
    });

    expect(result.content[0].text).toContain('Estimated Credits: 1');
  });

  it('estimates credits for NFT with Dale3 model', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'nft',
      options: { model: 'Dale3' },
    });

    expect(result.content[0].text).toContain('4.75');
  });

  it('estimates credits for NFT with upscale', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'nft',
      options: { model: 'velogen', enhance: '2x' },
    });

    expect(result.content[0].text).toContain('Estimated Credits: 3');
  });

  it('estimates credits for NFT with character preserve', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'nft',
      options: { characterPreserve: true },
    });

    expect(result.content[0].text).toContain('Character preserve');
  });

  it('estimates credits for audit', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'audit',
      options: {},
    });

    expect(result.content[0].text).toContain('Estimated Credits: 1');
  });

  it('estimates credits for news with custom limit', async () => {
    const result = await handleUtilTool('chaingpt_estimate_credits', {
      product: 'news',
      options: { newsLimit: 25 },
    });

    expect(result.content[0].text).toContain('Estimated Credits: 3');
  });

  it('returns balance instructions', async () => {
    const result = await handleUtilTool('chaingpt_check_balance', {});

    expect(result.content[0].text).toContain('https://app.chaingpt.org');
    expect(result.content[0].text).toContain('1 credit = $0.01 USD');
    expect(result.content[0].text).toContain('15% bonus');
  });

  it('returns unknown tool for invalid name', async () => {
    const result = await handleUtilTool('chaingpt_nonexistent', {});
    expect(result.content[0].text).toContain('Unknown utility tool');
  });

  it('handles undefined args gracefully', async () => {
    const result = await handleUtilTool('chaingpt_check_balance', undefined);
    expect(result.content[0].text).toContain('Dashboard');
  });
});
