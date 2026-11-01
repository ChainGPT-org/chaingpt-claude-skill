import { describe, it, expect, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => ({
    'public.example': [{ address: '93.184.215.14', family: 4 }],
    'mixed.example': [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.5', family: 4 }],
    'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }],
  } as Record<string, unknown>)[host] ?? [{ address: '127.0.0.1', family: 4 }]),
}));

import { assertPublicUrl } from '../lib/public-url.js';

describe('assertPublicUrl', () => {
  it('allows public hosts', async () => {
    await expect(assertPublicUrl('https://public.example/card.json')).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://public.example/card.json')).resolves.toBeInstanceOf(URL);
  });

  it('refuses loopback, private, link-local, metadata and mapped addresses', async () => {
    for (const u of ['http://localhost/', 'http://127.0.0.1:8545/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://169.254.169.254/',
      'http://[::1]/', 'http://[fd00::1]/', 'http://mixed.example/', 'http://mapped.example/', 'http://0.0.0.0/']) {
      await expect(assertPublicUrl(u), u).rejects.toThrow(/loopback, private or link-local/);
    }
  });

  it('refuses non-http schemes and plain http when https is required', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/must be http/);
    await expect(assertPublicUrl('http://public.example/', { httpsOnly: true })).rejects.toThrow(/must be https/);
  });
});
