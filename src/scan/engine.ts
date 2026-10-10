import { JevError } from '../decisions/jev.js';
import type { DecisionProvider, Question } from '../decisions/types.js';
import { buildCatalogue } from '../rules/catalogue.js';
import { PRODUCT_RULES, SHOP_RULES } from '../rules/index.js';
import { clip } from '../rules/text.js';
import { Answers, type Ask, type PageView, type Prepared, type ProductRule, type RuleContext, type ShopRule } from '../rules/types.js';
import type { Finding, Level, Product, RuleCheck, ScanReport, ShopSnapshot } from '../types.js';
import { citationFor, quotesFrom } from './cite.js';
import { summarizeCoverage } from './diagnostics.js';
import { pool } from './pool.js';

export interface Progress {
  // 'zweite-pruefung' – the two-model second opinion, per batch of products.
  phase: 'produkte' | 'seiten' | 'rechtstexte' | 'zweite-pruefung';
  done: number;
  total: number;
}

export interface EngineOptions {
  provider: DecisionProvider;
  riskThreshold: number;
  reviewThreshold: number;
  concurrency: number;
  /** Loads a live product page for "is it really missing?" checks. */
  loadPage?: (url: string, opts: { productData: boolean }) => Promise<PageView | null>;
  /** Optional second look in a real browser, for pages the HTML check still flags. */
  renderPage?: (url: string) => Promise<PageView | null>;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  productRules?: ProductRule[];
  shopRules?: ShopRule[];
  /** Include full rule traces for benchmark diagnosis. */
  trace?: boolean;
  /** Product pages checked at the same time (default 4). */
  pageConcurrency?: number;
}

interface Candidate {
  rule: ProductRule;
  product: Product;
  prep: Prepared;
  p: number;
  /** false = the check needed the live page but could not see it. */
  verified: boolean;
  /** Why an unverified finding stayed at "Prüfen", shown to the user. */
  unverifiedReason?: string;
  // The final verification outcome updates this trace.
  check: RuleCheck;
  /** The sentence(s) Jev picked as the claim. */
  quotes?: string[];
}

const HOME_ID = 'page:home';

