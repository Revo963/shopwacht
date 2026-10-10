// The headless browser resolves names itself and opens connections that request
// interception never sees (a WebSocket, for one). Everything it sends now leaves through a local proxy that judges the
// destination and dials only the address it judged. These tests use a local server as the "internal service" that must
// never be reached.
import { createSocket } from 'node:dgram';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import puppeteer from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPageLoader, findChrome } from '../src/sources/browser.js';
import { startEgressProxy, type EgressProxy } from '../src/sources/egress-proxy.js';
import type { Resolve } from '../src/sources/http.js';

// Test servers remember their connections: a browser that was just closed can leave one half-open, and `close()` waits for it.
const connected = new Map<Server | TcpServer, Set<Socket>>();
const listen = (server: Server | TcpServer) =>
  new Promise<number>((r) => {
    const sockets = new Set<Socket>();
    connected.set(server, sockets);
    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port));
  });
const closed = (server: Server | TcpServer) =>
  new Promise<void>((r) => {
    server.close(() => r());
    for (const socket of connected.get(server) ?? []) socket.destroy();
  });
const portOf = (proxy: EgressProxy) => Number(new URL(proxy.url).port);

/** Scripted name lookup: each call takes the next round of answers, the last round repeats. */
const answer = (...rounds: string[][]) => {
  const asked: string[] = [];
  const resolve: Resolve = (hostname, _options, callback) => {
    const addresses = rounds[Math.min(asked.length, rounds.length - 1)]!;
    asked.push(hostname);
    callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  };
  return { resolve, asked };
};

/** `CONNECT target` as a browser sends it for https and WebSocket destinations. */
function tunnel(proxy: EgressProxy, target: string): Promise<{ status: number; socket: Socket }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: portOf(proxy), method: 'CONNECT', path: target, headers: { host: target } });
    req.on('connect', (res, socket) => done({ status: res.statusCode ?? 0, socket }));
    req.on('error', fail);
    req.end();
  });
}

/** A plain-http request in the absolute form a browser sends to a proxy. */
function plain(proxy: EgressProxy, url: string, init: { method?: string; body?: string } = {}): Promise<{ status: number; body: string; headers: IncomingMessage['headers'] }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: portOf(proxy), method: init.method ?? 'GET', path: url, headers: { host: new URL(url).host, 'Proxy-Connection': 'keep-alive', 'X-Kept': 'Yes' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', fail);
    req.end(init.body);
  });
}

