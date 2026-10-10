import type { Answer, Question } from '../decisions/types.js';
import type { Finding, Level, Product, Severity, ShopSnapshot } from '../types.js';
import type { Catalogue } from './catalogue.js';

export interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  /** Legal basis, as shown in the report. */
  law: string;
  /** Why this is an Abmahnung risk. */
  explain: string;
  /** What the shop owner should do. */
  fix: string;
  /** ISO date from which the rule applies, if it is new law. */
  since?: string;
  /** Findings of this rule never go above this level (e.g. when we cannot see all facts). */
  maxLevel?: Level;
  /**
   * What the offending sentence says, for claim rules. After a finding, Jev picks
   * that sentence from the product's sentences, so the report quotes what the model objected to, not a keyword match.
   */
  cite?: string;
  /** Sentences the rule itself does not count as evidence (authorised nutrient claims); they are not offered. */
  citeSkip?: (sentence: string) => boolean;
  /** Per-rule cut-offs, set from the test bench; default: config. */
  reviewThreshold?: number;
  riskThreshold?: number;
}

/** What we can see of a live product page. */
export interface PageView {
  html: string;
  text: string;
  /** Scoped page content to recover an empty feed description. */
  productText?: string;
  /** Rendered in a browser: the text is what a shopper sees, so an absent price really is absent. */
  rendered?: boolean;
  /** From Shopify's product data: whether each variant has a unit price configured. */
  variants?: { unitPrice: boolean }[];
}

/** What a rule may know about the whole shop while judging one product. */
export interface RuleContext {
  /** The shop's catalogue: the product sold singly, to check a multipack's crossed-out price against. */
  catalogue?: Catalogue;
}

export interface Prepared {
  /** Questions for Jev. Keys are shared across rules: same key = same question, asked once. */
  questions: Record<string, Question>;
  /** Keyword guesses for demo mode, keyed like `questions`. */
  hints: Record<string, number | string>;
  evidence: string[];
  note?: string;
  /** Reference data for Jev, added to the product state (e.g. the authorised claims for the named nutrients). */
  context?: Record<string, unknown>;
  /** Cap for this product alone, when the text itself makes the case a judgement call. */
  maxLevel?: Level;
}

export class Answers {
  constructor(private readonly raw: Record<string, Answer>) {}

  noul(key: string): number {
    const a = this.raw[key];
    if (a?.type !== 'noul') throw new Error(`Keine Ja/Nein-Antwort für "${key}"`);
    return a.noul;
  }

  choice(key: string): string {
    const a = this.raw[key];
    if (a?.type !== 'choice') throw new Error(`Keine Auswahl-Antwort für "${key}"`);
    return a.choice;
  }

  /** Each option's probability for a choice question, when Jev sends them. */
  probabilities(key: string): Record<string, number> | undefined {
    const a = this.raw[key];
    return a?.type === 'choice' ? a.probabilities : undefined;
  }
}

export interface ProductRule extends RuleMeta {
  kind: 'product';
  /** Also run this rule on the homepage text (for text claims like "klimaneutraler Versand"). */
  alsoOnHomepage?: boolean;
  /** Marks the trigger words inside quoted evidence in the report. */
  highlight?: RegExp;
  /** null = rule does not apply to this product; nothing is asked. */
  prepare(product: Product, context?: RuleContext): Prepared | null;
  /** Probability (0–1) that the issue is real. */
  judge(answers: Answers, product: Product): number;
  /**
   * For "something is missing" rules: look at the live product page before reporting.
   * Returns true if the issue is still present on the page.
   * 'unknown' means required page content was unreadable.
   * With the same shop context `prepare` gets (the catalogue).
   */
  verifyOnPage?(page: PageView, product: Product, context?: RuleContext): boolean | 'unknown';
  /** Also load the shop system's product data (Shopify: /products/<handle>.js) for the check. */
  verifyNeedsProductData?: boolean;
  /**
   * May judge the product section of the live page when the feed has no
   * description. Only for rules that classify the product (what it is, how it is sold): the page section
   * also carries shop-wide text (shipping tabs, brand blurbs) that claim rules would take for the product's own claims.
   */
  readsPageText?: boolean;
}

export type Ask = (
  state: unknown,
  questions: Record<string, Question>,
  hints: Record<string, number | string>,
) => Promise<Answers>;

export type ShopFinding = Pick<Finding, 'confidence' | 'evidence' | 'note'> & {
  ruleId: string;
  page?: { id: string; title: string; url?: string };
  level?: Level;
  /** Set to 'modell' when the finding comes from a Jev answer; default is a rule check. */
  basis?: 'modell';
};

export interface ShopRule extends RuleMeta {
  kind: 'shop';
  check(shop: ShopSnapshot, ask: Ask): Promise<ShopFinding[]>;
}

export type Rule = ProductRule | ShopRule;
