import { ruleById } from '../rules/index.js';
import type { Rule } from '../rules/types.js';
import { MANDATORY_NOTICE } from '../rules/text.js';
import type { Finding, ScanReport } from '../types.js';

/** How the report names a finding the second opinion added (instead of "Modell 100 %"). */
export const SECOND_JUDGE_ADDED = 'Von der zweiten KI-Prüfung ergänzt';

/**
 * For how many products the second opinion gave no verdict (no answer, the cost cap, a
 * refused key) – the report then says their findings are the scanner's own. Undefined when it ran on all or did not run.
 */
export function secondJudgeGap(report: ScanReport): string | undefined {
  const j = report.secondJudge;
  const open = j ? j.failed + j.overCap : 0;
  if (!j || open === 0) return undefined;
  // Explain the coverage gap without exposing internal provider or budget details.
  return `Für ${open} von ${j.products} Produkten liegt keine zweite Prüfung vor; für sie gelten die bisherigen Befunde unverändert.`;
}

export interface RuleGroup {
  rule: Rule;
  findings: Finding[];
  risiko: number;
  pruefen: number;
}

export interface Summary {
  risiko: number;
  pruefen: number;
  bySeverity: Record<Rule['severity'], number>;
  groups: RuleGroup[];
}

/** Findings grouped by rule, in the report's order (severity first). */
export function summarize(report: ScanReport): Summary {
  const groups = new Map<string, RuleGroup>();
  const bySeverity = { hoch: 0, mittel: 0, niedrig: 0 };
  for (const f of report.findings) {
    const rule = ruleById(f.ruleId);
    if (!rule) continue;
    let g = groups.get(rule.id);
    if (!g) groups.set(rule.id, (g = { rule, findings: [], risiko: 0, pruefen: 0 }));
    g.findings.push(f);
    g[f.level]++;
    if (f.level === 'risiko') bySeverity[rule.severity]++;
  }
  const list = [...groups.values()];
  return {
    risiko: list.reduce((n, g) => n + g.risiko, 0),
    pruefen: list.reduce((n, g) => n + g.pruefen, 0),
    bySeverity,
    groups: list,
  };
}

// ---------------------------------------------------------------- what the shop owner reads
// One supplement shop's scan listed 282 findings. Its quotes were largely the
// guarantee slogan ("Du und Deine Gesundheit stehen im Vordergrund!", 70 times) and the supplement notice the law requires
// (about 50 times), and one Dermatest sentence was 25 separate rows. Jev reads the whole description, so the quotes are for
// the reader: they should show the product's own sentence, and the same sentence should be one action.


/** A sentence counts as repeated across the shop when at least this many findings of the rule, and this share, quote it. */
const REPEATED_MIN = 5;
const REPEATED_SHARE = 0.25;
/** Findings that quote the same sentence become one action from this many on. */
const GROUP_MIN = 2;
/** Rules whose fix sits in the shop's theme or settings, not in a product text: one action for all products. */
const THEME_RULES = new Set(['strike-price', 'unit-price', 'textile-fibre']);

/** A template heading at the start of a quote: up to five words before a colon. */
const HEADING = /^\s*([^:.!?]{3,60}?)\s*:\s+\S/u;

const STOPWORDS = new Set(['mit', 'von', 'und', 'der', 'die', 'das', 'den', 'dem', 'des', 'für', 'ein', 'eine', 'einer', 'eines', 'einem', 'ist', 'sind', 'wird', 'wurde', 'auch', 'bei', 'aus', 'auf', 'zum', 'zur']);

/** The words of a quote, order and small variations aside: "✔ Hautverträglichkeit mit SEHR GUT von Dermatest® bestätigt …". */
function sentenceKey(quote: string): string {
  const words = quote.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))].sort().join(' ');
}

/**
 * Maps each sentence key to the most frequent key it nearly equals: at least 80 % of its words occur in it. The same
 * banner comes as "💛 SICHERHEIT DURCH 100 TAGE GELD-ZURÜCK-GARANTIE: Du und Deine Gesundheit …", with a typo
 * ("GELD-ZÜRÜCK") and cut to "Du und Deine Gesundheit stehen im Vordergrund!".
 */
function canonicalKeys(keysPerFinding: string[][]): (k: string) => string {
  const count = new Map<string, number>();
  for (const keys of keysPerFinding) for (const k of new Set(keys)) count.set(k, (count.get(k) ?? 0) + 1);
  const byFrequency = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  const map = new Map<string, string>();
  for (const k of byFrequency) {
    const words = k.split(' ').filter(Boolean);
    const target =
      words.length >= 3
        ? byFrequency.find((K) => K !== k && count.get(K)! > count.get(k)! && map.get(K) === K && words.filter((w) => K.split(' ').includes(w)).length >= 0.8 * words.length)
        : undefined;
    map.set(k, target ?? k);
  }
  return (k) => map.get(k) ?? k;
}

/**
 * The quotes to show for each finding: no mandatory notices; a sentence repeated across the shop only if nothing else is left.
 * Findings that kept only such a sentence go into `generic`: the keyword search found nothing of the product's own, and the
 * verdict rests on Jev reading the whole description.
 */
