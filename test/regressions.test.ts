// Bugs found by scanning real shops (Sept 2026). Each test pins one of them.
import { describe, expect, it } from 'vitest';
import { unitPrice } from '../src/rules/pricing.js';
import { privacyPolicy, withdrawalNotice } from '../src/rules/shop.js';
import { htmlToText } from '../src/sources/html.js';
import { createFetcher } from '../src/sources/http.js';
import { loadLegalPage } from '../src/sources/shopify.js';
import type { ShopSnapshot } from '../src/types.js';
import { product } from './helpers.js';

function scriptedFetch(statuses: number[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? '<html><body>' + 'Widerrufsrecht '.repeat(10) + '</body></html>' : '', {
      status,
      headers: { 'content-type': 'text/html' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('real-shop regressions', () => {
  it('drops the doctype instead of showing "<!doctype html>" as page text', () => {
    expect(htmlToText('<!doctype html><html><head><title>Mode</title></head><body>Hallo</body></html>')).not.toContain('doctype');
  });

  it('retries after 429 and slows down instead of treating the page as missing', async () => {
    const { impl, calls } = scriptedFetch([429, 429, 200]);
    const waits: number[] = [];
    const fetcher = createFetcher({ allowPrivate: true, fetch: impl, sleep: async (ms) => void waits.push(ms) });
    const res = await fetcher.get('https://shop.test/pages/widerruf');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(waits.some((w) => w >= 1000)).toBe(true);
  });

  it('spaces requests to the same host', async () => {
    const { impl } = scriptedFetch([]);
    const waits: number[] = [];
    const fetcher = createFetcher({ allowPrivate: true, fetch: impl, sleep: async (ms) => void waits.push(ms), minIntervalMs: 300 });
    await Promise.all([fetcher.get('https://shop.test/a'), fetcher.get('https://shop.test/b'), fetcher.get('https://shop.test/c')]);
    expect(waits.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a linked legal page it could not load as unreachable, not missing', async () => {
    const { impl } = scriptedFetch([429, 429, 429, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
    const fetcher = createFetcher({ allowPrivate: true, fetch: impl, sleep: async () => {} });
    const spec = { kind: 'widerruf' as const, text: [/widerruf/i], href: /widerruf/i, fallback: '/policies/refund-policy' };
    const result = await loadLegalPage(fetcher, 'https://shop.test', [{ text: 'Widerruf', href: 'https://shop.test/pages/widerruf' }], spec);
    expect(result).toEqual({ unreachable: 'https://shop.test/pages/widerruf' });
  });

  it('treats a page as missing only when there is no link and the fallback is 404', async () => {
    const { impl } = scriptedFetch([404]);
    const fetcher = createFetcher({ allowPrivate: true, fetch: impl, sleep: async () => {} });
    const spec = { kind: 'widerruf' as const, text: [/widerruf/i], href: /widerruf/i, fallback: '/policies/refund-policy' };
    expect(await loadLegalPage(fetcher, 'https://shop.test', [], spec)).toBeNull();
  });

  it('does not claim a legal page is missing when it only failed to load', async () => {
    const shop: ShopSnapshot = {
      origin: 'https://shop.test',
      platform: 'shopify',
      products: [],
      pages: [{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Willkommen' }],
      homeLinks: [],
      truncated: false,
      unreachable: [
        { kind: 'widerruf', url: 'https://shop.test/pages/widerruf' },
        { kind: 'datenschutz', url: 'https://shop.test/pages/datenschutz' },
      ],
    };
    const noAsk = async () => {
      throw new Error('not used');
    };
    expect(await withdrawalNotice.check(shop, noAsk)).toEqual([]);
    expect(await privacyPolicy.check(shop, noAsk)).toEqual([]);
  });

  it('skips the Grundpreis check for free add-ons', () => {
    const gift = product({ title: 'Gratis: Serum mit Vitamin C (30ml)', variants: [{ title: '', price: 0, compareAtPrice: null }] });
    expect(unitPrice.prepare(gift)).toBeNull();
  });
});
