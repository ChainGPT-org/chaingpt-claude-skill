import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import app from '../index';

const expressRequire = createRequire(require.resolve('express'));

it('keeps proxy trust disabled on the shipped mock app', () => {
  expect(app.get('trust proxy')).toBe(false);
  const req = Object.assign(Object.create(app.request), {
    socket: { remoteAddress: '203.0.113.9' },
    headers: { 'x-forwarded-for': '198.51.100.50' },
  });
  expect({ ip: req.ip, ips: req.ips }).toEqual({ ip: '203.0.113.9', ips: [] });
});

// CVE-2026-90711: exercise the dependency Express actually loads, including
// both proxy-addr compiler paths (one subnet versus an array of subnets).
type Trust = (address: string, index?: number) => boolean;
const proxyAddr: { compile(subnets: string | string[]): Trust } = expressRequire('proxy-addr');
const express = expressRequire('express');

function clientAddress(subnets: string | string[], peer: string, forwarded: string) {
  const server = express();
  server.set('trust proxy', subnets);
  const req: { ip: string; ips: string[] } = Object.assign(Object.create(server.request), {
    socket: { remoteAddress: peer },
    headers: { 'x-forwarded-for': forwarded },
  });
  return { ip: req.ip, ips: req.ips };
}

for (const mode of ['single', 'multiple'] as const) {
  const subnets = (subnet: string) => mode === 'single'
    ? subnet
    : ['2001:db8:ffff::/48', subnet];

  describe(`proxy trust with ${mode} subnet configuration`, () => {
    it.each(['::ffff:10.0.0.0/8', '::ffff:10.0.0.0/80', '::/1'])(
      'does not trust IPv4 peers through IPv6 subnet %s', (subnet) => {
        const configuration = subnets(subnet);
        const trust = proxyAddr.compile(configuration);
        for (const peer of ['203.0.113.9', '::ffff:203.0.113.9']) {
          expect(trust(peer, 0)).toBe(false);
          expect(clientAddress(configuration, peer, '198.51.100.50, 10.7.8.10')).toEqual({
            ip: peer,
            ips: [],
          });
        }
      },
    );

    it.each(['10.0.0.0/8', '::ffff:10.0.0.0/104'])(
      'preserves valid IPv4 proxy configuration %s', (subnet) => {
        const configuration = subnets(subnet);
        const trust = proxyAddr.compile(configuration);
        for (const peer of ['10.7.8.9', '::ffff:10.7.8.9']) {
          expect(trust(peer, 0)).toBe(true);
          expect(clientAddress(configuration, peer, '198.51.100.50, 10.7.8.10')).toEqual({
            ip: '198.51.100.50',
            ips: ['198.51.100.50', '10.7.8.10'],
          });
          // Stop at the first untrusted hop; do not accept the attacker's leftmost IP.
          expect(clientAddress(configuration, peer, '198.51.100.50, 203.0.113.9')).toEqual({
            ip: '203.0.113.9',
            ips: ['203.0.113.9'],
          });
        }
        expect(trust('203.0.113.9', 0)).toBe(false);
        expect(trust('::ffff:203.0.113.9', 0)).toBe(false);
        expect(trust('2001:db8::9', 0)).toBe(false);
      },
    );

    it('preserves native IPv6 trust without accepting mapped IPv4', () => {
      const trust = proxyAddr.compile(subnets('::/1'));
      expect(trust('2001:db8::9', 0)).toBe(true);
      expect(trust('8001:db8::9', 0)).toBe(false);
      expect(trust('203.0.113.9', 0)).toBe(false);
      expect(trust('::ffff:203.0.113.9', 0)).toBe(false);
    });
  });
}
