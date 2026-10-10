import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core';
import { startEgressProxy, type EgressProxy } from './egress-proxy.js';
import { assertPublicUrl, USER_AGENT } from './http.js';

/** What a shopper's browser shows after scripts ran: rendered HTML and text. */
export interface RenderedPage {
  html: string;
  text: string;
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

export interface BrowserLoaderOptions {
  executablePath: string;
  /** Pages rendered at the same time. Rendering is heavy; shops rate-limit. */
  concurrency?: number;
  timeoutMs?: number;
  /** How long the browser may take to answer one command. A page that blocks its own thread holds its tab that long. */
  protocolTimeoutMs?: number;
  /** Gap between page loads on the same host. */
  minIntervalMs?: number;
  /** Tests only: allow localhost – everywhere, or only the listed `host:port` that stand in for a shop. */
  allowPrivate?: boolean | string[];
}

const SKIPPED_RESOURCES = new Set(['image', 'media', 'font']);
const REFUSE_COOKIES = /nur notwendige|nur erforderliche|alle ablehnen|ablehnen|only necessary|reject all/i;

/** An error's name and first line without addresses, so failures of the same kind count together. */
function reasonOf(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const line = (e.message.split('\n')[0] ?? '').replace(/\s+at\s+\S+:\/\/\S+/g, '').replace(/\S+:\/\/\S+/g, '<url>').trim();
  return `${e.name}: ${line}`.slice(0, 160);
}

/**
 * Loads product pages in headless Chrome, so content that themes render with
 * JavaScript (material tabs, unit prices, 30-day price notes) is visible.
 * Every request the page makes is checked against private addresses.
 * And every connection the browser opens leaves through the egress proxy, which
 * judges the destination again and dials it itself. The check on requests alone left two ways inside: the browser resolves a
 * name on its own, after the check, and a page's WebSocket is never offered to the request check at all.
 */
export class BrowserPageLoader {
  /** Why loads came back empty, e.g. "HTTP 429", "address refused" or the error's first line. */
  readonly failures = new Map<string, number>();
  /** Destinations the rendered pages tried to reach and the egress proxy refused, as `host:port`, and how often. */
  refusedDestinations: ReadonlyMap<string, number> = new Map();
  private browser?: Promise<Browser>;
  private proxy?: EgressProxy;
  private active = 0;
  private waiting: (() => void)[] = [];
  private hostVerdicts = new Map<string, Promise<boolean>>();
  private nextStart = new Map<string, number>();

  constructor(private readonly opts: BrowserLoaderOptions) {}

