import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

export const USER_AGENT = 'Mozilla/5.0 (compatible; ShopWacht/0.1; Shop-Compliance-Check)';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

// Source routing can distinguish a redirecting non-Shopify feed from a network outage.
export class RedirectLimitError extends FetchError {}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface Fetcher {
  get(url: string, accept?: string): Promise<FetchResult>;
}

/** Looks a host name up and answers with all of its addresses: `dns.lookup`, or a scripted answer in tests. */
export type Resolve = (hostname: string, options: LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const INTERNAL = 'Interne Adressen sind nicht erlaubt.';

export interface FetcherOptions {
  timeoutMs?: number;
  allowPrivate?: boolean;
  /** Name lookup for the address check and for the connection. Tests only. */
  resolve?: Resolve;
  /** Gap between request starts to the same host. Shopify answers bursts with 429. */
  minIntervalMs?: number;
  /** Retries after 429/503 before giving up. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

/**
 * Fetches public shop pages. Users type arbitrary URLs into the web form, so every
 * hop (including redirects) is checked against private and loopback addresses.
 * Requests to one host are spaced out and slowed further when the shop says 429.
 * The connection is made by `pinnedFetch`, whose sockets refuse internal addresses
 * themselves. The check before it looks the name up once and the socket looks it up again; a name that changed its answer in
 * between used to connect unchecked.
 */
export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl = opts.fetch ?? (opts.allowPrivate ? fetch : pinnedFetch(opts.resolve));
  const baseInterval = opts.minIntervalMs ?? 350;
  const maxRetries = opts.maxRetries ?? 4;
  const hosts = new Map<string, { next: number; interval: number }>();

  async function politeSlot(host: string): Promise<void> {
    const h = hosts.get(host) ?? { next: 0, interval: baseInterval };
    hosts.set(host, h);
    const now = Date.now();
    const start = Math.max(now, h.next);
    h.next = start + h.interval;
    if (start > now) await sleep(start - now);
  }

  function slowDown(host: string, retryAfterMs: number) {
    const h = hosts.get(host)!;
    h.interval = Math.min(2_000, h.interval * 2);
    h.next = Math.max(h.next, Date.now() + retryAfterMs);
  }

  return {
    async get(url, accept = 'text/html,application/json;q=0.9,*/*;q=0.8') {
      let current = url;
      for (let hop = 0, attempt = 0; hop < 6; ) {
        if (!opts.allowPrivate) await assertPublicUrl(current, opts.resolve);
        const host = new URL(current).host;
        await politeSlot(host);
        let res: Response;
        try {
          res = await fetchImpl(current, {
            redirect: 'manual',
            headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'de-DE,de;q=0.9' },
            signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
          });
        } catch (err) {
          // The socket's refusal of an internal address arrives as the cause of "fetch failed".
          const cause = (err as { cause?: unknown }).cause;
          if (cause instanceof FetchError) throw cause;
          throw new FetchError(`${host} nicht erreichbar (${(err as Error).message})`);
        }
        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          attempt++;
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : 1_000 * 2 ** attempt;
          await res.body?.cancel();
          slowDown(host, wait);
          continue;
        }
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          current = new URL(location, current).toString();
          hop++;
          continue;
        }
        return {
          url: current,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          body: await res.text(),
        };
      }
      throw new RedirectLimitError(`Zu viele Weiterleitungen: ${url}`);
    },
  };
}

/**
 * A socket `lookup` that hands out public addresses only. The name is resolved to all of its addresses; if one of them is
 * internal the connection fails, because the socket may pick any of them.
 */
export function publicOnlyLookup(resolve: Resolve = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      if (addresses.length === 0) return callback(new FetchError(`Domain nicht gefunden: ${hostname}`), []);
      if (addresses.some((a) => isPrivateAddress(a.address))) return callback(new FetchError(INTERNAL), []);
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/**
 * `fetch` whose connections go through `publicOnlyLookup`. Node's built-in `fetch` has no hook for the connection, so this is
 * the `fetch` of undici, the HTTP client the built-in one is made of. An address literal in the URL is never looked up – that
 * case is `assertPublicUrl`'s.
 */
export function pinnedFetch(resolve?: Resolve): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: publicOnlyLookup(resolve) } });
  return ((input: string | URL, init?: RequestInit) => undiciFetch(input, { ...(init as UndiciRequestInit | undefined), dispatcher })) as unknown as typeof fetch;
}

