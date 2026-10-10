import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from '../config.js';
import type { DecisionProvider } from '../decisions/types.js';
import { reportToCsv } from '../report/export.js';
import { recordFeedback } from '../report/feedback.js';
import { getJob, startJob } from '../scan/jobs.js';
import type { SecondJudge } from '../scan/second-judge.js';
import { loaderFor, scannerWith, type Target } from '../scan/service.js';
import { normalizeShopUrl, type Fetcher } from '../sources/http.js';
import { looksLikeKey } from './api-key.js';
import { LandingPage } from './views/landing.js';
import { ErrorPage, formatCount, NotFoundPage, ProgressPage, progressView } from './views/progress.js';
import { ReportPage } from './views/report.js';

/** What judges a scan. Replaced as a whole when the user saves a key. */
export interface Services {
  provider: DecisionProvider;
  judge?: SecondJudge;
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * Whether a POST comes from this app's own page. Browsers say so in Sec-Fetch-Site; Origin alone does not tell, because
 * these pages send "null" (Referrer-Policy: no-referrer). A client that sends neither is no browser.
 */
function fromThisPage(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = headers.get('origin');
  return origin === null || (URL.canParse(origin) && new URL(origin).host === headers.get('host'));
}

export function createApp(
  deps: Services & {
    fetcher: Fetcher;
    maxActiveScans?: number;
    feedbackFile?: string;
    /** Checks and stores a key entered on the start page, and answers with the services that use it. */
    setKey?: (key: string) => Promise<{ services: Services } | { error: string }>;
  },
) {
  const app = new Hono();
  let services: Services = { provider: deps.provider, judge: deps.judge };
  let running = 0;
  const formProps = () => ({ maxProducts: config.maxProducts, demo: services.provider.mode === 'demo', apiKey: deps.setKey ? {} : undefined });

  // The app serves the machine it runs on. It answers to a localhost address only, and it takes no form from another website:
  // a page open in the same browser could otherwise start scans, which cost the user's key.
  app.use('*', async (c, next) => {
    const host = c.req.header('host');
    if (host && !LOCAL_HOST.test(host)) return c.text('ShopWacht läuft nur auf diesem Rechner: http://localhost', 403);
    if (c.req.method === 'POST' && !fromThisPage(c.req.raw.headers)) return c.text('Anfrage abgelehnt.', 403);
    await next();
  });

  // Report addresses stay out of referrers and caches; pages run this app's own scripts only.
  app.use('*', async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    if (c.req.path === '/pruefen' || c.req.path.startsWith('/bericht/') || c.req.path.startsWith('/api/bericht/')) c.header('Cache-Control', 'no-store');
  });

  app.use('/static/*', serveStatic({ root: './src/server' }));

  app.get('/', (c) => c.html(<LandingPage {...formProps()} />));

  app.post('/pruefen', async (c) => {
    const url = ((await readSmallForm(c.req.raw, 8192))?.get('url') ?? '').trim();
    const fail = (error: string, status: 400 | 429 = 400) => c.html(<LandingPage {...formProps()} url={url} error={error} />, status);
    if (!url) return fail('Bitte eine Shop-Adresse eingeben.');
    let target: Target;
    try {
      target = { kind: 'url', url: normalizeShopUrl(url) };
    } catch (err) {
      return fail((err as Error).message);
    }
    if (running >= (deps.maxActiveScans ?? config.maxActiveScans)) return fail('Es läuft bereits eine Prüfung. Bitte warten, bis sie fertig ist.', 429);
    running++;
    const id = startJob(
      target.url,
      loaderFor(target, deps.fetcher, config.maxProducts),
      scannerWith(services.provider, deps.fetcher, undefined, undefined, { judge: services.judge }),
      () => running--,
    );
    return c.redirect(`/bericht/${id}`, 303);
  });

  app.post('/schluessel', async (c) => {
    const setKey = deps.setKey;
    if (!setKey) return c.html(<NotFoundPage />, 404);
    const key = ((await readSmallForm(c.req.raw, 1024))?.get('key') ?? '').trim();
    const failed = (error: string) => c.html(<LandingPage {...formProps()} apiKey={{ error }} />, 400);
    if (!looksLikeKey(key)) return failed('Das sieht nicht nach einem OpenRouter-Schlüssel aus. Er beginnt mit „sk-or-“.');
    const result = await setKey(key);
    if ('error' in result) return failed(result.error);
    services = result.services;
    return c.html(<LandingPage {...formProps()} apiKey={{ saved: true }} />);
  });

  app.get('/bericht/:id', async (c) => {
    const job = await getJob(c.req.param('id'));
    if (!job) return c.html(<NotFoundPage />, 404);
    if (job.status === 'fertig') {
      const flagged = Number(c.req.query('gemeldet'));
      return c.html(<ReportPage report={job.report} flagged={Number.isInteger(flagged) ? flagged : undefined} />);
    }
    // The reason is the user's to act on: a refused key, no credit, a shop that cannot be reached.
    if (job.status === 'fehler') return c.html(<ErrorPage target={job.target} error={job.error} {...formProps()} />);
    return c.html(<ProgressPage id={c.req.param('id')} state={job} />);
  });

  app.get('/api/bericht/:id', async (c) => {
    const job = await getJob(c.req.param('id'));
    if (!job) return c.json({ status: 'unbekannt' }, 404);
    if (job.status === 'laden' || job.status === 'pruefen') {
      const view = progressView(job);
      return c.json({ status: job.status, phase: view.phase, count: formatCount(view), ratio: view.total ? view.done / view.total : null });
    }
    return c.json({ status: job.status });
  });

  // "Fehlalarm melden": works as a plain form post, and as fetch() from app.js.
  app.post('/bericht/:id/feedback', async (c) => {
    const id = c.req.param('id');
    const wantsJson = (c.req.header('accept') ?? '').includes('application/json');
    const job = await getJob(id);
    if (job?.status !== 'fertig') return wantsJson ? c.json({ ok: false }, 404) : c.html(<NotFoundPage />, 404);
    const body = await readSmallForm(c.req.raw, 2048);
    if (!body) return c.text('Anfrage zu groß', 413);
    const rawIndex = body.get('index');
    const index = rawIndex && /^\d+$/.test(rawIndex) ? Number(rawIndex) : NaN;
    if (!Number.isInteger(index) || index >= job.report.findings.length) {
      return wantsJson ? c.json({ ok: false, error: 'Unbekannter Befund' }, 400) : c.text('Unbekannter Befund', 400);
    }
    await recordFeedback(job.report, index, body.get('comment') ?? undefined, deps.feedbackFile);
    return wantsJson ? c.json({ ok: true }) : c.redirect(`/bericht/${id}?gemeldet=${index}#f-${index}`, 303);
  });

  app.get('/bericht/:id/export.csv', async (c) => {
    const job = await getJob(c.req.param('id'));
    if (job?.status !== 'fertig') return c.text('Bericht nicht gefunden', 404);
    const name = job.report.origin.replace(/^CSV: /, '').replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_');
    return c.body(reportToCsv(job.report), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="shopwacht-${name}.csv"`,
    });
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.notFound((c) => c.html(<NotFoundPage />, 404));

  return app;
}

/** A form's fields, or null when the body is larger than a form of this app can be. */
async function readSmallForm(request: Request, maxBytes: number): Promise<URLSearchParams | null> {
  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new URLSearchParams(new TextDecoder().decode(Buffer.concat(chunks)));
}
