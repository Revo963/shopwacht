import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../src/decisions/demo.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportToCsv } from '../src/report/export.js';
import { readFeedback, recordFeedback } from '../src/report/feedback.js';
import { newJobId, saveReport } from '../src/scan/jobs.js';
import { createApp } from '../src/server/app.js';
import type { Fetcher } from '../src/sources/http.js';
import type { ScanReport } from '../src/types.js';

const offline: Fetcher = {
  async get() {
    throw new Error('offline');
  },
};

function report(): ScanReport {
  return {
    id: newJobId(),
    origin: 'https://www.shop.test',
    platform: 'shopify',
    createdAt: '2026-09-18T20:00:00.000Z',
    mode: 'jev',
    model: 'typesafe/jev-1.13',
    truncated: false,
    findings: [
      {
        ruleId: 'green-generic',
        level: 'risiko',
        confidence: 0.91,
        basis: 'modell',
        subject: { type: 'product', id: '1', title: 'Seife', url: 'https://www.shop.test/products/seife' },
        evidence: ['Unsere Seife ist umweltfreundlich verpackt.'],
      },
      {
        ruleId: 'unit-price',
        level: 'pruefen',
        confidence: 0.62,
        basis: 'modell',
        subject: { type: 'product', id: '2', title: '=HYPERLINK("x")' },
        evidence: [],
        note: 'Menge im Angebot: 500 g',
      },
    ],
    stats: { products: 2, decisions: 2, inputTokens: 400, costUsd: 0.0000168, errors: 0, durationMs: 900 },
    errors: [],
  };
}

