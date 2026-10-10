// Regressions derived from third-audit input gaps.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { findQuantities, pageShowsUnitPrice, unitPrice } from '../src/rules/pricing.js';
import { textileFibre } from '../src/rules/textile.js';
import { runScan } from '../src/scan/engine.js';
import { scannerWith } from '../src/scan/service.js';
import { mainText } from '../src/sources/html.js';
import type { ShopSnapshot } from '../src/types.js';
import { FakeProvider, product } from './helpers.js';

describe('unit-price inputs from the third audit', () => {
  it.each([
    ['Probier Box Isoclear, 5 x 30g', '5 × 30 g', 'weight', 0.15],
    ['Saft 6×200 ml', '6 × 200 ml', 'volume', 1.2],
  ])('reads the total quantity of %s', (title, raw, dim, base) => {
    const quantities = findQuantities(product({ title }));
    expect(quantities).toHaveLength(1);
    expect(quantities[0]).toMatchObject({ raw, dim });
    expect(quantities[0]!.base).toBeCloseTo(base);
  });

  it('still excludes item dimensions from measured quantities', () => {
    expect(findQuantities(product({ title: 'Poster 30 x 40 cm' }))).toEqual([]);
    expect(findQuantities(product({ title: 'Teppich 2 × 3 m' }))).toEqual([]);
  });

  it('does not discard an explicitly measured sampler as a mixed-product set', () => {
    expect(unitPrice.prepare(product({
      title: 'Probier Box Isoclear, 5 x 30g',
      variants: [{ title: '', price: 12.9, compareAtPrice: 16.45 }],
    }))).not.toBeNull();
  });

  it('uses the total pack quantity when checking small-pack exemptions', () => {
    expect(findQuantities(product({ title: 'Gewürze 5 x 5 g' }))[0]?.base).toBeCloseTo(0.025);
    expect(unitPrice.prepare(product({ title: 'Gewürze 5 x 5 g' }))).not.toBeNull();
  });

  it('reports a review finding for a consumable identified only by its variant', async () => {
    const snapshot: ShopSnapshot = {
      origin: 'https://shop.test', platform: 'shopify', pages: [], homeLinks: [], unreachable: [], truncated: false,
      products: [product({
        title: 'Heart Support', text: 'Für Athleten.', url: 'https://shop.test/products/heart-support',
        variants: [{ title: '60 Kapseln', price: 29.9, compareAtPrice: null }],
      })],
    };
    const report = await runScan('variant-quantity', snapshot, {
      provider: new FakeProvider({ consumable_by_quantity: 0.95 }),
      riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [unitPrice], shopRules: [],
      loadPage: async () => ({ html: '', text: 'Heart Support 29,90 € · 60 Kapseln · 1 € / Portion' }),
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ ruleId: 'unit-price', level: 'pruefen', subject: { title: 'Heart Support' } });
  });
});

describe('unit-price attribution', () => {
  it('does not use a recommendation with the same total price', () => {
    const text = `Heart Support €29,90 · 60 Kapseln · 1 € / Portion ${'Produktinformationen '.repeat(10)} Wird oft zusammen gekauft Liver Support €29,90 €0,46/kg`;
    expect(pageShowsUnitPrice(text, [29.9])).toBe(false);
  });

  it('does not use a recommendation matching another variant price', () => {
    const text = `Heart Support €29,90 ${'Produktinformationen '.repeat(10)} Wird oft zusammen gekauft Liver Support €49,90 €0,46/kg`;
    expect(pageShowsUnitPrice(text, [49.9, 29.9])).toBe(false);
  });

  it('recognises the main product unit price before recommendations', () => {
    expect(pageShowsUnitPrice('Kaffee €29,90 €59,80/kg · Wird oft zusammen gekauft Filter €4,90', [29.9])).toBe(true);
  });

  it('allows a repeated main price after a sticky bar without a unit price', () => {
    const text = `Kaffee €29,90 Zum Warenkorb ${'Produktinformationen '.repeat(10)} Kaffee €29,90 €59,80/kg`;
    expect(pageShowsUnitPrice(text, [29.9])).toBe(true);
  });

  it('does not count recommendations immediately following the main price', () => {
    expect(pageShowsUnitPrice('Heart Support €29,90 Wird oft zusammen gekauft Liver Support €29,90 €0,46/kg', [29.9])).toBe(false);
  });
});

