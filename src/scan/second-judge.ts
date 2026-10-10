// The two-model second opinion, a step after the scan. Two cheap models read each product – title, prices and excerpts of the
// rendered page – against second-judge-rulebook.md. A verdict counts when both agree: a scanner finding is dropped when both
// say none and stays "Risiko" only when both say violation; claim-rule findings both call a violation are added at "Prüfen".
// A request that fails twice, or a product beyond the cost cap, leaves the scanner's findings as they are.
// On by default; SECOND_JUDGE=off switches it off.

import { readFileSync } from 'node:fs';
import { PRODUCT_RULES } from '../rules/index.js';
import type { Finding, Product, ScanReport, SecondJudgeSummary, ShopSnapshot } from '../types.js';
import { sentencesOf } from './cite.js';
import { sortFindings } from './engine.js';
import { pool } from './pool.js';

export const RULE_IDS = PRODUCT_RULES.map((r) => r.id);
const VERDICTS = ['violation', 'possible', 'unclear', 'none'] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Answer = Record<string, { v: Verdict; why: string }>;

/** The models read wording on these rules; on price and textile rules they only veto – they do not see the shop's single prices. */
const CLAIM_RULES = new Set(['health-claim', 'health-disease', 'test-claim', 'green-generic', 'green-climate', 'green-label', 'law-as-benefit']);

export interface JudgeModel {
  model: string;
  reasoning?: 'low' | 'medium' | 'high';
  /** OpenRouter provider order; set, it also routes only to providers that enforce the JSON schema. */
  sort?: 'price' | 'throughput' | 'latency';
}

/**
 * Both are routed by throughput: with OpenRouter's default providers DeepSeek answered a batch of four in 22–139 s and timed
 * out at 90 s in 4 of 7 requests; sorted by throughput in 35–76 s, 0 of 5.
 */
const JUDGE_MODELS: JudgeModel[] = [
  { model: 'deepseek/deepseek-v4-flash', sort: 'throughput' },
  { model: 'z-ai/glm-5.3-flash', reasoning: 'low', sort: 'throughput' },
];

/** A retry goes to the other provider order, so a provider that hangs is not asked twice. */
const OTHER_ORDER = { throughput: 'latency', latency: 'throughput', price: 'throughput' } as const;

// ------------------------------------------------------------------ what the models read

export interface BrowserFacts {
  textLength: number;
  priceBlock?: string | null;
  unitPriceSnippets?: string[];
  materialSnippets?: string[];
  priceNoteSnippets?: string[];
}

function snippets(text: string, re: RegExp, max = 3, radius = 80): string[] {
  const out: string[] = [];
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(global)) {
    const s = text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius).replace(/\s+/g, ' ').trim();
    if (!out.some((o) => o.includes(s.slice(20, 60)))) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const UNIT_PRICE_HINT =
  /(?:€|eur)\s*\/\s*\S{1,8}|\/\s*(?:1\s*|100\s*)?(?:kg|l|g|ml)(?![\p{L}])|(?:1\s*(?:kg|l)|100\s*(?:g|ml))\s*=|grundpreis|basispreis|stückpreis|(?:pro|je)\s+(?:1\s*|100\s*)?(?:kg|g|l|ml|liter|stück)(?![\p{L}])/iu;
const MATERIAL_HINT = /material|zusammensetzung|baumwolle|polyester|elasth?an|viskose|wolle|leinen|seide|polyamid|lyocell|tencel|modal|cotton|nylon|silber|edelstahl|messing|vergoldet/iu;
const PRICE_NOTE_HINT = /30\s*tage|niedrigste|tiefstpreis|bestpreis|uvp|regulär|statt|ursprünglich|streichpreis|spare|rabatt/iu;

