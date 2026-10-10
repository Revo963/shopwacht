// The scanner fetches whatever a scanned shop redirects to and whatever its pages
// load, so "is this address internal?" must hold for every way an address can be written. Before this change an IPv4 address
// wrapped in IPv6 (`[::ffff:127.0.0.1]`, which the URL parser rewrites to `[::ffff:7f00:1]`) passed as public and connected to
// a service on this machine's loopback.
import { createServer } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, assertPublicUrl, createFetcher, isPrivateAddress, pinnedFetch, publicOnlyLookup, type Resolve } from '../src/sources/http.js';

describe('internal addresses, however they are written', () => {
  it.each([
    // plain IPv4
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.100', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    // special-purpose IPv4 that is not on the public internet either
    '192.0.0.8', '198.18.0.1', '198.19.255.255', '192.0.2.1', '198.51.100.1', '203.0.113.1',
    // IPv4 mapped into IPv6, dotted and as the URL parser writes it
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:101', '::FFFF:10.0.0.1', '0:0:0:0:0:ffff:7f00:1',
    // deprecated IPv4-compatible form
    '::127.0.0.1', '::7f00:1',
    // NAT64 and 6to4 carry an IPv4 address inside
    '64:ff9b::7f00:1', '64:ff9b::c0a8:101', '64:ff9b:1::a00:1', '2002:7f00:1::', '2002:c0a8:101::1',
    // Teredo, and IPv6's own internal ranges
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', '::', '::1', 'fc00::1', 'fd7a:115c:a1e0::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1',
    '2001:db8::1', '100::1',
    // not an address at all
    '', 'not-an-ip', '1.2.3', ':::',
  ])('%s is internal', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8', '23.227.38.65', '198.17.255.255', '198.20.0.1', '192.0.1.1',
    '2606:4700:4700::1111', '2a00:1450:4001:81b::200e',
    // public IPv4 inside IPv6 stays public
    '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1',
  ])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('the URL check a redirect or a page request goes through', () => {
  it.each([
    'http://[::ffff:127.0.0.1]/admin',
    'http://[::ffff:192.168.1.1]/',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:c0a8:101::1]/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://2130706433/',
    'http://198.18.0.1/',
  ])('refuses %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow('Interne Adressen sind nicht erlaubt.');
  });

  it('still allows a public address literal', async () => {
    await expect(assertPublicUrl('https://[2606:4700:4700::1111]/')).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeUndefined();
  });
});

// The check above looks a name up, and the socket used to look it up again. A name
// that answers "public" to the first lookup and "127.0.0.1" to the second passed the check and connected inside. The socket's
// own lookup now refuses internal addresses, so no unchecked lookup is left.
describe('the connection itself refuses internal addresses', () => {
  const answer = (...rounds: string[][]) => {
    const asked: string[] = [];
    const resolve: Resolve = (hostname, _options, callback) => {
      const addresses = rounds[Math.min(asked.length, rounds.length - 1)]!;
      asked.push(hostname);
      callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
    };
    return { resolve, asked };
  };
  const lookedUp = (resolve: Resolve, all: boolean) =>
    new Promise<unknown>((done) => publicOnlyLookup(resolve)('shop.test', { all }, (err, address, family) => done(err ? err.message : all ? address : [address, family])));

  it('hands a public answer to the socket in the form the socket asked for', async () => {
    const { resolve } = answer(['23.227.38.65', '2606:4700:4700::1111']);
    expect(await lookedUp(resolve, true)).toEqual([{ address: '23.227.38.65', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]);
    expect(await lookedUp(resolve, false)).toEqual(['23.227.38.65', 4]);
  });

  it.each([
    [['127.0.0.1']],
    [['192.168.1.20']],
    [['::ffff:7f00:1']],
    // one internal address among public ones is enough: the socket may pick any of them
    [['23.227.38.65', '10.0.0.5']],
  ])('refuses a name that resolves to %j', async (addresses) => {
    expect(await lookedUp(answer(addresses).resolve, true)).toBe('Interne Adressen sind nicht erlaubt.');
    expect(await lookedUp(answer(addresses).resolve, false)).toBe('Interne Adressen sind nicht erlaubt.');
  });

  it('passes a failed lookup on, and treats an empty answer as "not found"', async () => {
    const failing: Resolve = (_hostname, _options, callback) => callback(Object.assign(new Error('getaddrinfo ENOTFOUND shop.test'), { code: 'ENOTFOUND' }), []);
    expect(await lookedUp(failing, true)).toBe('getaddrinfo ENOTFOUND shop.test');
    expect(await lookedUp(answer([]).resolve, true)).toBe('Domain nicht gefunden: shop.test');
  });

  describe('against a service on this machine', () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end('internal admin page');
    });
    let port = 0;
    beforeAll(async () => {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    it('is reached by a name that resolves to loopback when the socket lookup is unguarded – the gap', async () => {
      const unguarded: LookupFunction = (_hostname, options, callback) => (options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
      const agent = new Agent({ connect: { lookup: unguarded } });
      const res = await undiciFetch(`http://rebind.test:${port}/admin`, { dispatcher: agent });
      expect(await res.text()).toBe('internal admin page');
      expect(hits).toBe(1);
      await agent.close();
    });

    it('is not reached through the guarded connection', async () => {
      const before = hits;
      const { resolve, asked } = answer(['127.0.0.1']);
      await expect(pinnedFetch(resolve)(`http://rebind.test:${port}/admin`)).rejects.toThrow('fetch failed');
      expect(asked).toEqual(['rebind.test']);
      expect(hits).toBe(before);
    });
  });

  it('stops a name that is public for the check and internal for the connection', async () => {
    const { resolve, asked } = answer(['23.227.38.65'], ['127.0.0.1']);
    const fetcher = createFetcher({ resolve, minIntervalMs: 0 });
    const failure = await fetcher.get('http://rebind.test/admin').then(() => null, (err: unknown) => err);
    expect(failure).toBeInstanceOf(FetchError);
    expect((failure as FetchError).message).toBe('Interne Adressen sind nicht erlaubt.');
    // Asked twice: once by the check, once by the socket – and the socket's answer was judged too.
    expect(asked).toEqual(['rebind.test', 'rebind.test']);
  });

  it('checks a name with the injected resolver, without touching real DNS', async () => {
    await expect(assertPublicUrl('https://shop.test/', answer(['23.227.38.65']).resolve)).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://shop.test/', answer(['10.0.0.5']).resolve)).rejects.toThrow('Interne Adressen sind nicht erlaubt.');
    await expect(assertPublicUrl('https://shop.test/', answer([]).resolve)).rejects.toThrow('Domain nicht gefunden: shop.test');
  });
});
