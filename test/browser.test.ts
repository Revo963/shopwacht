// Needs a local Chrome/Chromium; skipped otherwise.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageShowsUnitPrice } from '../src/rules/pricing.js';
import { statesComposition } from '../src/rules/textile.js';
import { BrowserPageLoader, findChrome } from '../src/sources/browser.js';

const chrome = findChrome();

// A product page whose unit price is drawn by JavaScript and whose material sits in a closed <details>.
const PAGE = `<!doctype html><html><body>
  <h1>Hoodie</h1><p id="price">49,99 €</p><p id="unit"></p>
  <details><summary>Material &amp; Pflege</summary><p>80% Baumwolle, 20% Polyester</p></details>
  <script>setTimeout(() => { document.getElementById('unit').textContent = '99,98 € / 1 kg'; }, 300);</script>
</body></html>`;

describe.skipIf(!chrome)('browser page check', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      // A page the shop refuses, as shop30.de's Cloudflare did.
      if (req.url === '/products/busy') {
        res.writeHead(429, { 'content-type': 'text/html; charset=utf-8', 'cf-mitigated': 'challenge' });
        res.end('<!doctype html><title>Just a moment...</title>');
        return;
      }
      // A page whose trackers never let the network go quiet; its unit price is drawn after 300 ms.
      if (req.url === '/products/chatty') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body><h1>Kaffee</h1><p>9,99 €</p><p id="unit"></p><script>
          setTimeout(() => { document.getElementById('unit').textContent = '19,98 € / 1 kg'; }, 300);
          setInterval(() => fetch('/ping?' + Math.random()).catch(() => {}), 150);
        </script></body></html>`);
        return;
      }
      // A quiet page whose unit price arrives late, as from a slow shop app.
      if (req.url === '/products/late') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body><h1>Tee</h1><p>4,99 €</p><p id="unit"></p><script>
          setTimeout(() => { document.getElementById('unit').textContent = '49,90 € / 1 kg'; }, 1800);
        </script></body></html>`);
        return;
      }
      // A page that reports whether the browser drew it during its second second.
      if (req.url?.startsWith('/products/drawn')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html style="scroll-behavior: smooth"><body><h1>Saft</h1><p id="frames">not yet</p><div style="height: 5000px"></div><script>
          setTimeout(() => {
            let frames = 0;
            const tick = () => { frames++; requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            setTimeout(() => { document.getElementById('frames').textContent = frames > 0 ? 'frames drawn' : 'no frame drawn'; }, 1000);
          }, 700);
        </script></body></html>`);
        return;
      }
      // A page whose own script never lets go of its thread: the browser cannot be asked anything about it.
      if (req.url === '/products/stuck') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><h1>Saftkur</h1><script>setTimeout(() => { for (;;) {} }, 300);</script></body></html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sees content rendered by JavaScript and inside closed tabs', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: true, minIntervalMs: 0 });
    try {
      const page = await loader.load(`${base}/products/hoodie`);
      expect(page).not.toBeNull();
      expect(pageShowsUnitPrice(page!.text)).toBe(true);
      expect(statesComposition(page!.text)).toBe(true);
    } finally {
      await loader.close();
    }
  }, 60_000);

  it('refuses private addresses unless explicitly allowed', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, minIntervalMs: 0 });
    try {
      expect(await loader.load(`${base}/products/hoodie`)).toBeNull();
      expect(Object.fromEntries(loader.failures)).toEqual({ 'address refused': 1 });
    } finally {
      await loader.close();
    }
  }, 60_000);

  // Waiting for a quiet network cost five seconds on every page with trackers. On 95 real product pages of 19 shops the text
  // had stopped changing long before; what came later were newsletter boxes, cookie banners and "often bought together".
  it('reads a page once its text has stopped changing, without waiting for trackers to fall silent', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: true, minIntervalMs: 0 });
    try {
      await loader.load(`${base}/products/hoodie`);
      const started = Date.now();
      const chatty = await loader.load(`${base}/products/chatty`);
      expect(Date.now() - started).toBeLessThan(5_500);
      expect(pageShowsUnitPrice(chatty!.text)).toBe(true);
      // A price that arrives almost two seconds late is still read.
      expect(pageShowsUnitPrice((await loader.load(`${base}/products/late`))!.text)).toBe(true);
    } finally {
      await loader.close();
    }
  }, 60_000);

  // Three pages are checked at once. As tabs of one window only the front one is drawn; the others get no frames, their
  // smooth scrolling never finishes, and the scroll step waited for it – 7 to 17 s on a real shop, three minutes at worst.
  it('draws every page it has open, not only the one in front', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: true, minIntervalMs: 0, concurrency: 3 });
    try {
      const pages = await Promise.all([1, 2, 3].map((n) => loader.load(`${base}/products/drawn-${n}`)));
      expect(pages.map((p) => (p?.text.includes('frames drawn') ? 'drawn' : p?.text.includes('no frame drawn') ? 'not drawn' : 'unread'))).toEqual(['drawn', 'drawn', 'drawn']);
    } finally {
      await loader.close();
    }
  }, 60_000);

  // A real scan of 150 products lost twelve minutes of tab time to four such pages: each held its tab for three minutes.
  it('gives up on a page that stops answering, and loads the next one', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: true, minIntervalMs: 0, protocolTimeoutMs: 2_000 });
    try {
      const started = Date.now();
      expect(await loader.load(`${base}/products/stuck`)).toBeNull();
      expect(Date.now() - started).toBeLessThan(25_000);
      expect([...loader.failures.keys()].join()).toContain('timed out');
      expect(await loader.load(`${base}/products/hoodie`)).not.toBeNull();
    } finally {
      await loader.close();
    }
  }, 60_000);

  it('counts why a page came back empty', async () => {
    const loader = new BrowserPageLoader({ executablePath: chrome!, allowPrivate: true, minIntervalMs: 0 });
    try {
      expect(await loader.load(`${base}/products/busy`)).toBeNull();
      expect(await loader.load(`${base}/products/hoodie`)).not.toBeNull();
      expect(Object.fromEntries(loader.failures)).toEqual({ 'HTTP 429': 1 });
    } finally {
      await loader.close();
    }
  }, 60_000);
});
