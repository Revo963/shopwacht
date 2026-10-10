import { describe, expect, it } from 'vitest';
import { impressum, odrLink, withdrawalButton } from '../src/rules/shop.js';
import { loadCsv } from '../src/sources/csv.js';
import { extractLinks, htmlToText } from '../src/sources/html.js';
import { isPrivateAddress, normalizeShopUrl } from '../src/sources/http.js';
import { findLegalLink, loadShopify, mapProduct } from '../src/sources/shopify.js';
import type { ShopSnapshot } from '../src/types.js';

describe('html', () => {
  it('turns markup into readable text and decodes entities', () => {
    const text = htmlToText('<h5>Details</h5><ul><li><strong>Preis:</strong> 86.53 &euro; / 1&nbsp;kg</li></ul><script>var x=1</script>');
    expect(text).toContain('Details');
    expect(text).toContain('86.53 € / 1 kg');
    expect(text).not.toContain('var x');
  });

  it('resolves relative links', () => {
    const links = extractLinks('<a href="/pages/impressum">Impressum</a><a href="mailto:a@b.de">Mail</a>', 'https://shop.de/');
    expect(links).toEqual([{ text: 'Impressum', href: 'https://shop.de/pages/impressum' }]);
  });
});

describe('shopify', () => {
  // A rate limit is neither platform detection nor end of pagination.
  it.each([1, 2])('reports HTTP 429 on product-feed page %s and asks to retry later', async (limitedPage) => {
    const loading = loadShopify('https://shop.test', { get: async (url) => ({
      url, status: url.includes(`page=${limitedPage}`) ? 429 : 200, contentType: 'application/json',
      body: url.includes('page=1') && limitedPage === 2
        ? JSON.stringify({ products: Array.from({ length: 250 }, (_, id) => ({ id, title: `Product ${id}` })) })
        : 'Too many requests',
    }) }, { maxProducts: 500 });
    await expect(loading).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/zu viele Anfragen.*später/i) });
  });

  it('still distinguishes a missing Shopify feed from rate limiting', async () => {
    await expect(loadShopify('https://shop.test', { get: async (url) => ({
      url, status: url.includes('products.json') ? 404 : 200, contentType: 'text/html', body: '<main>Shop</main>',
    }) }, { maxProducts: 5 })).rejects.toThrow('Kein Shopify-Shop erkannt');
  });

  // The feed may work while the homepage fails.
  it('records a failed homepage even when products and legal pages load', async () => {
    const snapshot = await loadShopify('https://shop.test', { get: async (url) => ({
      url, status: url.endsWith('/') ? 503 : 200, contentType: url.includes('products.json') ? 'application/json' : 'text/html',
      body: url.includes('products.json') ? '{"products":[]}' : `<main>${'Legal text. '.repeat(100)}</main>`,
    }) }, { maxProducts: 5 });
    expect(snapshot.unreachable).toContainEqual({ kind: 'home', url: 'https://shop.test/' });
    expect(snapshot.pages.some((p) => p.kind === 'home')).toBe(false);
  });

  // Shop35.com and shop21.com redirected to a US /
  // English storefront, so their German legal pages were never fetched and the scan said nothing about that.
  it.each([
    ['en', 'USD', { language: 'en', currency: 'USD' }],
    ['de', 'EUR', { language: 'de', currency: 'EUR' }],
  ])('records the storefront language and currency of the homepage (%s, %s)', async (lang, currency, expected) => {
    const home = `<html class="no-js" lang="${lang}"><head><script>Shopify.currency = {"active":"${currency}","rate":"1.0"};</script></head><body>Willkommen</body></html>`;
    const snapshot = await loadShopify('https://shop.test', { get: async (url) => ({
      url, status: 200, contentType: url.includes('products.json') ? 'application/json' : 'text/html',
      body: url.includes('products.json') ? '{"products":[]}' : url.endsWith('/') ? home : '<main>x</main>',
    }) }, { maxProducts: 5 });
    expect(snapshot.storefront).toEqual(expected);
  });

  it('leaves the storefront unset when the homepage says nothing about it', async () => {
    const snapshot = await loadShopify('https://shop.test', { get: async (url) => ({
      url, status: 200, contentType: url.includes('products.json') ? 'application/json' : 'text/html',
      body: url.includes('products.json') ? '{"products":[]}' : '<main>x</main>',
    }) }, { maxProducts: 5 });
    expect(snapshot.storefront).toBeUndefined();
  });

  it('maps the public products.json format', () => {
    const p = mapProduct(
      {
        id: 1,
        title: 'Wiesn Hendl',
        handle: 'wiesn-hendl',
        body_html: '<p>Würzig &amp; lecker</p>',
        product_type: 'Gewürz',
        tags: ['grillen', 'bulk_discount_2:9.9'],
        variants: [{ title: '75g im Korkenglas', price: '6.49', compare_at_price: '6.49' }],
      },
      'https://www.shop34.de',
    );
    expect(p).toMatchObject({
      id: '1',
      url: 'https://www.shop34.de/products/wiesn-hendl',
      text: 'Würzig & lecker',
      tags: ['grillen'],
      variants: [{ title: '75g im Korkenglas', price: 6.49, compareAtPrice: 6.49 }],
    });
  });

  it('prefers own-site legal links by link text', () => {
    const links = [
      { text: 'Impressum', href: 'https://other.de/impressum' },
      { text: 'Rechtliches', href: 'https://www.shop.de/pages/impressum' },
      { text: 'Impressum', href: 'https://shop.de/pages/imprint' },
    ];
    const spec = { kind: 'impressum' as const, text: [/impressum/i], href: /impressum/i, fallback: '/policies/legal-notice' };
    expect(findLegalLink(links, spec, 'https://shop.de')).toBe('https://shop.de/pages/imprint');
  });
});