describe('egress proxy', () => {
  // The "internal service": counts every TCP connection, whatever is spoken on it.
  let connections = 0;
  const internal = createTcpServer((socket) => {
    connections++;
    socket.on('error', () => {});
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ninternal');
  });
  // A stand-in for a shop, reachable only where a test exempts it.
  const seen: { method?: string; url?: string; host?: string; kept?: string; proxyHeader?: string; body: string }[] = [];
  const shop = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, kept: req.headers['x-kept'] as string | undefined, proxyHeader: req.headers['proxy-connection'] as string | undefined, body });
      res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/plain', 'x-shop': 'yes' });
      res.end(`shop says hello to ${req.method} ${req.url}`);
    });
  });
  let internalPort = 0;
  let shopPort = 0;
  const proxies: EgressProxy[] = [];
  const proxyWith = async (opts?: Parameters<typeof startEgressProxy>[0]) => {
    const proxy = await startEgressProxy(opts);
    proxies.push(proxy);
    return proxy;
  };

  beforeAll(async () => {
    internalPort = await listen(internal);
    shopPort = await listen(shop);
  });
  afterAll(async () => {
    await Promise.all(proxies.map((p) => p.close()));
    await closed(internal);
    await closed(shop);
  });

  it('listens on loopback only', async () => {
    expect((await proxyWith()).url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('forwards a plain request and its answer, without the proxy-only headers', async () => {
    const proxy = await proxyWith({ allowPrivate: [`127.0.0.1:${shopPort}`] });
    seen.length = 0;
    const got = await plain(proxy, `http://127.0.0.1:${shopPort}/products/seife?variant=2`);
    expect(got).toMatchObject({ status: 200, body: 'shop says hello to GET /products/seife?variant=2' });
    expect(got.headers['x-shop']).toBe('yes');
    expect(seen).toEqual([{ method: 'GET', url: '/products/seife?variant=2', host: `127.0.0.1:${shopPort}`, kept: 'Yes', proxyHeader: undefined, body: '' }]);
    expect((await plain(proxy, `http://127.0.0.1:${shopPort}/missing`)).status).toBe(404);
    const posted = await plain(proxy, `http://127.0.0.1:${shopPort}/cart/add.js`, { method: 'POST', body: 'id=1' });
    expect(posted.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ method: 'POST', url: '/cart/add.js', body: 'id=1' });
  });

  it('opens a tunnel and carries what is sent through it', async () => {
    const proxy = await proxyWith({ allowPrivate: [`127.0.0.1:${shopPort}`] });
    const { status, socket } = await tunnel(proxy, `127.0.0.1:${shopPort}`);
    expect(status).toBe(200);
    const reply = await new Promise<string>((done) => {
      let text = '';
      socket.on('data', (chunk: Buffer) => (text += chunk.toString()));
      socket.on('close', () => done(text));
      socket.write(`GET /through-tunnel HTTP/1.1\r\nHost: 127.0.0.1:${shopPort}\r\nConnection: close\r\n\r\n`);
    });
    expect(reply).toContain('shop says hello to GET /through-tunnel');
  });

  it('exempts only the listed test server', async () => {
    const proxy = await proxyWith({ allowPrivate: [`127.0.0.1:${shopPort}`] });
    const before = connections;
    expect((await tunnel(proxy, `127.0.0.1:${internalPort}`)).status).toBe(403);
    expect((await plain(proxy, `http://127.0.0.1:${internalPort}/admin`)).status).toBe(403);
    expect(connections).toBe(before);
  });

  it.each([
    ['a loopback literal', (port: number) => `127.0.0.1:${port}`],
    ['loopback on a standard port', () => '127.0.0.1:80'],
    ['IPv6 loopback', () => '[::1]:443'],
    ['loopback wrapped in IPv6', () => '[::ffff:7f00:1]:443'],
    ['localhost by name', (port: number) => `localhost:${port}`],
    ['a home-network address', () => '192.168.1.1:443'],
    ['the cloud metadata address', () => '169.254.169.254:80'],
  ])('refuses a tunnel to %s', async (_name, target) => {
    const proxy = await proxyWith();
    const before = connections;
    const { status, socket } = await tunnel(proxy, target(internalPort));
    socket.destroy();
    expect(status).toBe(403);
    expect(connections).toBe(before);
    expect([...proxy.refused.values()].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('refuses a plain request to an internal address and says which destination it refused', async () => {
    const proxy = await proxyWith();
    const before = connections;
    expect((await plain(proxy, `http://127.0.0.1:${internalPort}/admin`)).status).toBe(403);
    expect((await plain(proxy, `http://127.0.0.1:${internalPort}/admin`)).status).toBe(403);
    expect(connections).toBe(before);
    expect(Object.fromEntries(proxy.refused)).toEqual({ [`127.0.0.1:${internalPort}`]: 2 });
  });

  it.each([
    [['127.0.0.1']],
    [['192.168.1.1']],
    // one internal address among public ones is enough: the socket may pick any of them
    [['23.227.38.65', '10.0.0.5']],
  ])('refuses a name that resolves to %j', async (addresses) => {
    const before = connections;
    const { resolve, asked } = answer(addresses);
    const proxy = await proxyWith({ resolve });
    expect((await tunnel(proxy, 'intranet.test:443')).status).toBe(403);
    expect((await plain(proxy, 'http://intranet.test/admin')).status).toBe(403);
    expect(Object.fromEntries(proxy.refused)).toEqual({ 'intranet.test:443': 1, 'intranet.test:80': 1 });
    // One lookup per connection, made by the socket that would connect: there is no second answer to slip in.
    expect(asked).toEqual(['intranet.test', 'intranet.test']);
    expect(connections).toBe(before);
  });

  it('refuses a public name on a port other than 80 and 443, without dialling', async () => {
    const { resolve, asked } = answer(['23.227.38.65']);
    const proxy = await proxyWith({ resolve });
    expect((await tunnel(proxy, 'shop.test:8443')).status).toBe(403);
    expect((await plain(proxy, 'http://shop.test:8096/web/')).status).toBe(403);
    expect(asked).toEqual([]);
  });

  it('ends only the one connection when a request cannot be handled', async () => {
    const proxy = await proxyWith({ allowPrivate: [`127.0.0.1:${shopPort}`] });
    // Not a destination at all, and a port no socket can dial.
    expect((await tunnel(proxy, '[::not-an-address]:443')).status).toBe(400);
    expect((await tunnel(proxy, 'shop.test:99999')).status).toBe(400);
    expect((await plain(proxy, `http://127.0.0.1:${shopPort}/still-works`)).status).toBe(200);
  });

  it('survives a server that answers with something that is not http', async () => {
    // Garbage, a header name with a space, a control character in a header value, and no answer at all.
    const replies = [
      '\u0000\u0001 not http at all\r\n\r\n',
      'HTTP/1.1 200 OK\r\nX Bad Name: 1\r\n\r\n',
      'HTTP/1.1 200 OK\r\nX-Bad: a\u0001b\r\nContent-Length: 0\r\n\r\n',
      '',
    ];
    let served = 0;
    const hostile = createTcpServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.end(replies[served++ % replies.length]!));
    });
    const hostilePort = await listen(hostile);
    const proxy = await proxyWith({ allowPrivate: [`127.0.0.1:${hostilePort}`, `127.0.0.1:${shopPort}`] });
    try {
      for (const _reply of replies) expect((await plain(proxy, `http://127.0.0.1:${hostilePort}/`)).status).toBe(502);
      expect((await plain(proxy, `http://127.0.0.1:${shopPort}/still-works`)).status).toBe(200);
    } finally {
      await closed(hostile);
    }
  });

  it('answers 400 to a request that is not a proxy request', async () => {
    const proxy = await proxyWith();
    const status = await new Promise<number>((done, fail) => {
      request({ host: '127.0.0.1', port: portOf(proxy), path: '/' }, (res) => done(res.statusCode ?? 0)).on('error', fail).end();
    });
    expect(status).toBe(400);
  });

  it('closes with tunnels still open', async () => {
    const proxy = await startEgressProxy({ allowPrivate: [`127.0.0.1:${shopPort}`] });
    const { socket } = await tunnel(proxy, `127.0.0.1:${shopPort}`);
    const ended = new Promise<void>((done) => socket.on('close', () => done()));
    await proxy.close();
    await ended;
  });
});

