// URLs that come from untrusted input (an on-chain agent card, a 402 resource the agent was
// pointed at) must not make this server reach loopback, private-network or cloud-metadata hosts.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, bits, 'ipv6');

function isBlocked(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Throws unless `raw` is an http(s) URL (https when httpsOnly) whose host resolves only to public addresses.
 * ponytail: resolves once before the fetch; a rebinding DNS server can still race it. Pin the IP if that matters.
 */
export async function assertPublicUrl(raw: string, { httpsOnly = false } = {}): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:')) throw new Error(`URL must be ${httpsOnly ? 'https' : 'http(s)'}: ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address);
  if (!addrs.length || addrs.some(isBlocked)) throw new Error(`Refusing to fetch ${url.host}: it resolves to a loopback, private or link-local address.`);
  return url;
}