/** Neutral excerpts of the rendered page, as the audit sheets show them. */
export function browserFacts(text: string, p: Product): BrowserFacts {
  const price = p.variants.find((v) => v.price)?.price;
  let priceBlock: string | null = null;
  if (price) {
    const forms = [price.toFixed(2).replace('.', ','), price.toFixed(2)];
    const at = forms.map((f) => text.indexOf(f)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (at !== undefined) priceBlock = text.slice(Math.max(0, at - 220), at + 260).replace(/\s+/g, ' ').trim();
  }
  return {
    textLength: text.length,
    priceBlock,
    unitPriceSnippets: snippets(text, UNIT_PRICE_HINT),
    materialSnippets: snippets(text, MATERIAL_HINT, 12)
      .sort((a, b) => Number(/\d\s*%/.test(b)) - Number(/\d\s*%/.test(a)))
      .slice(0, 4),
    priceNoteSnippets: snippets(text, PRICE_NOTE_HINT),
  };
}

/** One product as an audit sheet shows it; `facts` null: the page could not be rendered. */
export function productBlock(key: string, shop: string, pr: Product, b: BrowserFacts | null): string {
  const variants = pr.variants
    .slice(0, 6)
    .map((v) => `${v.title || 'Standard'}: ${v.price ?? '?'} €${v.compareAtPrice && v.price != null && v.compareAtPrice > v.price ? ` (statt ${v.compareAtPrice} €)` : ''}`)
    .join(' · ');
  const list = (xs: string[] | undefined) => (xs?.length ? xs.map((x) => `„${x}“`).join(' / ') : '–');
  const facts = b
    ? [
        `Preisblock: ${b.priceBlock ? `„${b.priceBlock}“` : '–'}`,
        `Grundpreis-Stellen: ${list(b.unitPriceSnippets)}`,
        `Material-Stellen: ${list(b.materialSnippets)}`,
        `Preis-Hinweise: ${list(b.priceNoteSnippets)}`,
      ].join('\n- ')
    : 'Seite im Browser nicht ladbar';
  return [
    `### ${key} · ${shop} · ${pr.title}`,
    `Kategorie: ${pr.category ?? '–'} | Tags: ${pr.tags.slice(0, 8).join(', ') || '–'}`,
    `Varianten: ${variants || '–'}`,
    `Browser (gerendert):\n- ${facts}`,
    '',
    '```',
    pr.text.length > 3500 ? `${pr.text.slice(0, 3500)} …[gekürzt]` : pr.text || '(keine Beschreibung)',
    '```',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ the request

let system: string | undefined;
/** The rulebook lives next to this file, so a copy of src/ alone can run the second opinion. */
export const RULEBOOK_URL = new URL('./second-judge-rulebook.md', import.meta.url);
export function judgeSystem(): string {
  system ??= `${readFileSync(RULEBOOK_URL, 'utf8')}

## Answer

You get one or more product sheets, each starting with "### P… ·". Judge each product on its own. Return JSON only:
{"products": [{"key": "P001", "verdicts": {${RULE_IDS.map((r) => `"${r}": {"v": "…", "why": "…"}`).join(', ')}}}, …]} with one entry per
product in the order given. "v" is one of violation, possible, unclear, none. "why": at most 20 words quoting the decisive words
from the sheet; for none, the reason in a few words ("no claim", "authorised wording", "basis in the sentence: aus Kork").`;
  return system;
}

const VERDICT_OBJECT = {
  type: 'object',
  properties: Object.fromEntries(RULE_IDS.map((r) => [r, { type: 'object', properties: { v: { type: 'string', enum: [...VERDICTS] }, why: { type: 'string' } }, required: ['v', 'why'], additionalProperties: false }])),
  required: RULE_IDS,
  additionalProperties: false,
};
const SCHEMA = {
  type: 'object',
  properties: { products: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, verdicts: VERDICT_OBJECT }, required: ['key', 'verdicts'], additionalProperties: false } } },
  required: ['products'],
  additionalProperties: false,
};

function valid(a: unknown): a is Answer {
  return !!a && RULE_IDS.every((r) => {
    const x = (a as Answer)[r];
    return !!x && (VERDICTS as readonly string[]).includes(x.v);
  });
}

/** The verdicts for every key of the batch, or null when the answer lacks one of them. */
function parseAnswers(content: string, keys: string[]): Map<string, Answer> | null {
  try {
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { products?: { key: string; verdicts: unknown }[] };
    const got = new Map<string, Answer>();
    for (const p of parsed.products ?? []) if (keys.includes(p.key) && valid(p.verdicts)) got.set(p.key, p.verdicts);
    return got.size < keys.length ? null : got;
  } catch {
    return null;
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 524, 529]);
/** The key is refused or out of credit: every further request would fail the same way. */
const FATAL_STATUS = new Set([401, 402, 403]);

export interface SecondJudgeOptions {
  apiKey: string;
  models?: JudgeModel[];
  /** Cost cap per scan in USD. */
  maxUsd?: number;
  timeoutMs?: number;
  /** Repeats after a failed request (timeout, network, retryable HTTP status, incomplete answer). */
  retries?: number;
  batchSize?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface AskResult {
  answers: Map<string, Answer> | null;
  costUsd: number;
  requests: number;
  /** Set when the key itself was refused. */
  fatal?: string;
}

export class SecondJudge {
  readonly models: JudgeModel[];
  readonly maxUsd: number;
  readonly batchSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SecondJudgeOptions) {
    this.models = opts.models ?? JUDGE_MODELS;
    this.maxUsd = opts.maxUsd ?? 0.3;
    this.batchSize = opts.batchSize ?? 4;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    // A missing rulebook stops the start, not every scan's second opinion.
    judgeSystem();
  }