export async function runScan(id: string, shop: ShopSnapshot, opts: EngineOptions): Promise<ScanReport> {
  const started = Date.now();
  const productRules = opts.productRules ?? PRODUCT_RULES;
  const shopRules = opts.shopRules ?? SHOP_RULES;
  const stats = { products: shop.products.length, decisions: 0, inputTokens: 0, costUsd: 0, errors: 0, durationMs: 0 };
  const errors: string[] = [];
  // No evidence of a finding is not evidence of a complete check.
  const checks: RuleCheck[] = [];
  const incompleteShopRules = new Set<string>();
  const coverageCounts = { recoveredDescriptions: 0, pageLoads: { attempted: 0, failed: 0 }, browserLoads: { attempted: 0, failed: 0 } };
  const load = async (url: string, productData: boolean) => {
    coverageCounts.pageLoads.attempted++;
    const page = await opts.loadPage!(url, { productData }).catch(() => null);
    if (!page) coverageCounts.pageLoads.failed++;
    return page;
  };
  const render = async (url: string) => {
    coverageCounts.browserLoads.attempted++;
    const page = await opts.renderPage!(url).catch(() => null);
    if (!page) coverageCounts.browserLoads.failed++;
    return page;
  };
  let model = opts.provider.model;
  const modelBasis = opts.provider.mode === 'demo' ? 'stichwort' : 'modell';

  const decide: Ask = async (state, questions, hints) => {
    const res = await opts.provider.decide({ state, questions, hints }, opts.signal);
    stats.decisions++;
    stats.inputTokens += res.inputTokens;
    stats.costUsd += res.costUsd;
    model = res.model;
    return new Answers(res.answers);
  };

  // 1. Ask Jev once per product, with every applicable rule's questions in one batch.
  const subjects = [...shop.products, ...homepageSubject(shop)];
  // The whole catalogue (or, on the bench, the one recorded at collection time),
  // so a multipack's crossed-out price can be checked against the product sold singly.
  const ruleContext = { catalogue: buildCatalogue(shop.catalogue ?? shop.products) };
  const candidates: Candidate[] = [];
  // 2. "Missing" checks: confirm on the live product page, which may show data the feed lacks.
  // A product's page check starts as soon as its answers are in, while Jev judges the
  // others – on shop4.de the page checks were 85 % of the scan and began only after the last answer. Same checks, same pages.
  // The page check gets the shop context too (free-gift values need the catalogue).
  const pageChecks = pageCheckQueue({ ...opts, loadPage: opts.loadPage ? (url, o) => load(url, o.productData) : undefined, renderPage: opts.renderPage ? render : undefined }, errors, ruleContext);
  let done = 0;
  await pool(
    subjects,
    opts.concurrency,
    async (product) => {
      const rules = product.id === HOME_ID ? productRules.filter((r) => r.alsoOnHomepage) : productRules;
      // The recovered page text only goes to rules that classify the product;
      // claim rules keep the feed text, or a shipping tab ("DHL gleicht Emissionen aus") becomes a product claim.
      let groups: [Product, ProductRule[]][] = [[product, rules]];
      const own: Candidate[] = [];
      // Some feeds omit descriptions even though the page has them.
      if (product.id !== HOME_ID && !product.text.trim() && product.url && opts.loadPage && rules.some((r) => r.readsPageText)) {
        const page = await load(product.url, false);
        if (page?.productText?.trim()) {
          coverageCounts.recoveredDescriptions++;
          const fromPage = { ...product, text: page.productText };
          groups = [
            [product, rules.filter((r) => !r.readsPageText)],
            [fromPage, rules.filter((r) => r.readsPageText)],
          ];
        } else {
          stats.errors++;
          errors.push(`${product.title}: Beschreibung im Export leer; Produkttext auf der Seite nicht lesbar – nur Titel und Metadaten geprüft.`);
        }
      }
      for (const [subject, subjectRules] of groups) {
        // Trace even rules that never reach the model.
        const prepared = subjectRules.flatMap((rule) => {
          const check: RuleCheck = {
            subjectId: product.id, subjectType: product.id === HOME_ID ? 'page' : 'product', ruleId: rule.id,
            input: subject !== product || product.id === HOME_ID ? 'page' : subject.text.trim() ? 'feed' : 'metadata', inputChars: subject.text.length,
            questionKeys: [], outcome: 'not-triggered', reviewThreshold: rule.reviewThreshold ?? opts.reviewThreshold,
            page: 'not-needed', incomplete: !subject.text.trim(),
          };
          checks.push(check);
          try {
            const prep = rule.prepare(subject, ruleContext);
            if (!prep) return [];
            check.questionKeys = Object.keys(prep.questions);
            check.outcome = 'decision-error';
            return [{ rule, prep, check }];
          } catch (err) {
            check.outcome = 'preparation-error';
            check.incomplete = true;
            stats.errors++;
            errors.push(`${product.title} (${rule.title}): ${(err as Error).message}`);
            return [];
          }
        });
        if (prepared.length === 0) continue;
        try {
          const questions = mergeQuestions(prepared.map((x) => x.prep.questions));
          const hints = Object.assign({}, ...prepared.map((x) => x.prep.hints));
          const passages = prepared.flatMap((x) => x.prep.evidence);
          const state = { ...productState(subject, passages), ...Object.assign({}, ...prepared.map((x) => x.prep.context)) };
          const answers = Object.keys(questions).length > 0 ? await decide(state, questions, hints) : new Answers({});
          const found: Candidate[] = [];
          for (const { rule, prep, check } of prepared) {
            try {
              const p = rule.judge(answers, subject);
              check.score = p;
              check.outcome = p >= check.reviewThreshold ? 'finding' : 'below-threshold';
              if (check.outcome === 'finding') found.push({ rule, product: subject, prep, p, verified: !rule.verifyOnPage, check });
            } catch (err) {
              check.incomplete = true;
              stats.errors++;
              errors.push(`${product.title} (${rule.title}): ${(err as Error).message}`);
            }
          }
          candidates.push(...found);
          own.push(...found);
          // For claim findings, a second request asks Jev which sentence makes the
          // claim. Only the quote depends on it; a failure keeps the keyword passages.
          const cites = found.flatMap((c) => {
            const cite = citationFor(c.rule, subject);
            return cite ? [{ c, cite }] : [];
          });
          if (cites.length > 0) {
            try {
              const chosen = await decide(state, Object.fromEntries(cites.map(({ cite }) => [cite.key, cite.question])), Object.fromEntries(cites.map(({ cite }) => [cite.key, cite.hint])));
              for (const { c, cite } of cites) c.quotes = quotesFrom(chosen, cite) ?? undefined;
            } catch (err) {
              // Rethrown as is – the product-level catch below turns
              // it into the message and only recognises the original error; fatalError() here downgraded a rejected key to one
              // product's error and the scan went on.
              if (isFatal(err)) throw err;
            }
          }
        } catch (err) {
          if (isFatal(err)) throw fatalError(err);
          for (const { check } of prepared) check.incomplete = true;
          stats.errors++;
          errors.push(`${product.title}: ${(err as Error).message}`);
        }
      }
      pageChecks.add(own);
      // The homepage is checked alongside but is not a product; keep the count honest.
      if (product.id !== HOME_ID) opts.onProgress?.({ phase: 'produkte', done: ++done, total: shop.products.length });
    },
    opts.signal,
  );

  const dropped = await pageChecks.finish();
  const kept = candidates.filter((c) => !dropped.has(c));

  // 3. Shop-wide checks on the legal pages.
  const PAGE_NAMES = { home: 'Startseite', impressum: 'Impressum', widerruf: 'Widerrufsbelehrung', datenschutz: 'Datenschutzerklärung', agb: 'AGB' };
  // Older snapshots did not record HTTP failures of the homepage.
  if (shop.platform !== 'csv' && !shop.pages.some((p) => p.kind === 'home') && (shopRules.length > 0 || productRules.some((r) => r.alsoOnHomepage))) {
    for (const rule of [...shopRules, ...productRules.filter((r) => r.alsoOnHomepage)]) incompleteShopRules.add(rule.id);
    if (!shop.unreachable.some((p) => p.kind === 'home')) errors.push('Startseite nicht verfügbar – Aussagen und Links dort konnten nicht geprüft werden.');
  }
  for (const u of shop.unreachable) {
    errors.push(`${PAGE_NAMES[u.kind]} konnte nicht geladen werden (${u.url}) – bitte selbst prüfen.`);
    for (const rule of shopRules) incompleteShopRules.add(rule.id);
  }
  // A domain can redirect to a US or English storefront (USD prices,
  // "Refund policy" instead of a Widerrufsbelehrung). Whether German law applies there is not visible from outside, so
  // its legal-page findings are shown as unverified rather than as verdicts.
  // The cap below was promised here but missing; homepage claims are included.
  const foreign = foreignStorefront(shop);
  if (foreign) {
    errors.push(`Die Startseite ist keine deutsche Storefront (${foreign}) – ob deutsches Recht für sie gilt und ob dort deutsche Rechtstexte hinterlegt sind, lässt sich von außen nicht beurteilen; die Prüfung der Rechtstexte ist unvollständig.`);
    for (const rule of shopRules) incompleteShopRules.add(rule.id);
  }
  const shopFindings: Finding[] = [];
  for (const [i, rule] of shopRules.entries()) {
    try {
      for (const f of await rule.check(shop, decide)) {
        if (f.confidence < opts.reviewThreshold) continue;
        shopFindings.push({
          ruleId: f.ruleId,
          level: levelFor(f.confidence, opts.riskThreshold, foreign ? 'pruefen' : (rule.maxLevel ?? f.level)),
          confidence: f.confidence,
          basis: f.basis === 'modell' ? modelBasis : 'regel',
          subject: { type: 'page', ...(f.page ?? { id: HOME_ID, title: 'Startseite', url: shopHome(shop) }) },
          evidence: f.evidence,
          note: f.note,
        });
      }
    } catch (err) {
      if (isFatal(err)) throw fatalError(err);
      incompleteShopRules.add(rule.id);
      stats.errors++;
      errors.push(`${rule.title}: ${(err as Error).message}`);
    }
    opts.onProgress?.({ phase: 'rechtstexte', done: i + 1, total: shopRules.length });
  }

  const productFindings: Finding[] = kept.map((c) => {
    // Record the actual emitted level, including rule and evidence caps.
    const level = levelFor(c.p, c.rule.riskThreshold ?? opts.riskThreshold, !c.verified || (foreign && c.product.id === HOME_ID) ? 'pruefen' : (c.prep.maxLevel ?? c.rule.maxLevel));
    c.check.level = level;
    return {
      ruleId: c.rule.id,
      level,
      confidence: round(c.p),
      basis: Object.keys(c.prep.questions).length > 0 ? modelBasis : 'regel',
      subject:
        c.product.id === HOME_ID
          ? { type: 'page', id: HOME_ID, title: 'Startseite', url: c.product.url }
          : { type: 'product', id: c.product.id, title: c.product.title, url: c.product.url },
      evidence: c.quotes ?? c.prep.evidence,
      ...(c.quotes ? { quoteBasis: 'modell' as const } : {}),
      note: [c.prep.note, c.unverifiedReason].filter(Boolean).join(' · ') || undefined,
    };
  });

  stats.durationMs = Date.now() - started;
  return {
    id,
    origin: shop.origin,
    platform: shop.platform,
    createdAt: new Date(started).toISOString(),
    mode: opts.provider.mode,
    model,
    truncated: shop.truncated,
    findings: sortFindings([...shopFindings, ...productFindings]),
    stats: { ...stats, costUsd: round(stats.costUsd, 6) },
    errors,
    coverage: summarizeCoverage(shop, checks, coverageCounts, incompleteShopRules),
    ...(opts.trace ? { checks } : {}),
  };
}