export function displayEvidence(report: ScanReport, generic?: Set<Finding>): Map<Finding, string[]> {
  const out = new Map<Finding, string[]>();
  const byRule = new Map<string, Finding[]>();
  for (const f of report.findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  for (const findings of byRule.values()) {
    const cleaned = new Map(findings.map((f) => [f, f.evidence.filter((e) => !MANDATORY_NOTICE.test(e))]));
    const canonical = canonicalKeys([...cleaned.values()].map((quotes) => quotes.map(sentenceKey)));
    const keyOf = (q: string) => canonical(sentenceKey(q));
    const count = new Map<string, number>();
    for (const quotes of cleaned.values()) for (const k of new Set(quotes.map(keyOf))) count.set(k, (count.get(k) ?? 0) + 1);
    const repeated = (q: string) => {
      const c = count.get(keyOf(q)) ?? 0;
      return c >= REPEATED_MIN && c >= REPEATED_SHARE * findings.length;
    };
    // A repeated sentence is background (a guarantee banner) when most findings that quote it also quote a sentence of the
    // product's own; when it mostly stands alone it is the claim itself (a Dermatest seal, a template eco line) and stays.
    const alongside = new Map<string, number>();
    for (const quotes of cleaned.values()) {
      if (!quotes.some((q) => !repeated(q))) continue;
      for (const k of new Set(quotes.filter(repeated).map(keyOf))) alongside.set(k, (alongside.get(k) ?? 0) + 1);
    }
    const background = (q: string) => repeated(q) && (alongside.get(keyOf(q)) ?? 0) >= 0.5 * (count.get(keyOf(q)) ?? 0);
    for (const [f, quotes] of cleaned) {
      // A sentence Jev chose is shown as chosen, even when many products share it.
      if (f.quoteBasis === 'modell' && quotes.length > 0) {
        out.set(f, quotes);
        continue;
      }
      const own = quotes.filter((q) => !background(q));
      out.set(f, own.length > 0 ? own : quotes);
      if (own.length === 0 && quotes.length > 0) generic?.add(f);
    }
  }
  return out;
}

export interface Action {
  rule: Rule;
  /** The sentence these findings share; none for theme-level rules and findings without a quote. */
  quote?: string;
  findings: Finding[];
  risiko: number;
  pruefen: number;
  /** The quote is a sentence found on many product pages, not one of these products' own: the verdict rests on the whole text. */
  generic: boolean;
  /** Under a template heading: each product's own sentence that put it in this action. */
  own: Map<Finding, string>;
}

/** Findings turned into what the owner has to do: one action per shared sentence, one per theme-level rule. */
export function actionsFor(summary: Summary, report: ScanReport): Action[] {
  const generic = new Set<Finding>();
  const shown = displayEvidence(report, generic);
  const actions: Action[] = [];
  const make = (rule: Rule, findings: Finding[], quote?: string): Action => ({
    rule,
    quote,
    findings,
    risiko: findings.filter((f) => f.level === 'risiko').length,
    pruefen: findings.filter((f) => f.level === 'pruefen').length,
    generic: quote !== undefined && findings.every((f) => generic.has(f)),
    own: new Map(),
  });
  for (const g of summary.groups) {
    if (THEME_RULES.has(g.rule.id)) {
      actions.push(make(g.rule, g.findings));
      continue;
    }
    // A shared sentence groups first; failing that, a shared template heading ("✔ Ganzheitliche Wirkung: …", with a
    // different promise for each product) – the owner rewrites the template once and checks each product's sentence.
    const canonical = canonicalKeys(g.findings.map((f) => (shown.get(f) ?? []).map(sentenceKey)));
    const keysOf = (q: string) => {
      const heading = HEADING.exec(q)?.[1];
      const k = canonical(sentenceKey(q));
      return heading ? [k, `h:${sentenceKey(heading)}`] : [k];
    };
    const count = new Map<string, number>();
    for (const f of g.findings) for (const k of new Set((shown.get(f) ?? []).flatMap(keysOf))) count.set(k, (count.get(k) ?? 0) + 1);
    const clusters = new Map<string, { quote: string; findings: Finding[]; own: Map<Finding, string> }>();
    for (const f of g.findings) {
      const quotes = shown.get(f) ?? [];
      let best: { key: string; quote: string; source: string; n: number } | undefined;
      for (const q of quotes) {
        for (const k of keysOf(q)) {
          const n = count.get(k) ?? 0;
          // Prefer the exact sentence over a heading when both reach the group size.
          const better = !best || n > best.n || (n === best.n && best.key.startsWith('h:') && !k.startsWith('h:'));
          if (k !== 'h:' && k && n >= GROUP_MIN && better) best = { key: k, quote: k.startsWith('h:') ? `${HEADING.exec(q)![1]}: …` : q, source: q, n };
        }
      }
      if (best) {
        const c = clusters.get(best.key) ?? { quote: best.quote, findings: [], own: new Map<Finding, string>() };
        c.findings.push(f);
        c.own.set(f, best.source);
        clusters.set(best.key, c);
      } else {
        actions.push(make(g.rule, [f], quotes[0]));
      }
    }
    for (const c of clusters.values()) actions.push({ ...make(g.rule, c.findings, c.quote), own: c.own });
  }
  // A "Risiko" counts double; a setting that affects 78 products (all at "Prüfen", because the 30-day price cannot be
  // checked from outside) still comes before a single product's sentence.
  const weight = { hoch: 0, mittel: 1, niedrig: 2 };
  const score = (a: Action) => 2 * a.risiko + a.pruefen;
  return actions.sort((a, b) => score(b) - score(a) || b.risiko - a.risiko || weight[a.rule.severity] - weight[b.rule.severity]);
}