export async function assertPublicUrl(raw: string, resolve: Resolve = dnsLookup): Promise<void> {
  const host = checkUrlWithoutLookup(raw);
  if (host === undefined) return;
  const addresses = await new Promise<string[]>((done) => resolve(host, { all: true }, (err, found) => done(err ? [] : found.map((a) => a.address))));
  if (addresses.length === 0) throw new FetchError(`Domain nicht gefunden: ${host}`);
  if (addresses.some(isPrivateAddress)) throw new FetchError(INTERNAL);
}

/**
 * What a URL shows without a lookup: only http and https, only ports 80 and 443, no internal name, no internal address
 * literal. Returns the host name whose addresses are still to be judged – by `assertPublicUrl`, or by a socket that uses
 * `publicOnlyLookup` – and undefined for a public address literal.
 */
export function checkUrlWithoutLookup(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`Ungültige Adresse: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError('Nur http- und https-Adressen sind erlaubt.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchError('Nur Standard-Ports sind erlaubt.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new FetchError(INTERNAL);
  }
  if (!isIP(host)) return host;
  if (isPrivateAddress(host)) throw new FetchError(INTERNAL);
  return undefined;
}

/**
 * true for every address that is not on the public internet – and for anything that is no address at all.
 * IPv6 is parsed in full. The check knew `::ffff:1.2.3.4` only in dotted form, but
 * the URL parser writes `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`; that literal passed as public and connected to loopback, and
 * so did the other forms that carry an IPv4 address inside (compatible `::/96`, NAT64, 6to4).
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Bytes(ip);
  if (v4) return isPrivateIpv4(v4);
  const g = ipv6Groups(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // ::ffff:0:0/96 – IPv4-mapped: the socket connects to the IPv4 address.
  if (zero(0, 5) && g[5] === 0xffff) return embedded(g[6]!, g[7]!);
  // ::/96 – unspecified, loopback and the deprecated IPv4-compatible form: none is a public host.
  if (zero(0, 6)) return true;
  // NAT64: 64:ff9b::/96 carries the IPv4 address in its last 32 bits; 64:ff9b:1::/48 is for local use only (RFC 8215).
  if (g[0] === 0x64 && g[1] === 0xff9b) return zero(2, 6) ? embedded(g[6]!, g[7]!) : true;
  // 6to4: 2002:AABB:CCDD::/48 is the IPv4 address AA.BB.CC.DD.
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!);
  // Teredo (2001::/32), documentation (2001:db8::/32), discard (100::/64).
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;
  if (g[0] === 0x100 && zero(1, 4)) return true;
  const top = g[0]!;
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  return (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 || (top & 0xffc0) === 0xfec0 || (top & 0xff00) === 0xff00;
}

function ipv4Bytes(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const bytes = m.slice(1).map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    // 192.0.0.0/24 protocol assignments, 198.18.0.0/15 benchmarking, and the three documentation ranges.
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

/** An IPv6 address as its eight 16-bit groups; accepts "::", a dotted IPv4 tail and a zone id ("fe80::1%eth0"). */
function ipv6Groups(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return null;
  const lastColon = ip.lastIndexOf(':');
  const tail = ipv4Bytes(ip.slice(lastColon + 1));
  if (tail) ip = `${ip.slice(0, lastColon + 1)}${((tail[0]! << 8) | tail[1]!).toString(16)}:${((tail[2]! << 8) | tail[3]!).toString(16)}`;
  const [head, rest] = ip.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8) return null;
  const numbers = groups.map((x) => parseInt(x, 16));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? numbers : null;
}

/** Accepts "shop.de", "www.shop.de/collections/x", "https://shop.de" and returns the origin. */
export function normalizeShopUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new FetchError('Bitte eine Shop-Adresse eingeben.');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FetchError(`Das sieht nicht nach einer Web-Adresse aus: ${input}`);
  }
  if (!url.hostname.includes('.')) throw new FetchError(`Das sieht nicht nach einer Web-Adresse aus: ${input}`);
  return url.origin;
}