const MAX_TEXT = 6000;

/**
 * What Jev sees. Long texts (homepages with mega menus, long product pages) are clipped;
 * then the passages that triggered the questions go along, or a claim at the end would never be judged.
 */
export function productState(p: Product, passages: string[] = []): Record<string, unknown> {
  const variants = [...new Set(p.variants.map((v) => v.title).filter(Boolean))].slice(0, 10);
  const clipped = p.text.length > MAX_TEXT;
  const extra = clipped ? [...new Set(passages)].slice(0, 12) : [];
  return {
    produkt: p.title,
    ...(p.category ? { kategorie: p.category } : {}),
    ...(p.tags.length ? { tags: p.tags.slice(0, 10) } : {}),
    ...(variants.length ? { varianten: variants } : {}),
    beschreibung: clip(p.text, MAX_TEXT),
    ...(extra.length ? { weitere_fundstellen: extra } : {}),
  };
}

/** Rules share questions by key (e.g. product_category); a key must always mean the same question. */
export function mergeQuestions(parts: Record<string, Question>[]): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (const part of parts) {
    for (const [key, q] of Object.entries(part)) {
      const existing = out[key];
      if (existing && JSON.stringify(existing) !== JSON.stringify(q)) {
        throw new Error(`Frage "${key}" ist in zwei Regeln unterschiedlich definiert.`);
      }
      out[key] = q;
    }
  }
  return out;
}

