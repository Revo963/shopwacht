import { config } from '../config.js';
import type { DecisionProvider } from '../decisions/types.js';
import type { PageView } from '../rules/types.js';
import { BrowserPageLoader, findChrome, type RenderedPage } from '../sources/browser.js';
import { loadCsv } from '../sources/csv.js';
import { decodeEntities, htmlToText, mainText } from '../sources/html.js';
import type { Fetcher } from '../sources/http.js';
import { loadShopify, UnsupportedShopifyFeed } from '../sources/shopify.js';
import { loadWooCommerce } from '../sources/woocommerce.js';
import type { ScanReport, ShopSnapshot } from '../types.js';
import { runScan, type Progress } from './engine.js';
import { runSecondJudge, type SecondJudge, type SecondJudgeRun } from './second-judge.js';

export type Target = { kind: 'url'; url: string } | { kind: 'csv'; name: string; content: string };

export function loaderFor(target: Target, fetcher: Fetcher, maxProducts: number) {
  // Only a missing Shopify feed triggers the WooCommerce Store API path.
  return async (onLoaded: (n: number) => void): Promise<ShopSnapshot> => {
    if (target.kind === 'csv') return loadCsv(target.content, target.name, maxProducts);
    try {
      return await loadShopify(target.url, fetcher, { maxProducts, onProgress: onLoaded });
    } catch (error) {
      if (!(error instanceof UnsupportedShopifyFeed)) throw error;
      return loadWooCommerce(target.url, fetcher, { maxProducts, onProgress: onLoaded });
    }
  };
}

/** "browser" when Chrome is available (or required), otherwise plain HTML. */
export function pageCheckMode(): 'browser' | 'static' {
  if (config.pageCheck === 'static') return 'static';
  const chrome = findChrome();
  if (!chrome && config.pageCheck === 'browser') {
    throw new Error('PAGE_CHECK=browser, aber kein Chrome/Chromium gefunden. CHROME_PATH in der .env setzen.');
  }
  return chrome ? 'browser' : 'static';
}

/** What the page check needs from a browser. The test bench passes a cached one. */
export interface PageRenderer {
  load(url: string): Promise<RenderedPage | null>;
  close(): Promise<void>;
  /** Why loads came back empty, by reason (the browser loader counts them). */
  readonly failures?: ReadonlyMap<string, number>;
}

// Opt-in detailed traces travel through the production scan path.
// An optional second model adds its view to uncertain health findings afterwards.
// An optional two-model second opinion may drop, downgrade and add findings before that.
export function scannerWith(
  provider: DecisionProvider,
  fetcher: Fetcher,
  signal?: AbortSignal,
  renderer?: PageRenderer,
  // `judgeFacts` – recorded page excerpts for the second opinion (the bench only).
  diagnostics: { trace?: boolean; judge?: SecondJudge; judgeFacts?: SecondJudgeRun['facts'] } = {},
) {
  return async (id: string, shop: ShopSnapshot, onProgress: (p: Progress) => void): Promise<ScanReport> => {
    const mode = renderer ? 'browser' : pageCheckMode();
    const browser: PageRenderer | undefined = renderer ?? (mode === 'browser' ? new BrowserPageLoader({ executablePath: findChrome()!, concurrency: config.pageConcurrency }) : undefined);
    // With the second opinion on, rendered pages keep their text for its page excerpts.
    const pagesSeen = browser && diagnostics.judge ? keepingTexts(browser) : undefined;
    const pageRenderer = pagesSeen ?? browser;
    // Description recovery and verification share one static fetch.
    const pages = new Map<string, Promise<PageView | null>>();
    try {
      const report = await runScan(id, shop, {
        provider,
        riskThreshold: config.riskThreshold,
        reviewThreshold: config.reviewThreshold,
        concurrency: config.concurrency,
        // One page more in check than tabs, so a tab never waits for a static fetch (as before: four pages, three tabs).
        pageConcurrency: config.pageConcurrency + 1,
        signal,
        onProgress,
        trace: diagnostics.trace,
        loadPage: async (url, { productData }) => {
          if (!pages.has(url)) pages.set(url, staticPage(fetcher, url));
          const page = await pages.get(url)!;
          if (page && productData && shop.platform === 'shopify') return { ...page, variants: await shopifyUnitPrices(fetcher, url) };
          return page;
        },
        renderPage: pageRenderer ? (url) => rendered(pageRenderer, url) : undefined,
      });
      // The scan's own renders only – the second opinion renders more below.
      if (report.coverage && browser?.failures?.size) report.coverage.browserLoads.reasons = Object.fromEntries(browser.failures);
      if (diagnostics.judge && report.mode === 'jev') {
        await runSecondJudge(report, shop, diagnostics.judge, {
          pageText: pagesSeen?.text,
          facts: diagnostics.judgeFacts,
          concurrency: config.concurrency,
          signal,
          onProgress: (done, total) => onProgress({ phase: 'zweite-pruefung', done, total }),
        });
      }
      return { ...report, pageCheck: mode };
    } finally {
      await browser?.close();
    }
  };
}

/** Remembers each rendered page's text (not its HTML), so none is rendered twice. */
function keepingTexts(browser: PageRenderer): PageRenderer & { text(url: string): Promise<string | null> } {
  const texts = new Map<string, Promise<string | null>>();
  const load = (url: string) => {
    const page = browser.load(url);
    texts.set(url, page.then((p) => p?.text ?? null, () => null));
    return page;
  };
  return { load, close: () => browser.close(), text: (url) => texts.get(url) ?? load(url).then((p) => p?.text ?? null, () => null) };
}

async function rendered(browser: PageRenderer, url: string): Promise<PageView | null> {
  const page = await browser.load(url);
  // Use the same product scope after JavaScript has run.
  return page ? { html: decodeEntities(page.html), text: page.text, productText: mainText(page.html, 'product'), rendered: true } : null;
}

async function staticPage(fetcher: Fetcher, url: string): Promise<PageView | null> {
  const res = await fetcher.get(url);
  if (res.status >= 400) return null;
  // Keep scoped description text separate from whole-page verification.
  return { html: decodeEntities(res.body), text: htmlToText(res.body), productText: mainText(res.body, 'product') };
}

/** Shopify's per-product JSON says whether a unit price is configured, even when the theme renders it with JavaScript. */
async function shopifyUnitPrices(fetcher: Fetcher, productUrl: string): Promise<PageView['variants']> {
  try {
    const res = await fetcher.get(`${productUrl.replace(/\/$/, '')}.js`, 'application/json');
    if (res.status >= 400) return undefined;
    const data = JSON.parse(res.body) as { variants?: { unit_price_measurement?: { measured_type?: string } | null }[] };
    // Shopify also offers a price per piece ("2 Stück | 3,99 € je
    // Stück"). For goods sold by weight or volume that is not the Grundpreis § 4 PAngV asks for.
    return data.variants?.map((v) => ({ unitPrice: v.unit_price_measurement != null && v.unit_price_measurement.measured_type !== 'count' }));
  } catch {
    return undefined;
  }
}