const chrome = findChrome();

// What a hostile shop page can try. Every attempt ends quickly either way; the last line tells the test all were made.
const attempts = (internalPort: number, udpPort: number) => `<!doctype html><html><body><h1>Seife</h1><p id="state">trying</p><script>
(async () => {
  const inside = '127.0.0.1:${internalPort}';
  // UDP, which no proxy carries: a STUN request through WebRTC and a QUIC handshake through WebTransport.
  const udp = (async () => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udpPort}' }] });
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
    } catch {}
    try { const wt = new WebTransport('https://127.0.0.1:${udpPort}/'); wt.ready.catch(() => {}); wt.closed.catch(() => {}); } catch {}
    await new Promise((done) => setTimeout(done, 1200));
  })();
  const socket = (url) => new Promise((done) => {
    try { const ws = new WebSocket(url); ws.onopen = ws.onerror = ws.onclose = () => done(); } catch { done(); }
    setTimeout(done, 3000);
  });
  await socket('ws://' + inside + '/socket');
  await socket('ws://localhost:${internalPort}/socket');
  await socket('ws://169.254.169.254/latest/meta-data/');
  await fetch('http://' + inside + '/fetch', { mode: 'no-cors' }).catch(() => {});
  navigator.sendBeacon('http://' + inside + '/beacon', 'x');
  await new Promise((done) => {
    const source = "fetch('http://" + inside + "/worker', { mode: 'no-cors' }).catch(() => {}).finally(() => postMessage(1))";
    try { const worker = new Worker(URL.createObjectURL(new Blob([source]))); worker.onmessage = () => done(); } catch { done(); }
    setTimeout(done, 3000);
  });
  await udp;
  document.getElementById('state').textContent = 'all attempts made';
})();
</script></body></html>`;