function homepageSubject(shop: ShopSnapshot): Product[] {
  const home = shop.pages.find((p) => p.kind === 'home');
  if (!home) return [];
  return [{ id: HOME_ID, title: 'Startseite', url: home.url, tags: [], text: home.text, variants: [] }];
}

/** "Sprache „en“, Währung USD" when the homepage declares a non-German language or a non-euro currency, else null. */
export function foreignStorefront(shop: ShopSnapshot): string | null {
  const { language, currency } = shop.storefront ?? {};
  const parts = [
    ...(language && language !== 'de' ? [`Sprache „${language}“`] : []),
    ...(currency && currency !== 'EUR' ? [`Währung ${currency}`] : []),
  ];
  return parts.length ? parts.join(', ') : null;
}

function shopHome(shop: ShopSnapshot): string | undefined {
  return shop.pages.find((p) => p.kind === 'home')?.url;
}

// Preserve unreadable evidence as a coverage gap, not a clean result.
// A queue fed product by product (was verifyOnPages over all candidates at the end).
// Progress for the page phase is reported once the products are done, so the display keeps its order.
function pageCheckQueue(opts: EngineOptions, errors: string[], context?: RuleContext) {
  const dropped = new Set<Candidate>();
  const assess = (c: Candidate, page: PageView): boolean | 'unknown' => {
    try { return c.rule.verifyOnPage!(page, c.product, context); }
    catch { return 'unknown'; }
  };
  const dismiss = (c: Candidate, unknown: boolean) => {
    dropped.add(c);
    c.check.outcome = unknown ? 'page-inconclusive' : 'page-dismissed';
    if (unknown) {
      c.check.incomplete = true;
      errors.push(`${c.product.title}: ${c.rule.title} nicht vollständig prüfbar – erforderlicher Seiteninhalt war nicht lesbar.`);
    }
  };
  const limit = Math.max(1, opts.pageConcurrency ?? 4);
  const running: Promise<void>[] = [];
  const waiting: (() => void)[] = [];
  let active = 0;
  let done = 0;
  let total = 0;
  let reporting = false;
  const progress = () => {
    if (reporting) opts.onProgress?.({ phase: 'seiten', done, total });
  };
  const check = async (url: string, candidates: Candidate[]) => {
    const productData = candidates.some((c) => c.rule.verifyNeedsProductData);
    const page = await opts.loadPage!(url, { productData }).catch(() => null);
    // Fast HTML check first; only pages that still look like a problem are rendered in the browser.
    const stillMissing: Candidate[] = [];
    const staticResults = new Map<Candidate, boolean | 'unknown'>();
    for (const c of candidates) {
      c.check.page = page ? 'static' : 'unavailable';
      const result = page ? assess(c, page) : 'unknown';
      staticResults.set(c, result);
      if (result === false) dismiss(c, false);
      else stillMissing.push(c);
    }
    if (stillMissing.length > 0 && opts.renderPage) {
      const rendered = await opts.renderPage(url).catch(() => null);
      if (rendered) {
        rendered.variants ??= page?.variants;
        for (const c of stillMissing) {
          c.check.page = 'rendered';
          const result = assess(c, rendered);
          if (result !== true) dismiss(c, result === 'unknown');
          else c.verified = true;
        }
        done++;
        progress();
        return;
      }
    }
    for (const c of stillMissing) {
      if (opts.renderPage) {
        c.check.page = 'render-failed';
        c.check.incomplete = true;
        c.unverifiedReason = 'Browser-Prüfung fehlgeschlagen – dynamische Seiteninhalte bitte selbst prüfen.';
      } else if (page) c.verified = true;
      else {
        c.check.incomplete = true;
        c.unverifiedReason = 'Produktseite war nicht erreichbar – bitte selbst prüfen.';
      }
      if (page && staticResults.get(c) === 'unknown') dismiss(c, true);
    }
    done++;
    progress();
  };
  const run = async (url: string, candidates: Candidate[]) => {
    // A finished check hands its slot straight to the next waiting one.
    if (active < limit) active++;
    else await new Promise<void>((r) => waiting.push(r));
    try {
      opts.signal?.throwIfAborted();
      await check(url, candidates);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  return {
    /** One product's candidates, as soon as its answers are in. */
    add(candidates: Candidate[]): void {
      const byUrl = new Map<string, Candidate[]>();
      for (const c of candidates) {
        if (c.verified) continue;
        if (!c.product.url || !opts.loadPage) {
          c.unverifiedReason = 'Ohne Produktseite nicht überprüfbar – bitte im Shop nachsehen.';
          c.check.page = 'unavailable';
          c.check.incomplete = true;
          continue;
        }
        byUrl.set(c.product.url, [...(byUrl.get(c.product.url) ?? []), c]);
      }
      for (const [url, group] of byUrl) {
        total++;
        const job = run(url, group);
        // Awaited in finish(); until then a failure must not count as unhandled.
        job.catch(() => {});
        running.push(job);
      }
    },
    /** Waits for every page check; returns the candidates the pages dismissed. */
    async finish(): Promise<Set<Candidate>> {
      reporting = true;
      if (total > 0) progress();
      await Promise.all(running);
      return dropped;
    },
  };
}

function levelFor(p: number, riskThreshold: number, cap?: Level): Level {
  if (cap === 'pruefen') return 'pruefen';
  return p >= riskThreshold ? 'risiko' : 'pruefen';
}

const SEVERITY_ORDER = { hoch: 0, mittel: 1, niedrig: 2 } as const;

// Exported – the second opinion re-sorts after dropping and adding findings.
export function sortFindings(findings: Finding[]): Finding[] {
  const severity = new Map([...PRODUCT_RULES, ...SHOP_RULES].map((r) => [r.id, SEVERITY_ORDER[r.severity]]));
  return findings.sort(
    (a, b) =>
      (severity.get(a.ruleId) ?? 3) - (severity.get(b.ruleId) ?? 3) ||
      (a.level === b.level ? 0 : a.level === 'risiko' ? -1 : 1) ||
      b.confidence - a.confidence,
  );
}

function isFatal(err: unknown): boolean {
  return err instanceof JevError && (err.status === 401 || err.status === 402 || err.status === 403);
}

function fatalError(err: unknown): Error {
  const status = (err as JevError).status;
  const hint =
    status === 401
      ? 'Der API-Schlüssel wurde abgelehnt. Bitte OPENROUTER_API_KEY in der .env prüfen.'
      : status === 402
        ? 'Kein Guthaben mehr auf dem OpenRouter-Konto. Bitte unter openrouter.ai/credits aufladen.'
        : 'Kein Zugriff auf das Jev-Modell mit diesem Schlüssel.';
  return new Error(`${hint} (${(err as Error).message})`);
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
