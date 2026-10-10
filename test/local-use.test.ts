// ShopWacht runs on its user's own machine: reports stay, scans are not rationed, and a failed scan says why.
import { access, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../src/decisions/demo.js';
import { getJob, newJobId, REPORT_DIR, saveReport, setJob } from '../src/scan/jobs.js';
import { createApp } from '../src/server/app.js';
import type { Fetcher } from '../src/sources/http.js';
import type { ScanReport } from '../src/types.js';

const DAY = 24 * 60 * 60 * 1000;
const offline: Fetcher = {
  async get() {
    throw new Error('offline');
  },
};
// What the terminal scan printed for a key OpenRouter does not know (checked on 2026-10-10 with a made-up key).
const KEY_REFUSED = 'Der API-Schlüssel wurde abgelehnt. Bitte OPENROUTER_API_KEY in der .env prüfen. (Jev-Anfrage fehlgeschlagen (401): User not found.)';

const report = (): ScanReport => ({
  id: newJobId(), origin: 'https://shop.test', platform: 'shopify', createdAt: '2026-10-10T10:00:00Z', mode: 'jev', model: 'm', truncated: false,
  findings: [{ ruleId: 'green-generic', level: 'pruefen', confidence: 0.6, basis: 'modell', subject: { type: 'product', id: '1', title: 'Seife' }, evidence: ['Unsere Seife ist umweltfreundlich verpackt.'] }],
  stats: { products: 1, decisions: 1, inputTokens: 0, costUsd: 0, errors: 0, durationMs: 0 }, errors: [],
});
const stored = (id: string) => join(REPORT_DIR, `${id}.json`);
const scanForm = () => new URLSearchParams({ url: 'shop.test' });
const later = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a run on your own machine', () => {
  const app = createApp({ provider: new DemoProvider(), fetcher: offline });

  it('keeps a saved report: no expiry stamp, and still there a month later', async () => {
    const r = report();
    await saveReport(r);
    try {
      expect(JSON.parse(await readFile(stored(r.id), 'utf8'))).not.toHaveProperty('expiresAt');
      later(30 * DAY);
      expect((await app.request(`/bericht/${r.id}`)).status).toBe(200);
      await expect(access(stored(r.id))).resolves.toBeUndefined();
    } finally {
      await unlink(stored(r.id)).catch(() => {});
    }
  });

  it('keeps the report of a scan that finished in this process', async () => {
    const r = report();
    setJob(r.id, { status: 'fertig', target: r.origin, report: r });
    later(30 * DAY);
    expect((await getJob(r.id))?.status).toBe('fertig');
  });

  it('has no daily cap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const roomy = createApp({ provider: new DemoProvider(), fetcher: offline, maxActiveScans: 50 });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await roomy.request('/pruefen', { method: 'POST', body: scanForm() })).status);
    expect(statuses).toEqual(Array<number>(12).fill(303));
  });

  it('says that a scan is already running', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let stop: ((reason: Error) => void) | undefined;
    const waiting: Fetcher = { get: () => new Promise((_resolve, reject) => { stop = reject; }) };
    const one = createApp({ provider: new DemoProvider(), fetcher: waiting, maxActiveScans: 1 });
    expect((await one.request('/pruefen', { method: 'POST', body: scanForm() })).status).toBe(303);
    const second = await one.request('/pruefen', { method: 'POST', body: scanForm() });
    expect(second.status).toBe(429);
    expect(await second.text()).toContain('Es läuft bereits eine Prüfung');
    stop?.(new Error('offline'));
  });

  it('shows why a scan failed', async () => {
    const id = newJobId();
    setJob(id, { status: 'fehler', target: 'https://shop.test', error: KEY_REFUSED });
    const html = await (await app.request(`/bericht/${id}`)).text();
    expect(html).toContain('Der API-Schlüssel wurde abgelehnt. Bitte OPENROUTER_API_KEY in der .env prüfen.');
  });
});