  /** One model's verdicts for a batch of product blocks; `answers` null after the retry failed too. */
  async ask(judge: JudgeModel, keys: string[], user: string, signal?: AbortSignal): Promise<AskResult> {
    const body = (sort: JudgeModel['sort']) => JSON.stringify({
      model: judge.model,
      messages: [
        { role: 'system', content: judgeSystem() },
        { role: 'user', content: user },
      ],
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'verdicts', strict: true, schema: SCHEMA } },
      usage: { include: true },
      ...(judge.reasoning ? { reasoning: { effort: judge.reasoning } } : {}),
      ...(sort ? { provider: { sort, require_parameters: true } } : {}),
    });
    const result: AskResult = { answers: null, costUsd: 0, requests: 0 };
    const attempts = 1 + (this.opts.retries ?? 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await this.sleep(1500);
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 90_000);
      let status: number;
      let text: string;
      try {
        result.requests++;
        // The body is read inside the try: the timeout can fire while it streams in.
        const res = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'ShopWacht' },
          body: body(attempt > 0 && judge.sort ? OTHER_ORDER[judge.sort] : judge.sort),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        status = res.status;
        text = await res.text();
      } catch {
        signal?.throwIfAborted();
        continue;
      }
      if (status < 200 || status >= 300) {
        if (FATAL_STATUS.has(status)) return { ...result, fatal: `HTTP ${status} ${text.slice(0, 200)}` };
        if (RETRYABLE_STATUS.has(status)) continue;
        return result;
      }
      let data: { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } } = {};
      try {
        data = JSON.parse(text);
      } catch {
        // an unreadable body counts as an incomplete answer
      }
      result.costUsd += data.usage?.cost ?? 0;
      const answers = parseAnswers(data.choices?.[0]?.message?.content ?? '', keys);
      if (answers) return { ...result, answers };
    }
    return result;
  }
}

// ------------------------------------------------------------------ the verdicts applied to the scan

const SEVERE = new Set<Verdict>(['violation', 'possible']);

/** Both models' answers for one product: a verdict stands when all agree, otherwise "possible" if any saw an issue, else "unclear". */
export function combine(answers: Answer[]): Answer {
  return Object.fromEntries(
    RULE_IDS.map((r) => {
      const vs = answers.map((x) => x[r]!.v);
      const v: Verdict = vs.every((x) => x === vs[0]) ? vs[0]! : vs.some((x) => SEVERE.has(x)) ? 'possible' : 'unclear';
      return [r, { v, why: answers.map((x) => x[r]!.why).filter(Boolean).join(' | ') }];
    }),
  ) as Answer;
}

export type JudgeChange = SecondJudgeSummary['changes'][number];

/** What the report says in place of a passage when an added finding has none. */
export const NO_PASSAGE = 'Ohne zugeordnete Textstelle – bitte die Produktbeschreibung auf diese Aussage prüfen.';

