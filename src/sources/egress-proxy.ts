// The way out for the headless browser. A scanned page runs its own scripts in that
// browser, and the browser resolves names itself and opens connections that request interception never sees (a WebSocket,
// for one). Chromium is started with this proxy as its only route, so every destination is judged here and dialled here.
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { checkUrlWithoutLookup, FetchError, publicOnlyLookup, type Resolve } from './http.js';

export interface EgressProxyOptions {
  /** Tests only: allow internal addresses and any port – everywhere, or only for the listed `host:port`. */
  allowPrivate?: boolean | string[];
  /** Name lookup for the connection. Tests only. */
  resolve?: Resolve;
  /** How long a destination may take to accept the connection. */
  connectTimeoutMs?: number;
}

export interface EgressProxy {
  /** For Chromium's `--proxy-server`. */
  readonly url: string;
  /** Destinations that were refused, as `host:port`, and how often. */
  readonly refused: ReadonlyMap<string, number>;
  close(): Promise<void>;
}

const MAX_REFUSED_KEPT = 200;
// Meant for the proxy itself, not for the destination.
const PROXY_ONLY_HEADERS = new Set(['proxy-connection', 'proxy-authorization']);

/**
 * A forward proxy on 127.0.0.1 for CONNECT tunnels (https, WebSocket) and plain http. A destination passes
 * `checkUrlWithoutLookup` (ports 80 and 443, no internal name or address literal) and is dialled with `publicOnlyLookup`: a
 * name is looked up once, by the socket that connects, and that answer is judged. Everything else gets 403.
 */
export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const guarded = publicOnlyLookup(opts.resolve);
  const refused = new Map<string, number>();
  const open = new Set<Duplex>();
  const track = <T extends Duplex>(stream: T): T => {
    open.add(stream);
    stream.on('close', () => open.delete(stream));
    // A reset from either side must never reach the process.
    stream.on('error', () => {});
    return stream;
  };

  const keyOf = (to: URL) => `${to.hostname}:${to.port || '80'}`;
  const refuse = (to: URL) => {
    const key = keyOf(to);
    if (refused.has(key) || refused.size < MAX_REFUSED_KEPT) refused.set(key, (refused.get(key) ?? 0) + 1);
  };
  const exempt = (to: URL) => opts.allowPrivate === true || (Array.isArray(opts.allowPrivate) && opts.allowPrivate.includes(to.host));
  /** How to dial the destination, or undefined when it is refused. */
  const admit = (to: URL) => {
    const dial = { host: to.hostname.replace(/^\[|\]$/g, ''), port: Number(to.port || 80) };
    if (exempt(to)) return dial;
    try {
      checkUrlWithoutLookup(to.href);
    } catch {
      refuse(to);
      return undefined;
    }
    return { ...dial, lookup: guarded };
  };
  // The socket's lookup refuses with a FetchError when the name has an internal address.
  const statusOf = (to: URL, err: Error) => {
    if (!(err instanceof FetchError)) return 502;
    refuse(to);
    return 403;
  };

  function tunnel(req: IncomingMessage, client: Duplex, head: Buffer): void {
    const answer = (status: number, text: string) => void client.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    let to: URL;
    try {
      to = new URL(`http://${req.url ?? ''}`);
    } catch {
      return answer(400, 'Bad Request');
    }
    const dial = admit(to);
    if (!dial) return answer(403, 'Forbidden');
    const upstream = track(connect(dial));
    const timer = setTimeout(() => upstream.destroy(new Error('connect timeout')), opts.connectTimeoutMs ?? 15_000);
    let connected = false;
    upstream.once('connect', () => {
      connected = true;
      clearTimeout(timer);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once('error', (err) => {
      clearTimeout(timer);
      if (connected) return void client.destroy();
      const status = statusOf(to, err);
      answer(status, status === 403 ? 'Forbidden' : 'Bad Gateway');
    });
    upstream.once('close', () => {
      clearTimeout(timer);
      if (connected) client.destroy();
    });
    client.once('close', () => upstream.destroy());
  }

  function forward(req: IncomingMessage, res: ServerResponse): void {
    const answer = (status: number) => {
      try {
        if (res.headersSent) return void res.destroy();
        res.writeHead(status, { connection: 'close', 'content-length': 0 }).end();
      } catch {
        res.destroy();
      }
    };
    let to: URL;
    try {
      to = new URL(req.url ?? '');
    } catch {
      return answer(400);
    }
    if (to.protocol !== 'http:') return answer(400);
    const dial = admit(to);
    if (!dial) return answer(403);

    const headers: OutgoingHttpHeaders = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!;
      if (PROXY_ONLY_HEADERS.has(name.toLowerCase())) continue;
      const earlier = headers[name];
      const value = req.rawHeaders[i + 1]!;
      headers[name] = earlier === undefined ? value : [...(Array.isArray(earlier) ? earlier : [String(earlier)]), value];
    }
    // The destination is the URL's host, whatever the Host header says; one connection per request.
    for (const name of Object.keys(headers)) if (/^(host|connection)$/i.test(name)) delete headers[name];
    headers.Host = to.host;
    headers.Connection = 'close';

    const upstream = httpRequest({ ...dial, method: req.method, path: `${to.pathname}${to.search}`, headers, agent: false, timeout: opts.connectTimeoutMs ?? 15_000 }, (from) => {
      from.once('error', () => res.destroy());
      try {
        // Throws on a status line or header this side refuses to write; the answer comes from a server nobody vouches for.
        res.writeHead(from.statusCode ?? 502, from.statusMessage, from.rawHeaders);
      } catch {
        from.destroy();
        return answer(502);
      }
      from.pipe(res);
    });
    upstream.once('socket', (socket) => track(socket));
    upstream.once('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.once('error', (err) => answer(statusOf(to, err)));
    res.once('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  // Whatever a page sends, a request the proxy cannot handle ends that connection and nothing else.
  const server = createServer((req, res) => {
    try {
      forward(req, res);
    } catch {
      res.destroy();
    }
  });
  server.on('connect', (req, client: Duplex, head: Buffer) => {
    try {
      tunnel(req, client, head);
    } catch {
      client.destroy();
    }
  });
  server.on('connection', (socket) => track(socket));
  server.on('clientError', (_err, socket) => socket.destroy());

  await new Promise<void>((ready, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', ready);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    refused,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        for (const stream of open) stream.destroy();
      }),
  };
}
