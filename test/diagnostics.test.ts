// Distinguish execution/coverage gaps from negative findings.
import { describe, expect, it } from 'vitest';
import { greenGeneric } from '../src/rules/claims.js';
import { unitPrice } from '../src/rules/pricing.js';
import { runScan } from '../src/scan/engine.js';
import { scannerWith, type PageRenderer } from '../src/scan/service.js';
import type { Product, ShopSnapshot } from '../src/types.js';
import { FakeProvider, product } from './helpers.js';

const options = { riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 2, shopRules: [], trace: true };
const shop = (products: Product[]): ShopSnapshot => ({ origin: 'https://shop.test', platform: 'shopify', products, pages: [], homeLinks: [], truncated: false, unreachable: [] });
const coffee = () => product({ title: 'Kaffee 500 g', text: 'Gerösteter Kaffee.', url: 'https://shop.test/coffee', variants: [{ title: '500 g', price: 9.95, compareAtPrice: null }] });

describe('scan diagnostics', () => {
  it('marks homepage claims incomplete when an older snapshot has no homepage record', async () => {
    const report = await runScan('home', shop([product({ title: 'Plain', text: 'Eine Seife.' })]), { ...options, productRules: [greenGeneric], provider: new FakeProvider() });
    expect(report.coverage?.incompleteRuleIds).toContain('green-generic');
    expect(report.errors.join(' ')).toContain('Startseite');
  });

  it('isolates preparation and judging errors without losing another rule result', async () => {
    const report = await runScan('isolate', shop([product({ title: 'Seife', text: 'Nachhaltig.' })]), {
      ...options, provider: new FakeProvider({ green_generic: 0.9 }), productRules: [
        { ...greenGeneric, id: 'broken-preparation', prepare: () => { throw new Error('preparation failed'); } },
        { ...greenGeneric, id: 'broken-judge', judge: () => { throw new Error('missing answer'); } },
        greenGeneric,
      ],
    });
    expect(report.checks!.map((c) => c.outcome)).toEqual(['preparation-error', 'decision-error', 'finding']);
    expect(report.findings.map((f) => f.ruleId)).toEqual(['green-generic']);
    expect(report.stats.errors).toBe(2);
  });

  it('identifies homepage text as page input and keeps it outside product counts', async () => {
    const snapshot = shop([]);
    snapshot.pages.push({ kind: 'home', url: 'https://shop.test', html: '', text: 'Nachhaltig.' });
    const report = await runScan('home-text', snapshot, { ...options, productRules: [greenGeneric], provider: new FakeProvider({ green_generic: 0.9 }) });
    expect(report.checks![0]).toMatchObject({ subjectType: 'page', input: 'page', outcome: 'finding' });
    expect(report.coverage).toMatchObject({ productRuleChecks: 0, productFindings: 0, riskShare: null });
  });

  it('separates preparation skips, low scores and decision failures without inventing a keyword cause', async () => {
    const report = await runScan('trace', shop([
      product({ title: 'plain', text: 'Eine Seife.' }),
      product({ title: 'low', text: 'Nachhaltig.' }),
      product({ title: 'broken', text: 'Nachhaltig.' }),
    ]), { ...options, productRules: [greenGeneric], provider: new FakeProvider({ green_generic: 0.2 }, (req) => JSON.stringify(req.state).includes('broken') ? new Error('model unavailable') : undefined) });
    expect(Object.fromEntries(report.checks!.map((c) => [c.subjectId, c.outcome]))).toEqual({ plain: 'not-triggered', low: 'below-threshold', broken: 'decision-error' });
    expect(report.checks!.find((c) => c.subjectId === 'low')).toMatchObject({ score: 0.2, reviewThreshold: 0.4, input: 'feed', questionKeys: ['green_generic'] });
    expect(report.coverage).toMatchObject({ productRuleChecks: 3, incompleteProducts: 1, outcomes: { 'not-triggered': 1, 'below-threshold': 1, 'decision-error': 1 } });
  });

  it('reports missing descriptions even with no URL or findings', async () => {
    const report = await runScan('empty', shop([product({ title: 'Plain' })]), { ...options, productRules: [greenGeneric], provider: new FakeProvider() });
    expect(report.findings).toEqual([]);
    expect(report.coverage).toMatchObject({ missingDescriptions: 1, recoveredDescriptions: 0, incompleteProducts: 1, incompleteRuleIds: ['green-generic'] });
    expect(report.checks![0]).toMatchObject({ input: 'metadata', incomplete: true });
  });

  it('records recovered input only for rules allowed to use page text', async () => {
    const report = await runScan('recover', shop([{ ...coffee(), text: '' }]), {
      ...options, productRules: [unitPrice, greenGeneric], provider: new FakeProvider({ sold_by_quantity: 0.95 }),
      loadPage: async () => ({ html: '', text: '9,95 € (19,90 €/kg)', productText: 'Nachhaltiger Kaffee.' }),
    });
    expect(report.checks!.find((c) => c.ruleId === 'unit-price')).toMatchObject({ input: 'page', outcome: 'page-dismissed', incomplete: false });
    expect(report.checks!.find((c) => c.ruleId === 'green-generic')).toMatchObject({ input: 'metadata', outcome: 'not-triggered', incomplete: true });
    expect(report.coverage).toMatchObject({ missingDescriptions: 1, recoveredDescriptions: 1, incompleteProducts: 1 });
  });

  it('keeps an unreadable rendered offer inconclusive instead of treating it as evidence of a unit price', async () => {
    const report = await runScan('offer', shop([coffee()]), {
      ...options, productRules: [unitPrice], provider: new FakeProvider({ sold_by_quantity: 0.95 }),
      loadPage: async () => ({ html: '', text: 'Kaffee 9,95 €' }),
      renderPage: async () => ({ html: '', text: 'Warenkorb Hilfe', rendered: true }),
    });
    expect(report.findings).toEqual([]);
    expect(report.checks![0]).toMatchObject({ outcome: 'page-inconclusive', page: 'rendered', incomplete: true });
    expect(report.coverage).toMatchObject({ incompleteProducts: 1, incompleteRuleIds: ['unit-price'] });
    expect(report.errors.join(' ')).toContain('nicht vollständig');
  });

  it('discloses failed rendering and caps the remaining static-only finding', async () => {
    const report = await runScan('browser', shop([coffee()]), {
      ...options, productRules: [unitPrice], provider: new FakeProvider({ sold_by_quantity: 0.95 }),
      loadPage: async () => ({ html: '', text: 'Kaffee 9,95 €' }), renderPage: async () => null,
    });
    expect(report.findings[0]).toMatchObject({ level: 'pruefen', note: expect.stringContaining('Browser') });
    expect(report.checks![0]).toMatchObject({ outcome: 'finding', page: 'render-failed', incomplete: true, level: 'pruefen' });
    expect(report.coverage?.browserLoads).toEqual({ attempted: 1, failed: 1 });
  });

  // shop30.de refused 20 of 30 renders with HTTP 429; the report said only "failed".
  it('says why rendering failed, as the browser loader counted it', async () => {
    const failures = new Map<string, number>();
    const renderer: PageRenderer = {
      failures,
      async load() {
        failures.set('HTTP 429', (failures.get('HTTP 429') ?? 0) + 1);
        return null;
      },
      async close() {},
    };
    const fetcher = { async get(url: string) { return { url, status: 200, contentType: 'text/html', body: '<main>Kaffee 9,95 €</main>' }; } };
    const report = await scannerWith(new FakeProvider({ sold_by_quantity: 0.95 }), fetcher, undefined, renderer)('reasons', shop([coffee()]), () => {});
    expect(report.findings).toMatchObject([{ ruleId: 'unit-price', level: 'pruefen' }]);
    expect(report.coverage?.browserLoads).toEqual({ attempted: 1, failed: 1, reasons: { 'HTTP 429': 1 } });
  });

  it('distinguishes confirmed page dismissal from an unavailable page', async () => {
    const provider = new FakeProvider({ sold_by_quantity: 0.95 });
    const good = await runScan('good', shop([coffee()]), { ...options, productRules: [unitPrice], provider, loadPage: async () => ({ html: '', text: '9,95 € (19,90 €/kg)' }) });
    const failed = await runScan('failed', shop([coffee()]), { ...options, productRules: [unitPrice], provider, loadPage: async () => { throw new Error('offline'); } });
    expect(good.checks![0]).toMatchObject({ outcome: 'page-dismissed', page: 'static', incomplete: false });
    expect(failed.checks![0]).toMatchObject({ outcome: 'finding', page: 'unavailable', incomplete: true });
    expect(failed.coverage?.pageLoads).toEqual({ attempted: 1, failed: 1 });
  });

  it('keeps full traces opt-in but reports coverage and the actual Risiko share', async () => {
    const report = await runScan('small', shop([product({ title: 'Seife', text: 'Nachhaltig.' })]), { ...options, trace: false, productRules: [greenGeneric], provider: new FakeProvider({ green_generic: 0.95 }) });
    expect(report.checks).toBeUndefined();
    expect(report.coverage).toMatchObject({ productFindings: 1, riskFindings: 0, riskShare: 0 });
  });
});
