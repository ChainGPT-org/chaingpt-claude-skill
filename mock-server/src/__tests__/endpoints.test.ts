/**
 * Mock Server Endpoint Tests
 *
 * Tests all mock API endpoints for correct response structure,
 * auth enforcement, filtering, and artificial latency.
 *
 * Setup: npm install -D vitest supertest @types/supertest
 * Run:   npx vitest run
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';

const AUTH_HEADER = 'Bearer test-api-key-123';

// ═══════════════════════════════════════════════════════════════════
// Auth Middleware
// ═══════════════════════════════════════════════════════════════════

describe('Auth Middleware', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with non-Bearer token', async () => {
    const res = await request(app)
      .get('/health')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
  });

  it('accepts any valid Bearer token', async () => {
    const res = await request(app)
      .get('/health')
      .set('Authorization', 'Bearer any-random-key');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Health Check
// ═══════════════════════════════════════════════════════════════════

describe('GET /health', () => {
  it('returns server status', async () => {
    const res = await request(app)
      .get('/health')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.server).toBe('@chaingpt/mock-server');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.totalCreditsSimulated).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat Endpoints
// ═══════════════════════════════════════════════════════════════════

describe('POST /chat/stream (blob mode)', () => {
  it('returns a valid chat response', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', AUTH_HEADER)
      .send({ model: 'general_assistant', question: 'What is BTC?' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data.bot).toBe('string');
    expect(res.body.data.bot.length).toBeGreaterThan(0);
    expect(res.body.data.user).toBe('What is BTC?');
    expect(res.headers['x-credit-cost']).toBeDefined();
  });

  it('returns ERC-20 contract for smart_contract_generator model', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', AUTH_HEADER)
      .send({ model: 'smart_contract_generator', question: 'Generate an ERC-20' });

    expect(res.status).toBe(200);
    expect(res.body.data.bot).toContain('pragma solidity');
    expect(res.body.data.bot).toContain('ERC20');
  });

  it('returns audit report for smart_contract_auditor model', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', AUTH_HEADER)
      .send({ model: 'smart_contract_auditor', question: 'Audit this contract' });

    expect(res.status).toBe(200);
    expect(res.body.data.bot).toContain('Audit Report');
    expect(res.body.data.bot).toContain('Critical');
  });

  it('reports higher credit cost when chatHistory is on', async () => {
    const res = await request(app)
      .post('/chat/stream')
      .set('Authorization', AUTH_HEADER)
      .send({ model: 'general_assistant', question: 'test', chatHistory: 'on' });

    expect(res.headers['x-credit-cost']).toBe('1');
  });
});

describe('GET /chat/chatHistory', () => {
  it('returns paginated chat history', async () => {
    const res = await request(app)
      .get('/chat/chatHistory?limit=3&offset=0')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.limit).toBe(3);
    expect(res.body.offset).toBe(0);
  });

  it('returns entries with expected fields', async () => {
    const res = await request(app)
      .get('/chat/chatHistory?limit=1')
      .set('Authorization', AUTH_HEADER);

    if (res.body.data.length > 0) {
      const entry = res.body.data[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('user');
      expect(entry).toHaveProperty('bot');
      expect(entry).toHaveProperty('model');
      expect(entry).toHaveProperty('createdAt');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// NFT Endpoints
// ═══════════════════════════════════════════════════════════════════

describe('POST /nft/generate-image', () => {
  it('returns image data as byte array', async () => {
    const res = await request(app)
      .post('/nft/generate-image')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'A cyberpunk cat', model: 'velogen' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    // Verify it starts with PNG signature bytes
    expect(res.body.data[0]).toBe(137);
    expect(res.body.data[1]).toBe(80);
    expect(res.body.data[2]).toBe(78);
    expect(res.body.data[3]).toBe(71);
  });
});

describe('POST /nft/generate-multiple-images', () => {
  it('returns multiple images', async () => {
    const res = await request(app)
      .post('/nft/generate-multiple-images')
      .set('Authorization', AUTH_HEADER)
      .send({ prompts: ['cat', 'dog', 'bird'] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);
    for (const img of res.body.data) {
      expect(Array.isArray(img.data)).toBe(true);
    }
  });
});

describe('POST /nft/generate-nft-queue', () => {
  it('returns a collection ID and queued status', async () => {
    const res = await request(app)
      .post('/nft/generate-nft-queue')
      .set('Authorization', AUTH_HEADER)
      .send({
        prompt: 'test nft',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        chainId: 1,
        amount: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.collectionId).toBeDefined();
    expect(res.body.data.collectionId).toMatch(/^mock-collection-/);
    expect(res.body.data.status).toBe('queued');
  });
});

describe('GET /nft/progress/:collectionId', () => {
  it('returns processing on first call, completed on second', async () => {
    // First: queue an NFT to get a collectionId
    const queueRes = await request(app)
      .post('/nft/generate-nft-queue')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'progress test', amount: 1 });

    const collectionId = queueRes.body.data.collectionId;

    // First progress check: processing
    const progress1 = await request(app)
      .get(`/nft/progress/${collectionId}`)
      .set('Authorization', AUTH_HEADER);

    expect(progress1.status).toBe(200);
    expect(progress1.body.data.status).toBe('processing');
    expect(progress1.body.data.progress).toBe(50);

    // Second progress check: completed
    const progress2 = await request(app)
      .get(`/nft/progress/${collectionId}`)
      .set('Authorization', AUTH_HEADER);

    expect(progress2.status).toBe(200);
    expect(progress2.body.data.status).toBe('completed');
    expect(progress2.body.data.progress).toBe(100);
    expect(Array.isArray(progress2.body.data.images)).toBe(true);
  });
});

describe('POST /nft/mint-nft', () => {
  it('returns mint result with token metadata', async () => {
    const res = await request(app)
      .post('/nft/mint-nft')
      .set('Authorization', AUTH_HEADER)
      .send({
        collectionId: 'mock-collection-test',
        name: 'TestNFT',
        symbol: 'TNFT',
        description: 'A test NFT',
        ids: [1, 2],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.name).toBe('TestNFT');
    expect(res.body.data.symbol).toBe('TNFT');
    expect(Array.isArray(res.body.data.tokens)).toBe(true);
    expect(res.body.data.tokens).toHaveLength(2);

    const token = res.body.data.tokens[0];
    expect(token.tokenId).toBe(1);
    expect(token.tokenURI).toMatch(/^ipfs:\/\//);
    expect(token.metadata.name).toContain('TestNFT');
    expect(Array.isArray(token.metadata.attributes)).toBe(true);
  });
});

describe('POST /nft/enhancePrompt', () => {
  it('returns an enhanced version of the prompt', async () => {
    const res = await request(app)
      .post('/nft/enhancePrompt')
      .set('Authorization', AUTH_HEADER)
      .send({ prompt: 'a cool dragon' });

    expect(res.status).toBe(200);
    expect(typeof res.body.enhancedPrompt).toBe('string');
    expect(res.body.enhancedPrompt).toContain('a cool dragon');
    expect(res.body.enhancedPrompt.length).toBeGreaterThan('a cool dragon'.length);
  });
});

describe('GET /nft/get-chains', () => {
  it('returns mainnet chains by default', async () => {
    const res = await request(app)
      .get('/nft/get-chains')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(5);

    const ethereum = res.body.data.find((c: any) => c.chainId === 1);
    expect(ethereum).toBeDefined();
    expect(ethereum.name).toBe('Ethereum');
  });

  it('returns testnet chains when testNet=true', async () => {
    const res = await request(app)
      .get('/nft/get-chains?testNet=true')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    const names = res.body.data.map((c: any) => c.name);
    expect(names).toContain('Sepolia');
    expect(names).toContain('Mumbai');
  });
});

describe('GET /nft/abi', () => {
  it('returns the mint factory ABI', async () => {
    const res = await request(app)
      .get('/nft/abi')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const createFn = res.body.data.find((e: any) => e.name === 'createCollection');
    expect(createFn).toBeDefined();
    expect(createFn.type).toBe('function');

    const mintFn = res.body.data.find((e: any) => e.name === 'mint');
    expect(mintFn).toBeDefined();
    expect(mintFn.stateMutability).toBe('payable');
  });
});

// ═══════════════════════════════════════════════════════════════════
// News Endpoint
// ═══════════════════════════════════════════════════════════════════

describe('GET /news', () => {
  it('returns paginated news articles', async () => {
    const res = await request(app)
      .get('/news?limit=5&offset=0')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(0);
  });

  it('returns articles with expected structure', async () => {
    const res = await request(app)
      .get('/news?limit=1')
      .set('Authorization', AUTH_HEADER);

    const article = res.body.data[0];
    expect(article).toHaveProperty('id');
    expect(article).toHaveProperty('title');
    expect(article).toHaveProperty('description');
    expect(article).toHaveProperty('url');
    expect(article).toHaveProperty('pubDate');
    expect(article).toHaveProperty('categoryId');
    expect(article).toHaveProperty('category');
    expect(article.category).toHaveProperty('id');
    expect(article.category).toHaveProperty('name');
  });

  it('filters by categoryId', async () => {
    const res = await request(app)
      .get('/news?categoryId=5')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    for (const article of res.body.data) {
      expect(article.categoryId).toBe(5);
    }
  });

  it('filters by subCategoryId (blockchain)', async () => {
    const res = await request(app)
      .get('/news?subCategoryId=15')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    for (const article of res.body.data) {
      expect(article.subCategoryId).toBe(15);
    }
  });

  it('returns empty data array for non-matching filter', async () => {
    const res = await request(app)
      .get('/news?categoryId=9999')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 404 Handler
// ═══════════════════════════════════════════════════════════════════

describe('404 Handler', () => {
  it('returns NOT_FOUND for unknown endpoints', async () => {
    const res = await request(app)
      .get('/nonexistent/endpoint')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Latency Test
// ═══════════════════════════════════════════════════════════════════

describe('Artificial Latency', () => {
  it('responds within 100-600ms range (allowing small margin)', async () => {
    const start = Date.now();

    await request(app)
      .get('/health')
      .set('Authorization', AUTH_HEADER);

    const elapsed = Date.now() - start;
    // The middleware adds 100-500ms, plus some processing overhead
    expect(elapsed).toBeGreaterThanOrEqual(80); // small margin below 100ms
    expect(elapsed).toBeLessThan(1000); // generous upper bound
  });
});
