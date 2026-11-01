// URLs that come from untrusted input (an on-chain agent card, a 402 resource the agent was
// pointed at) must not make this server reach loopback, private-network or cloud-metadata hosts.
import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
// ::/96 IPv4-compatible, ::ffff:0:0:0/96 SIIT, 64:ff9b::/96 NAT64, 2002::/16 6to4 all embed IPv4; fec0::/10 site-local.
for (const [net, bits] of [['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fec0::', 10],
  ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, bits, 'ipv6');

function isBlocked(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

const refusal = (host: string) => new Error(`Refusing to fetch ${host}: it resolves to a loopback, private or link-local address.`);

/**
 * Throws unless `raw` is an http(s) URL (https when httpsOnly) whose host resolves only to public addresses.
 * This is an early, readable check only: a later connection re-resolves the name. Use publicFetch to connect.
 */
export async function assertPublicUrl(raw: string, { httpsOnly = false } = {}): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) throw new Error(`URL must be ${httpsOnly ? 'https' : 'http(s)'}: ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address);
  if (!addrs.length || addrs.some(isBlocked)) throw refusal(url.host);
  return url;
}

// Runs inside the socket connect, so the address checked here is the address connected to:
// a DNS server that answers public first and private second cannot slip past it.
const guardedLookup: LookupFunction = (host, opts, cb) => dnsLookup(host, { family: opts.family, hints: opts.hints, all: true }, (err, addrs) => {
  if (err) return cb(err, '');
  if (!addrs.length || addrs.some(a => isBlocked(a.address))) return cb(refusal(host), '');
  if (opts.all) cb(null, addrs);
  else cb(null, addrs[0].address, addrs[0].family);
});

/**
 * fetch() for untrusted URLs: same checks as assertPublicUrl, plus the connection itself only goes to a checked
 * address. Host header and TLS SNI/certificate checks still use the URL's hostname. Redirects are never followed:
 * a 3xx comes back as-is. No pooled sockets, so a socket opened by other code cannot be reused.
 */
export async function publicFetch(
  raw: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {},
  opts: { httpsOnly?: boolean } = {},
): Promise<Response> {
  const url = await assertPublicUrl(raw, opts);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: init.headers, signal: init.signal, lookup: guardedLookup, agent: false }, res => {
      try {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        const status = res.statusCode ?? 0;
        const noBody = status === 204 || status === 205 || status === 304 || init.method === 'HEAD';
        if (noBody) res.resume();
        resolve(new Response(noBody ? null : Readable.toWeb(res) as ReadableStream, { status, statusText: res.statusMessage, headers }));
      } catch (e) {
        res.destroy();
        reject(e);
      }
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