describe('csv', () => {
  it('reads a Shopify product export with variants and unit prices', () => {
    const csv = [
      'Handle,Title,Body (HTML),Type,Tags,Option1 Value,Variant Price,Variant Compare At Price,Unit Price Total Measure',
      'kaffee,Espresso,<p>Kräftig</p>,Kaffee,"bio, fair",250 g,8.90,,250',
      'kaffee,,,,,1 kg,29.90,34.90,',
    ].join('\n');
    const snap = loadCsv(csv, 'export.csv', 100);
    expect(snap.products).toHaveLength(1);
    expect(snap.products[0]).toMatchObject({
      title: 'Espresso',
      text: 'Kräftig',
      tags: ['bio', 'fair'],
      variants: [
        { title: '250 g', price: 8.9, compareAtPrice: null, hasUnitPrice: true },
        { title: '1 kg', price: 29.9, compareAtPrice: 34.9, hasUnitPrice: false },
      ],
    });
  });

  it('reads a German WooCommerce export with semicolons and sale prices', () => {
    const csv = [
      'ID;Name;Beschreibung;Regulärer Preis;Angebotspreis;Kategorien',
      '17;Shampoo 250 ml;"Mild, <b>nachhaltig</b>";12,99;9,99;Pflege',
      '18;Duschgel;Frisch;5,49;;Pflege',
    ].join('\n');
    const snap = loadCsv(csv, 'woo.csv', 100);
    expect(snap.products.map((p) => [p.id, p.title, p.variants[0]])).toEqual([
      ['17', 'Shampoo 250 ml', { title: '', price: 9.99, compareAtPrice: 12.99 }],
      ['18', 'Duschgel', { title: '', price: 5.49, compareAtPrice: null }],
    ]);
    expect(snap.products[0]!.text).toBe('Mild, nachhaltig');
  });

  it('explains what is missing when no title column exists', () => {
    expect(() => loadCsv('foo,bar\n1,2', 'x.csv', 10)).toThrow(/Produktnamen/);
  });
});

describe('url safety', () => {
  it('normalises what people type', () => {
    expect(normalizeShopUrl('shop.de/collections/all')).toBe('https://shop.de');
    expect(normalizeShopUrl(' https://www.shop.de ')).toBe('https://www.shop.de');
    expect(() => normalizeShopUrl('hallo')).toThrow();
  });

  it('recognises private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('23.227.38.65')).toBe(false);
  });
});

describe('shop rules', () => {
  const base = (pages: ShopSnapshot['pages'], homeLinks: ShopSnapshot['homeLinks'] = []): ShopSnapshot => ({
    origin: 'https://shop.de',
    platform: 'shopify',
    products: [],
    pages: [{ kind: 'home', url: 'https://shop.de/', html: '', text: 'Willkommen' }, ...pages],
    homeLinks,
    truncated: false,
    unreachable: [],
  });
  const noAsk = async () => {
    throw new Error('not used');
  };

  it('lists missing Impressum details', async () => {
    const shop = base([{ kind: 'impressum', url: 'https://shop.de/impressum', html: '', text: 'Muster GmbH\nHauptstraße 1\n10115 Berlin' }]);
    const notes = (await impressum.check(shop, noAsk)).map((f) => f.note);
    expect(notes).toEqual([
      'Keine E-Mail-Adresse gefunden.',
      'Gesellschaft erkannt, aber kein Registergericht / keine Registernummer gefunden.',
      'Gesellschaft erkannt, aber kein Vertretungsberechtigter (z. B. Geschäftsführer) gefunden.',
      'Gesellschaft erkannt, aber keine Umsatzsteuer-Identifikationsnummer gefunden (Pflichtangabe, sofern vorhanden).',
    ]);
  });

  it('accepts a complete Impressum', async () => {
    const text = 'Muster GmbH, Hauptstraße 1, 10115 Berlin. Geschäftsführer: Max Muster. E-Mail: info@muster.de. Registergericht: Amtsgericht Berlin, HRB 12345. USt-IdNr.: DE123456789';
    const shop = base([{ kind: 'impressum', url: 'https://shop.de/impressum', html: '', text }]);
    expect(await impressum.check(shop, noAsk)).toEqual([]);
  });

  it('reports the dead ODR link once for the whole shop', async () => {
    const footer = 'Plattform zur Online-Streitbeilegung: https://ec.europa.eu/consumers/odr';
    const shop = base([
      { kind: 'impressum', url: 'https://shop.de/impressum', html: '', text: footer },
      { kind: 'agb', url: 'https://shop.de/agb', html: '', text: footer },
    ]);
    const findings = await odrLink.check(shop, noAsk);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.note).toBe('Gefunden auf: Impressum, AGB');
  });

  it('finds a "Vertrag widerrufen" link in the footer', async () => {
    expect(await withdrawalButton.check(base([], [{ text: 'Vertrag widerrufen', href: 'https://shop.de/pages/widerruf' }]), noAsk)).toEqual([]);
    expect(await withdrawalButton.check(base([]), noAsk)).toHaveLength(1);
  });
});