describe.skipIf(!chrome)('a page in the headless browser cannot reach an internal service', () => {
  let connections = 0;
  const internal = createTcpServer((socket) => {
    connections++;
    socket.on('error', () => {});
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ninternal');
  });
  let internalPort = 0;
  // The same service's UDP side: counts every datagram.
  let datagrams = 0;
  const internalUdp = createSocket('udp4');
  internalUdp.on('message', () => datagrams++);
  let udpPort = 0;
  const shop = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(attempts(internalPort, udpPort));
  });
  let shopPort = 0;

  beforeAll(async () => {
    internalPort = await listen(internal);
    await new Promise<void>((r) => internalUdp.bind(0, '127.0.0.1', r));
    udpPort = internalUdp.address().port;
    shopPort = await listen(shop);
  });
  afterAll(async () => {
    await closed(internal);
    await new Promise<void>((r) => internalUdp.close(() => r()));
    await closed(shop);
  });

  it('reaches it when requests are only intercepted, as before – the gap', async () => {
    const before = connections;
    const datagramsBefore = datagrams;
    const browser = await puppeteer.launch({ executablePath: chrome!, headless: true, args: ['--no-first-run', '--mute-audio'] });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      // The loader's rule: let a request pass only when its address is allowed – here, only the shop's own.
      page.on('request', (req) => {
        const url = req.url();
        const ok = url.startsWith('data:') || url.startsWith('blob:') || new URL(url).host === `127.0.0.1:${shopPort}`;
        void (ok ? req.continue() : req.abort('blockedbyclient')).catch(() => {});
      });
      await page.goto(`http://127.0.0.1:${shopPort}/products/seife`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('state')?.textContent === 'all attempts made', { timeout: 20_000 });
    } finally {
      await browser.close();
    }
    expect(connections).toBeGreaterThan(before);
    expect(datagrams).toBeGreaterThan(datagramsBefore);
  }, 60_000);

  it('does not reach it through the page loader', async () => {
    const before = connections;
    const datagramsBefore = datagrams;
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: [`127.0.0.1:${shopPort}`], minIntervalMs: 0 });
    try {
      const page = await loader.load(`http://127.0.0.1:${shopPort}/products/seife`);
      expect(page?.text).toContain('all attempts made');
      expect(connections).toBe(before);
      expect(datagrams).toBe(datagramsBefore);
      // The browser handed loopback, localhost and link-local to the proxy instead of connecting on its own.
      const refused = [...loader.refusedDestinations.keys()];
      expect(refused).toContain(`127.0.0.1:${internalPort}`);
      expect(refused).toContain(`localhost:${internalPort}`);
      expect(refused).toContain('169.254.169.254:80');
    } finally {
      await loader.close();
    }
  }, 60_000);

  it('still refuses an internal address as the page to load', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: [`127.0.0.1:${shopPort}`], minIntervalMs: 0 });
    try {
      expect(await loader.load(`http://127.0.0.1:${internalPort}/admin`)).toBeNull();
      expect(Object.fromEntries(loader.failures)).toEqual({ 'address refused': 1 });
    } finally {
      await loader.close();
    }
  }, 60_000);
});