  async load(url: string): Promise<RenderedPage | null> {
    await this.acquire();
    let page: Page | undefined;
    try {
      if (!(await this.isAllowed(url))) return this.failed('address refused');
      await this.politeSlot(new URL(url).host);
      const browser = await this.getBrowser();
      // A window of its own: of several tabs in one window the browser draws only the front one. A page that is not drawn
      // never finishes a smooth scroll and loads nothing lazily, and the scroll step below waited on it for as long as the
      // tab stayed behind.
      page = await browser.newPage({ type: 'window' });
      await page.setUserAgent(USER_AGENT);
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      // Requests can still arrive while the page closes; a failure there must never reach the process.
      page.on('request', (req) => {
        this.route(req).catch(() => {});
      });

      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.opts.timeoutMs ?? 20_000 });
      if (!response) return this.failed('no response');
      if (response.status() >= 400) return this.failed(`HTTP ${response.status()}`);
      await this.settled(page);
      await page.evaluate((refuse: string) => {
        const re = new RegExp(refuse, 'i');
        const button = [...document.querySelectorAll('button, a')].find((el) => re.test(el.textContent ?? ''));
        (button as HTMLElement | undefined)?.click();
        document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
      }, REFUSE_COOKIES.source);
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 600));

      const text = await page.evaluate(() => {
        // Visible text plus text in closed tabs (shoppers can open them), without scripts.
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script, style, noscript, template, svg').forEach((el) => el.remove());
        return `${document.body.innerText}\n${clone.textContent ?? ''}`;
      });
      return { html: await page.content(), text };
    } catch (err) {
      return this.failed(reasonOf(err));
    } finally {
      await page?.close().catch(() => {});
      this.release();
    }
  }

  async close(): Promise<void> {
    const browser = await this.browser?.catch(() => undefined);
    this.browser = undefined;
    await browser?.close().catch(() => {});
    await this.proxy?.close();
    this.proxy = undefined;
  }

  /**
   * Themes fill prices and tabs right after load. Waits until the visible text has not changed for a second, or the network
   * is quiet – five seconds at most. A quiet network alone never comes on a page with trackers, and what such pages add
   * after the first seconds are newsletter boxes, cookie banners and recommendations, not the product's own text.
   */
  private async settled(page: Page): Promise<void> {
    const quietText = page
      .evaluate(
        () =>
          new Promise<void>((done) => {
            let last = -1;
            let same = 0;
            const finish = () => {
              clearInterval(timer);
              done();
            };
            const timer = setInterval(() => {
              const size = document.body.innerText.length;
              same = size === last ? same + 1 : 0;
              last = size;
              if (same >= 4) finish();
            }, 250);
            setTimeout(finish, 5_000);
          }),
      )
      .catch(() => {});
    const quietNetwork = page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(() => {});
    await Promise.race([quietText, quietNetwork]);
  }

  private failed(reason: string): null {
    this.failures.set(reason, (this.failures.get(reason) ?? 0) + 1);
    return null;
  }

  private getBrowser(): Promise<Browser> {
    this.browser ??= this.launch();
    return this.browser;
  }

  private async launch(): Promise<Browser> {
    const proxy = await startEgressProxy({ allowPrivate: this.opts.allowPrivate });
    this.proxy = proxy;
    this.refusedDestinations = proxy.refused;
    try {
      return await puppeteer.launch({
        executablePath: this.opts.executablePath,
        headless: true,
        // Puppeteer waits three minutes for an answer by default; a page stuck in its own script then holds a tab that long.
        protocolTimeout: this.opts.protocolTimeoutMs ?? 30_000,
        args: [
          '--no-first-run',
          '--disable-dev-shm-usage',
          '--mute-audio',
          `--proxy-server=${proxy.url}`,
          // Chromium connects to loopback and link-local addresses directly unless told otherwise.
          '--proxy-bypass-list=<-loopback>',
          // QUIC and WebRTC send UDP, which an http proxy does not carry. Chrome 154 obeys `--webrtc-ip-handling-policy` and
          // ignores the `--force-…` spelling (measured: a page's STUN request reached a local UDP socket with it alone);
          // both are passed in case another build reads the other one.
          '--disable-quic',
          '--webrtc-ip-handling-policy=disable_non_proxied_udp',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ],
      });
    } catch (err) {
      await proxy.close();
      this.proxy = undefined;
      throw err;
    }
  }

  private async route(req: HTTPRequest): Promise<void> {
    if (req.isInterceptResolutionHandled()) return;
    if (SKIPPED_RESOURCES.has(req.resourceType())) return req.abort().catch(() => {});
    const url = req.url();
    const ok = url.startsWith('data:') || url.startsWith('blob:') || (await this.isAllowed(url));
    if (req.isInterceptResolutionHandled()) return;
    return (ok ? req.continue() : req.abort('blockedbyclient')).catch(() => {});
  }

  private isAllowed(url: string): Promise<boolean> {
    if (this.opts.allowPrivate === true) return Promise.resolve(true);
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return Promise.resolve(false);
    }
    if (Array.isArray(this.opts.allowPrivate) && this.opts.allowPrivate.includes(host)) return Promise.resolve(true);
    let verdict = this.hostVerdicts.get(host);
    if (!verdict) {
      verdict = assertPublicUrl(url).then(
        () => true,
        () => false,
      );
      this.hostVerdicts.set(host, verdict);
    }
    return verdict;
  }

  private async politeSlot(host: string): Promise<void> {
    const gap = this.opts.minIntervalMs ?? 800;
    const now = Date.now();
    const start = Math.max(now, this.nextStart.get(host) ?? 0);
    this.nextStart.set(host, start + gap);
    if (start > now) await new Promise((r) => setTimeout(r, start - now));
  }

  private async acquire(): Promise<void> {
    if (this.active < (this.opts.concurrency ?? 3)) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}