describe('empty feed descriptions', () => {
  const snapshot = (text = ''): ShopSnapshot => ({
    // A readable homepage keeps these tests focused on product recovery.
    origin: 'https://shop.test', platform: 'shopify', pages: [{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Willkommen' }], homeLinks: [], unreachable: [], truncated: false,
    products: [product({ title: 'Good Vibes', text, category: 'Bundles', url: 'https://shop.test/products/good-vibes' })],
  });

  it('uses scoped page text to classify an otherwise anonymous textile bundle', async () => {
    const provider = new FakeProvider({ is_textile: 0.95 });
    const shop = snapshot();
    const report = await runScan('empty-feed', shop, {
      provider, riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [textileFibre], shopRules: [],
      loadPage: async () => ({ html: '', text: 'Navigation und Good Vibes', productText: 'Good Vibes · 1x Soft-BH & 3x Brazilian Slips' }),
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ ruleId: 'textile-fibre', level: 'pruefen' });
    expect(provider.requests[0]?.state).toMatchObject({ beschreibung: 'Good Vibes · 1x Soft-BH & 3x Brazilian Slips' });
    expect(shop.products[0]!.text).toBe(''); // The source snapshot stays reusable.
  });

  it('retains a nonempty feed description instead of replacing it with page navigation', async () => {
    const report = await runScan('has-description', snapshot('Poster aus Papier.'), {
      provider: new FakeProvider({ is_textile: 0.95 }), riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [textileFibre], shopRules: [],
      loadPage: async () => { throw new Error('An unrelated page must not be loaded'); },
    });
    expect(report.findings).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it('reports the coverage gap if an empty description cannot be recovered', async () => {
    const report = await runScan('no-description', snapshot(), {
      provider: new FakeProvider(), riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [textileFibre], shopRules: [], loadPage: async () => null,
    });
    expect(report.findings).toEqual([]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('Good Vibes');
    expect(report.stats.errors).toBe(1);
  });

  it('recovers the description through the real scanner service and reuses its page for verification', async () => {
    const before = config.pageCheck;
    config.pageCheck = 'static';
    const requests: string[] = [];
    try {
      const scan = scannerWith(new FakeProvider({ is_textile: 0.95 }), {
        async get(url) {
          requests.push(url);
          return { url, status: 200, contentType: 'text/html', body: '<nav>Menü</nav><main><h1>Good Vibes</h1><p>1x Soft-BH &amp; 3x Brazilian Slips</p></main>' };
        },
      });
      const report = await scan('fallback-service', snapshot(), () => {});
      expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: 'textile-fibre', level: 'pruefen' }));
      expect(report.errors).toEqual([]);
      expect(requests).toEqual(['https://shop.test/products/good-vibes']);
    } finally {
      config.pageCheck = before;
    }
  });
});

describe('scoped product text using the existing HTML extractor', () => {
  it('keeps a short product main section without falling back to navigation', () => {
    expect(mainText('<nav>Nachhaltig</nav><main><nav>Menü</nav><h1>Good Vibes</h1><p>Soft-BH</p><script>bad()</script><product-recommendations>100% Baumwolle</product-recommendations></main><footer>Garantie</footer>', 'product')).toBe('Good Vibes\nSoft-BH');
  });

  it('does not turn a navigation-only page into a product description', () => {
    expect(mainText('<nav>BH und Slips</nav><footer>Unsere Garantie</footer>', 'product')).toBe('');
  });

  it('recognises a product section when a theme has no main element', () => {
    expect(mainText('<nav>Shirts</nav><div class="main-product"><h1>Heart Support</h1><p>60 Kapseln</p></div><footer>Garantie</footer>', 'product')).toBe('Heart Support\n60 Kapseln');
  });

  it('retains the product header inside main content', () => {
    expect(mainText('<header>Shop navigation</header><main><header><h1>Soft-BH</h1></header><p>Good Vibes</p></main>', 'product')).toBe('Soft-BH\nGood Vibes');
  });
});

describe('textile verification uses page text', () => {
  it('does not accept fibre data stored only in an HTML attribute', () => {
    const page = {
      html: '<main><h1>Good Vibes</h1><div data-product="{&quot;description&quot;:&quot;95% Baumwolle, 5% Elasthan&quot;}">Soft-BH und Slips</div></main>',
      text: 'Good Vibes · Soft-BH und Slips', productText: 'Good Vibes · Soft-BH und Slips',
    };
    expect(textileFibre.verifyOnPage!(page, product({ title: 'Good Vibes' }))).toBe(true);
  });

  it('does not borrow the composition of a recommendation outside the product section', () => {
    expect(textileFibre.verifyOnPage!({
      html: '', text: 'Soft-BH. Dazu empfohlen: Shirt 100% Baumwolle', productText: 'Soft-BH',
    }, product({ title: 'Soft-BH' }))).toBe(true);
  });

  it('accepts fibre text in a product details tab', () => {
    expect(textileFibre.verifyOnPage!({
      html: '<main><details><summary>Material</summary>95% Baumwolle, 5% Elasthan</details></main>',
      text: 'Material 95% Baumwolle, 5% Elasthan', productText: 'Material 95% Baumwolle, 5% Elasthan',
    }, product({ title: 'Soft-BH' }))).toBe(false);
  });
});
