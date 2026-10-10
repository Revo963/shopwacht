// Public Store API records from shop1.de, captured in the adjacent fixture.
import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { remedyFor } from '../src/report/remedy.js';
import { ruleById } from '../src/rules/index.js';
import { loaderFor } from '../src/scan/service.js';
import { ScanForm } from '../src/server/views/landing.js';
import { ReportPage } from '../src/server/views/report.js';
import { createFetcher, type Fetcher } from '../src/sources/http.js';
import type { Finding, ScanReport } from '../src/types.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/woocommerce-store-product.json', import.meta.url), 'utf8')) as {
  simple: Record<string, unknown>;
  sale: Record<string, unknown>;
  variable: Record<string, unknown>;
  variations: Record<string, unknown>[];
};
const origin = 'https://shop1.de';
const home = '<html class="html" lang="de" prefix="og: https://ogp.me/ns#"><a href="https://shop1.de/datenschutzerklaerung/" target="_blank">Datenschutzerklärung</a>';

function shopFetcher(requests: string[], products = [fixture.simple, fixture.sale, fixture.variable]): Fetcher {
  return { get: async (url) => {
    requests.push(url);
    if (url === `${origin}/`) return { url, status: 200, contentType: 'text/html', body: home };
    if (url.includes('/products.json')) return { url, status: 404, contentType: 'text/html', body: 'Not found' };
    if (url.includes('/wp-json/wc/store/v1/products?')) {
      const query = new URL(url).searchParams;
      const body = query.get('type') === 'variation' ? fixture.variations : products;
      return { url, status: 200, contentType: 'application/json', body: JSON.stringify(body) };
    }
    return { url, status: 404, contentType: 'text/html', body: 'Not found' };
  } };
}

describe('WooCommerce URL source', () => {
  it('loads real public products and variations through the URL scan path', async () => {
    const requests: string[] = [];
    const shop = await loaderFor({ kind: 'url', url: origin }, shopFetcher(requests), 20)(() => undefined);
    expect(shop.platform).toBe('woocommerce');
    expect(shop.products).toHaveLength(3);
    expect(shop.storefront).toEqual({ language: 'de', currency: 'EUR' });
    expect(shop.products[0]).toMatchObject({
      id: '24294', title: 'Marías ORGANIC SUN Sonnencreme Face & Body LSF 50, 15 ml',
      url: 'https://shop1.de/produkt/marias-organic-sun-sonnencreme-face-body-lsf-50-15-ml/',
      variants: [{ price: 9.9, compareAtPrice: null }],
    });
    expect(shop.products[0]!.text).toContain('Vor dem Aufenthalt in der Sonne großzügig verteilen');
    expect(shop.products[1]!.variants).toEqual([{ title: '', price: 19, compareAtPrice: 22 }]);
    expect(shop.products[2]!.variants).toEqual([
      { title: 'Farbe: Dark Cacao', price: 26.5, compareAtPrice: null },
      { title: 'Farbe: Blackest', price: 26.5, compareAtPrice: null },
    ]);
    expect(requests.some((u) => u.includes('type=variation') && u.includes('parent=21761'))).toBe(true);
    expect(requests.some((u) => u.endsWith('.js'))).toBe(false);
  });

  // shop26.de repeated this switch_shop redirect on its non-Shopify feed.
  it('reaches the WooCommerce API when the first Shopify feed loops through switch_shop redirects', async () => {
    const requests: string[] = [];
    const fetcher = createFetcher({
      allowPrivate: true, minIntervalMs: 0, maxRetries: 0,
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('/products.json?')) {
          const location = url.includes('switch_shop=b2c') ? url : `${url}&switch_shop=b2c`;
          return new Response(null, { status: 302, headers: { location } });
        }
        if (url.includes('/wp-json/wc/store/v1/products?')) {
          return new Response(JSON.stringify([fixture.simple]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url === `${origin}/`) return new Response(home, { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response('Not found', { status: 404 });
      }) as typeof fetch,
    });

    const shop = await loaderFor({ kind: 'url', url: origin }, fetcher, 20)(() => undefined);
    expect(shop.platform).toBe('woocommerce');
    expect(shop.products[0]?.id).toBe('24294');
    expect(shop.products[0]?.text).toContain('Vor dem Aufenthalt in der Sonne großzügig verteilen');
    expect(requests.some((url) => url.includes('switch_shop=b2c'))).toBe(true);
  });

  it('keeps a Shopify rate limit as an error instead of falling back to WooCommerce', async () => {
    const requests: string[] = [];
    const fetcher: Fetcher = { get: async (url) => {
      requests.push(url);
      return { url, status: url.includes('products.json') ? 429 : 200, contentType: 'text/html', body: home };
    } };
    await expect(loaderFor({ kind: 'url', url: origin }, fetcher, 20)(() => undefined)).rejects.toMatchObject({ status: 429 });
    expect(requests.some((u) => u.includes('/wp-json/'))).toBe(false);
  });

  it('keeps a temporary Shopify server failure as an error instead of treating it as another platform', async () => {
    const requests: string[] = [];
    const fetcher: Fetcher = { get: async (url) => {
      requests.push(url);
      return { url, status: url.includes('products.json') ? 503 : 200, contentType: 'text/html', body: home };
    } };
    await expect(loaderFor({ kind: 'url', url: origin }, fetcher, 20)(() => undefined)).rejects.toMatchObject({ status: 503 });
    expect(requests.some((u) => u.includes('/wp-json/'))).toBe(false);
  });

  it('reports unavailable public catalogues with a CSV route', async () => {
    const fetcher: Fetcher = { get: async (url) => ({ url, status: url === `${origin}/` ? 200 : 404, contentType: 'text/html', body: home }) };
    await expect(loaderFor({ kind: 'url', url: origin }, fetcher, 20)(() => undefined)).rejects.toThrow(/CSV/);
  });

  it('does not send WooCommerce merchants to Shopify settings for a missing Grundpreis', () => {
    const rule = ruleById('unit-price');
    const finding: Finding = {
      ruleId: 'unit-price', level: 'pruefen', confidence: 0.6, basis: 'modell',
      subject: { type: 'product', id: String(fixture.simple.id), title: String(fixture.simple.name), url: String(fixture.simple.permalink) },
      evidence: [],
    };
    expect(rule?.fix).not.toMatch(/Shopify/i);
    expect(remedyFor(rule, finding).text).not.toMatch(/Shopify/i);
  });

  it('identifies a WooCommerce scan correctly in the report', () => {
    const report: ScanReport = {
      id: 'woo-public-fixture', origin, platform: 'woocommerce', createdAt: '2026-09-26T15:00:00+02:00',
      mode: 'demo', model: 'test', truncated: false, findings: [], errors: [],
      stats: { products: 3, decisions: 0, inputTokens: 0, costUsd: 0, errors: 0, durationMs: 0 },
    };
    const html = renderToString(ReportPage({ report }));
    expect(html).toContain('WooCommerce');
    expect(html).not.toContain('· Shopify');
  });

  it('offers WooCommerce URLs rather than requiring their CSV export', () => {
    const html = renderToString(ScanForm({ maxProducts: 250, demo: false }));
    expect(html).toMatch(/Shopify[^<]*WooCommerce[^<]*per Adresse/);
    expect(html).not.toContain('alle anderen per CSV-Export');
  });
});