describe('web app', () => {
  // Current product name in temporary feedback paths.
  const app = createApp({ provider: new DemoProvider(), fetcher: offline, feedbackFile: join(tmpdir(), 'shopwacht-test-feedback.jsonl') });

  it('serves the landing page with the scan form and the rule catalogue', async () => {
    const res = await app.request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Shop prüfen');
    expect(html).toContain('Grundpreis fehlt');
    expect(html).toContain('Demo-Modus');
  });

  it('answers to a localhost address only', async () => {
    expect((await app.request('/', { headers: { Host: 'shopwacht.de' } })).status).toBe(403);
    expect((await app.request('/', { headers: { Host: '192.168.1.20:3000' } })).status).toBe(403);
    expect((await app.request('/', { headers: { Host: 'localhost:3000' } })).status).toBe(200);
    expect((await app.request('/', { headers: { Host: '127.0.0.1:3000' } })).status).toBe(200);
  });

  it('has no legal or contact pages: nobody but its user is served', async () => {
    for (const path of ['/impressum', '/datenschutz', '/kontakt']) expect((await app.request(path)).status).toBe(404);
    const html = await (await app.request('/')).text();
    expect(html).toContain('Keine Rechtsberatung.');
    expect(html).not.toMatch(/href="\/(?:impressum|datenschutz|kontakt)"/);
  });

  it('starts no scan for a form posted from another website', async () => {
    const form = new URLSearchParams({ url: 'shop.test' });
    const elsewhere: Record<string, string>[] = [{ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, { 'sec-fetch-site': 'same-site', origin: 'http://localhost:8080' }, { origin: 'https://evil.example' }];
    for (const headers of elsewhere) {
      expect((await app.request('/pruefen', { method: 'POST', body: form, headers })).status).toBe(403);
    }
    // What a browser sends for this app's own form.
    expect((await app.request('/pruefen', { method: 'POST', body: form, headers: { 'sec-fetch-site': 'same-origin', origin: 'null' } })).status).toBe(303);
  });

  it('rejects an empty submission with a message', async () => {
    const res = await app.request('/pruefen', { method: 'POST', body: new URLSearchParams() });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Bitte eine Shop-Adresse eingeben');
  });

  it('starts a scan and redirects to the report', async () => {
    const form = new URLSearchParams();
    form.set('url', 'shop.test');
    const res = await app.request('/pruefen', { method: 'POST', body: form });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/bericht\/[\w-]+$/);
  });

  it('takes a shop address only, not an uploaded file or an oversized form', async () => {
    const local = createApp({ provider: new DemoProvider(), fetcher: offline });
    expect(await (await local.request('/')).text()).not.toContain('name="csv"');
    const form = new FormData();
    form.set('csv', new File(['Produkt;Preis\nSeife;9,95'], 'katalog.csv', { type: 'text/csv' }));
    expect((await local.request('/pruefen', { method: 'POST', body: form })).status).toBe(400);
    const oversized = new URLSearchParams({ url: `shop.test/${'x'.repeat(9000)}` });
    expect((await local.request('/pruefen', { method: 'POST', body: oversized })).status).toBe(400);
  });

  it('allows one active scan and frees the slot when its load fails', async () => {
    let failLoad: ((reason: Error) => void) | undefined;
    const waiting: Fetcher = { get: () => new Promise((_resolve, reject) => { failLoad = reject; }) };
    const beta = createApp({ provider: new DemoProvider(), fetcher: waiting, maxActiveScans: 1 });
    const form = new URLSearchParams();
    form.set('url', 'shop26.de');
    expect((await beta.request('/pruefen', { method: 'POST', body: form })).status).toBe(303);
    expect((await beta.request('/pruefen', { method: 'POST', body: form })).status).toBe(429);
    failLoad?.(new Error('offline'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await beta.request('/pruefen', { method: 'POST', body: form })).status).toBe(303);
  });

  it('renders a saved report with highlighted evidence', async () => {
    const r = report();
    await saveReport(r);
    const html = await (await app.request(`/bericht/${r.id}`)).text();
    expect(html).toContain('shop.test');
    expect(html).toContain('<mark class="hit">umweltfreundlich</mark>');
    expect(html).toMatch(/Risiko<\/dt><dd>1<\/dd>/);
    expect(html).toContain('Modell <span class="finding__pct">91 %</span>');
  });

  // Report links and findings should not leak through referrers or caches.
  it('sets privacy and same-origin headers on public pages and report responses', async () => {
    const r = report();
    await saveReport(r);
    const home = await app.request('/');
    expect(home.headers.get('referrer-policy')).toBe('no-referrer');
    expect(home.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    for (const path of [`/bericht/${r.id}`, `/api/bericht/${r.id}`, `/bericht/${r.id}/export.csv`]) {
      const res = await app.request(path);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it('opens a report saved by an earlier version, without the note that version added', async () => {
    // Until 2026-10-10 a single model wrote a hint under uncertain health findings; saved reports still carry it.
    const r = report();
    const old = {
      ...r,
      findings: [...r.findings, { ruleId: 'health-claim', level: 'pruefen', confidence: 0.6, basis: 'modell', subject: { type: 'product', id: '3', title: 'Magnesium Kapseln' }, evidence: ['Magnesium für eine normale Muskelfunktion.'], review: { model: 'z-ai/glm-5.3-flash', violation: 'no', reason: 'Zugelassene Angabe im Wortlaut.' } }],
      secondOpinion: { model: 'z-ai/glm-5.3-flash', calls: 1, costUsd: 0.0007, errors: 0 },
    };
    await saveReport(old as ScanReport);
    const res = await app.request(`/bericht/${r.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Magnesium Kapseln');
    expect(html).not.toContain('Zweitmeinung');
    expect(html).not.toContain('Zugelassene Angabe im Wortlaut.');
  });

  it('exports CSV that Excel opens safely', async () => {
    const r = report();
    await saveReport(r);
    const res = await app.request(`/bericht/${r.id}/export.csv`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);
    expect(res.headers.get('content-type')).toContain('text/csv');
    // UTF-8 BOM, so German Excel reads umlauts correctly
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(reportToCsv(r).split('\r\n')[0]).toContain('Prüfpunkt;Schwere;Stufe');
  });

  it('says how long the user waited, the second opinion included', async () => {
    // The first scan with a real key on 2026-10-10: 47 s for the scan, then 157 s for the second opinion – the report said 47,1 s.
    const r = report();
    r.stats.durationMs = 47_069;
    await saveReport(r);
    expect(await (await app.request(`/bericht/${r.id}`)).text()).toContain('47,1 s');
    const judged = report();
    judged.stats.durationMs = 47_069;
    judged.secondJudge = {
      models: ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash'], requests: 16, costUsd: 0.02079, maxUsd: 0.3, durationMs: 157_211,
      products: 22, judged: 22, failed: 0, overCap: 0, withoutPage: 0, dropped: 0, downgraded: 0, added: 0, changes: [],
    };
    await saveReport(judged);
    const html = await (await app.request(`/bericht/${judged.id}`)).text();
    expect(html).toContain('3 min 24 s');
    expect(html).toContain('davon 2 min 37 s für die zweite Prüfung');
    expect(html).not.toContain('47,1 s');
  });

  // The report speaks of an AI-supported check, not of vendors and models.
  it('keeps vendor and model names out of the report and its export', async () => {
    const r = report();
    r.errors = ['OpenRouter request failed'];
    r.secondJudge = {
      models: ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash'], requests: 2, costUsd: 0.01, maxUsd: 0.1, durationMs: 1,
      products: 2, judged: 1, failed: 0, overCap: 1, withoutPage: 0, dropped: 0, downgraded: 0, added: 0, changes: [],
    };
    await saveReport(r);
    const page = await (await app.request(`/bericht/${r.id}`)).text();
    for (const output of [page, reportToCsv(r)]) expect(output).not.toMatch(/Jev|OpenRouter|TypeSafe|GLM|DeepSeek|typesafe\/|z-ai\//i);
    expect(page).not.toMatch(/Modellkosten|Modellabfragen|Schwellen|Kostengrenze/);
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
  });

  // Actionable remedy and copy snippets in HTML and CSV.
  it('renders actionable remedy advice and copy snippet in report HTML and CSV export', async () => {
    const r = report();
    r.findings.push({
      ruleId: 'strike-price',
      level: 'risiko',
      confidence: 0.98,
      basis: 'regel',
      subject: { type: 'product', id: '3', title: 'Sneaker', url: 'https://www.shop.test/products/sneaker' },
      evidence: ['120,00 € statt 150,00 €'],
      note: 'Streichpreis 150,00 € → 120,00 € ohne Angabe des niedrigsten 30-Tage-Preises.',
    });
    await saveReport(r);
    const html = await (await app.request(`/bericht/${r.id}`)).text();
    expect(html).toContain('Handlungsempfehlung');
    // A template to complete, never the crossed-out price as the 30-day low.
    expect(html).toContain('data-copy="Niedrigster Gesamtpreis der letzten 30 Tage vor der Preisermäßigung: [Betrag] €"');
    expect(html).not.toContain('30 Tage vor der Preisermäßigung: 150,00');
    expect(html).toContain('Mustertext kopieren');
    // Grundpreis guidance must work for Shopify and WooCommerce.
    expect(html).toContain('neben dem Gesamtpreis klar erkennbar und gut lesbar');
    expect(html).not.toContain('In Shopify an der Variante');

    const res = await app.request(`/bericht/${r.id}/export.csv`);
    const csv = new TextDecoder().decode(await res.arrayBuffer());
    expect(csv).toContain('nicht den gestrichenen Preis übernehmen');
    expect(csv).not.toContain('30 Tage: 150,00 €');
    expect(csv).toContain('neben dem Gesamtpreis klar erkennbar und gut lesbar');
  });

  // A report without findings may still have uncheckable products.
  it('shows incomplete coverage in the summary and affected rule row', async () => {
    const { runScan } = await import('../src/scan/engine.js');
    const { unitPrice } = await import('../src/rules/pricing.js');
    const { FakeProvider, product } = await import('./helpers.js');
    const r = await runScan(newJobId(), {
      origin: 'https://shop.test', platform: 'shopify', products: [product({ title: 'Kaffee 500 g', text: 'Kaffee', url: 'https://shop.test/coffee', variants: [{ title: '500 g', price: 9.95, compareAtPrice: null }] })],
      pages: [], homeLinks: [], unreachable: [], truncated: false,
    }, {
      provider: new FakeProvider({ sold_by_quantity: 0.95 }), productRules: [unitPrice], shopRules: [],
      riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      loadPage: async () => ({ html: '', text: '9,95 €' }),
      renderPage: async () => ({ html: '', text: 'Warenkorb', rendered: true }),
    });
    await saveReport(r);
    const html = await (await app.request(`/bericht/${r.id}`)).text();
    expect(html).toContain('1 von 1 Produkten nur eingeschränkt geprüft');
    expect(html).toMatch(/Grundpreis fehlt[\s\S]*?teilweise nicht prüfbar/);
    expect(html).toContain('Kein Befund bedeutet keine vollständige Entwarnung');
  });

  it('records a false-alarm report without personal data', async () => {
    const r = report();
    await saveReport(r);
    const file = join(tmpdir(), `feedback-${r.id}.jsonl`);
    const entry = await recordFeedback(r, 0, '  Das ist ein Farbname  ', file);
    expect(entry).toMatchObject({ reportId: r.id, index: 0, verdict: 'fehlalarm', comment: 'Das ist ein Farbname' });
    expect(entry.finding).toMatchObject({ ruleId: 'green-generic', subject: 'Seife', evidence: ['Unsere Seife ist umweltfreundlich verpackt.'] });
    expect(JSON.stringify(await readFeedback(file))).not.toMatch(/127\.0\.0\.1|x-forwarded/);
    await expect(recordFeedback(r, 9, undefined, file)).rejects.toThrow(RangeError);
  });

  it('accepts "Fehlalarm" clicks as form post and as fetch', async () => {
    const r = report();
    await saveReport(r);
    const form = new URLSearchParams();
    form.set('index', '1');
    const post = await app.request(`/bericht/${r.id}/feedback`, { method: 'POST', body: form });
    expect(post.status).toBe(303);
    expect(post.headers.get('location')).toBe(`/bericht/${r.id}?gemeldet=1#f-1`);
    expect(await (await app.request(`/bericht/${r.id}?gemeldet=1`)).text()).toContain('Gemeldet, danke');

    const json = await app.request(`/bericht/${r.id}/feedback`, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
    expect(await json.json()).toEqual({ ok: true });

    const bad = new URLSearchParams();
    bad.set('index', '99');
    expect((await app.request(`/bericht/${r.id}/feedback`, { method: 'POST', body: bad })).status).toBe(400);
  });

  it('stores no oversized or multipart feedback', async () => {
    const r = report();
    await saveReport(r);
    const tooLarge = new URLSearchParams({ index: '0', comment: 'x'.repeat(3000) });
    expect((await app.request(`/bericht/${r.id}/feedback`, { method: 'POST', body: tooLarge })).status).toBe(413);
    const multipart = new FormData();
    multipart.set('index', '0');
    expect((await app.request(`/bericht/${r.id}/feedback`, { method: 'POST', body: multipart })).status).toBe(400);
  });

  it('answers unknown reports with 404', async () => {
    expect((await app.request('/bericht/gibtesnicht')).status).toBe(404);
    expect((await app.request('/api/bericht/gibtesnicht')).status).toBe(404);
  });
});