/** What the models put in quotation marks in their reason: „…“, "…", «…» or '…'. One word is not enough to find a passage. */
function quotedWords(why: string): string[] {
  const quotes = [...why.matchAll(/[„“"«]([^„“"«»]{3,200})[“”"»]|(?<![\p{L}\d])['‚‘]([^'‚‘’]{3,200})['‘’](?![\p{L}\d])/gu)].map((m) => (m[1] ?? m[2])!.trim());
  return quotes.filter((q) => /\s/.test(q));
}

/** The excerpts of the rendered page on a product sheet, as one text. */
const excerptsOf = (b: BrowserFacts | null | undefined): string =>
  b ? [b.priceBlock ?? '', ...(b.unitPriceSnippets ?? []), ...(b.materialSnippets ?? []), ...(b.priceNoteSnippets ?? [])].join('\n') : '';

/**
 * Where the shop says what the models quoted, the longest quote first: the product's own sentence, or – for words that
 * stand on the rendered page only, such as a list of benefits beside the price – the words as they stand there. The reason
 * itself is never shown: it is the models' wording, and a quote that is nowhere in what they read may be the wording the
 * law allows.
 */
function passages(why: string, product: Product, page: string): string[] {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  const sentences = sentencesOf(product);
  const found: string[] = [];
  for (const q of quotedWords(why).sort((a, b) => b.length - a.length)) {
    const onPage = () => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'iu').exec(page)?.[0];
    const passage = sentences.find((s) => flat(s).includes(flat(q))) ?? onPage();
    if (passage && !found.some((f) => flat(f).includes(flat(passage)))) found.push(passage);
  }
  return found.slice(0, 3);
}

/**
 * "veto+t" for one product: its findings after the combined verdict, and what changed. Findings of rules the models were not
 * asked about stay as they are. `facts` are the page excerpts the models read with the product.
 */
export function applyVerdicts(findings: Finding[], product: Product, answer: Answer, facts?: BrowserFacts | null): { findings: Finding[]; removed: Finding[]; changes: JudgeChange[] } {
  const changes: JudgeChange[] = [];
  const kept: Finding[] = [];
  // A dropped finding is kept aside (technical data, CSV), with the models' reason.
  const removed: Finding[] = [];
  const why = (r: string) => answer[r]?.why || undefined;
  for (const f of findings) {
    const v = answer[f.ruleId]?.v;
    // A finding is
    // dropped only when the models say why; a bare "none" leaves it, at "Prüfen".
    if (v === 'none' && !why(f.ruleId)) {
      if (f.level === 'risiko') {
        changes.push({ productId: product.id, ruleId: f.ruleId, change: 'downgraded', level: 'pruefen' });
        kept.push({ ...f, level: 'pruefen', secondJudge: 'downgraded' });
      } else kept.push(f);
      continue;
    }
    if (v === 'none') {
      changes.push({ productId: product.id, ruleId: f.ruleId, change: 'dropped', level: f.level, why: why(f.ruleId) });
      removed.push({ ...f, secondJudge: 'removed' });
      continue;
    }
    if (v && f.level === 'risiko' && v !== 'violation') {
      changes.push({ productId: product.id, ruleId: f.ruleId, change: 'downgraded', level: 'pruefen', why: why(f.ruleId) });
      kept.push({ ...f, level: 'pruefen', secondJudge: 'downgraded' });
      continue;
    }
    kept.push(f);
  }
  for (const r of RULE_IDS) {
    if (!CLAIM_RULES.has(r) || answer[r]?.v !== 'violation' || findings.some((f) => f.ruleId === r)) continue;
    changes.push({ productId: product.id, ruleId: r, change: 'added', level: 'pruefen', why: why(r) });
    const evidence = passages(answer[r]!.why, product, excerptsOf(facts));
    kept.push({
      ruleId: r,
      level: 'pruefen',
      // The models give verdicts, not probabilities; the report shows SECOND_JUDGE_ADDED instead of a percentage.
      confidence: 1,
      basis: 'modell',
      subject: { type: 'product', id: product.id, title: product.title, url: product.url },
      evidence,
      ...(evidence.length ? {} : { note: NO_PASSAGE }),
      secondJudge: 'added',
    });
  }
  return { findings: kept, removed, changes };
}

export interface SecondJudgeRun {
  /** The rendered page's text for the excerpts; null when it could not be rendered. Without it, no excerpts. */
  pageText?: (url: string) => Promise<string | null>;
  /**
   * Excerpts recorded earlier, used instead of `pageText` when given (null: the page
   * could not be rendered then). For replaying a recorded run; unused in scans.
   */
  facts?: (p: Product) => BrowserFacts | null | undefined;
  /** Requests in flight. */
  concurrency: number;
  signal?: AbortSignal;
  /** Batches done, for the progress step „Zweite Prüfung“. */
  onProgress?: (done: number, total: number) => void;
}

/** Judges the scan's products and applies "veto+t" to `report.findings` in place; the summary goes to `report.secondJudge`. */
export async function runSecondJudge(report: ScanReport, shop: ShopSnapshot, judge: SecondJudge, run: SecondJudgeRun): Promise<void> {
  const started = Date.now();
  const flagged = new Set(report.findings.filter((f) => f.subject.type === 'product').map((f) => f.subject.id));
  // Products with findings first: under the cost cap, the veto on what the report shows comes before additions.
  const products = [...shop.products.filter((p) => flagged.has(p.id)), ...shop.products.filter((p) => !flagged.has(p.id))];
  const host = shop.origin.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const batches: Product[][] = [];
  for (let i = 0; i < products.length; i += judge.batchSize) batches.push(products.slice(i, i + judge.batchSize));
  const keyOf = new Map(products.map((p, i) => [p.id, `P${String(i + 1).padStart(3, '0')}`]));

  const summary: SecondJudgeSummary = {
    models: judge.models.map((m) => m.model), requests: 0, costUsd: 0, maxUsd: judge.maxUsd, durationMs: 0,
    products: products.length, judged: 0, failed: 0, overCap: 0, withoutPage: 0, dropped: 0, downgraded: 0, added: 0, changes: [],
  };
  const verdicts = new Map<string, Answer>();
  const read = new Map<string, BrowserFacts | null>();
  let inFlight = 0;
  let batchesDone = 0;
  let fatal: string | undefined;
  // A batch costs one request per model; before the first answer it is estimated at $0.01 (audit 15A: about $0.004).
  const batchEstimate = () => (summary.requests > 0 ? (summary.costUsd / summary.requests) * judge.models.length : 0.01);
  // A batch that does not fit only because of batches in flight waits for the next
  // answer and is looked at again with the real costs. Dropping it at once lets the idle worker empty the queue: with a
  // $0.07 cap, 36 of 120 products went unjudged while the judged ones cost $0.087.
  const answered: (() => void)[] = [];
  const room = async (): Promise<boolean> => {
    for (;;) {
      run.signal?.throwIfAborted();
      if (fatal || summary.costUsd + batchEstimate() > judge.maxUsd) return false;
      if (summary.costUsd + (inFlight + 1) * batchEstimate() <= judge.maxUsd) return true;
      await new Promise<void>((r) => answered.push(r));
    }
  };
  await pool(
    batches,
    // As many batches as the scan's concurrency (was half): shop30.de took 401 s for
    // 80 products with four batches in flight, most of it waiting on 35–90 s answers.
    Math.max(1, run.concurrency),
    async (batch) => {
      if (fatal) {
        summary.failed += batch.length;
        run.onProgress?.(++batchesDone, batches.length);
        return;
      }
      if (!(await room())) {
        // The key was refused meanwhile, or the money spent leaves no room for another batch.
        if (fatal) summary.failed += batch.length;
        else summary.overCap += batch.length;
        run.onProgress?.(++batchesDone, batches.length);
        return;
      }
      inFlight++;
      try {
        const blocks = await Promise.all(
          batch.map(async (p) => {
            let facts = run.facts?.(p);
            if (facts === undefined) {
              const text = p.url && run.pageText ? await run.pageText(p.url).catch(() => null) : null;
              facts = text ? browserFacts(text, p) : null;
            }
            if (!facts) summary.withoutPage++;
            read.set(p.id, facts);
            return productBlock(keyOf.get(p.id)!, host, p, facts).trim();
          }),
        );
        const keys = batch.map((p) => keyOf.get(p.id)!);
        const results = await Promise.all(judge.models.map((m) => judge.ask(m, keys, blocks.join('\n\n'), run.signal)));
        for (const r of results) {
          summary.requests += r.requests;
          summary.costUsd += r.costUsd;
          fatal ??= r.fatal;
        }
        if (results.some((r) => !r.answers)) {
          summary.failed += batch.length;
          return;
        }
        for (const p of batch) verdicts.set(p.id, combine(results.map((r) => r.answers!.get(keyOf.get(p.id)!)!)));
      } catch (err) {
        if (run.signal?.aborted) throw err;
        // An error of this step itself (say, the rulebook missing): the scan keeps its findings; later batches would fail alike.
        fatal ??= (err as Error).message;
        summary.failed += batch.length;
      } finally {
        inFlight--;
        for (const wake of answered.splice(0)) wake();
        run.onProgress?.(++batchesDone, batches.length);
      }
    },
    run.signal,
  );

  const others = report.findings.filter((f) => f.subject.type !== 'product' || !verdicts.has(f.subject.id));
  const removed: Finding[] = [];
  const judged = products.flatMap((p) => {
    const answer = verdicts.get(p.id);
    if (!answer) return [];
    const result = applyVerdicts(report.findings.filter((f) => f.subject.type === 'product' && f.subject.id === p.id), p, answer, read.get(p.id));
    summary.changes.push(...result.changes);
    removed.push(...result.removed);
    return result.findings;
  });
  report.findings = sortFindings([...others, ...judged]);
  if (removed.length) report.removedFindings = sortFindings([...(report.removedFindings ?? []), ...removed]);
  summary.judged = verdicts.size;
  for (const c of summary.changes) summary[c.change]++;
  summary.costUsd = Math.round(summary.costUsd * 1e6) / 1e6;
  summary.durationMs = Date.now() - started;
  if (fatal) summary.stoppedBy = fatal;
  report.secondJudge = summary;
}
