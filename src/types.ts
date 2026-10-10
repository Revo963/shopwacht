export interface Variant {
  title: string;
  price: number | null;
  compareAtPrice: number | null;
  /** From a CSV export: the unit price was configured in the shop system. */
  hasUnitPrice?: boolean;
}

export interface Product {
  id: string;
  title: string;
  url?: string;
  category?: string;
  tags: string[];
  /** Plain text of the product description (HTML already stripped). */
  text: string;
  variants: Variant[];
}

export interface ShopPage {
  kind: 'home' | 'impressum' | 'widerruf' | 'datenschutz' | 'agb';
  url: string;
  text: string;
  /** Raw HTML, kept for link and markup checks. */
  html: string;
}

export interface ShopSnapshot {
  origin: string;
  platform: 'shopify' | 'woocommerce' | 'csv';
  products: Product[];
  pages: ShopPage[];
  /** Link texts + hrefs found on the homepage (footer links etc.). */
  homeLinks: { text: string; href: string }[];
  /** Products the source reported but we did not load (cap reached). */
  truncated: boolean;
  /** Legal pages that exist (or may exist) but could not be loaded: never report these as missing. */
  unreachable: { kind: ShopPage['kind']; url: string }[];
  /**
   * What the homepage says about its language (`<html lang>`) and currency
   * (`Shopify.currency`). Absent when it says neither, or for a CSV upload.
   */
  storefront?: { language?: string; currency?: string };
  /**
   * The shop's whole catalogue when `products` is only a part of it (the bench replays a
   * sample); a live scan leaves it out and uses `products`.
   */
  catalogue?: { id: string; title: string; variants: { title: string; price: number | null | undefined }[] }[];
}

export type Severity = 'hoch' | 'mittel' | 'niedrig';

/** "risiko" = model is confident; "pruefen" = borderline, a human should look. */
export type Level = 'risiko' | 'pruefen';

/** What the finding rests on: the model's judgement, the demo keyword heuristic, or a fixed rule check. */
export type Basis = 'modell' | 'stichwort' | 'regel';

export interface Finding {
  ruleId: string;
  level: Level;
  /** Probability the issue is real (1 for deterministic checks). */
  confidence: number;
  basis: Basis;
  /** Where the finding applies: a product or a shop page. */
  subject: { type: 'product' | 'page'; id: string; title: string; url?: string };
  /** Text passages that triggered the rule, for the report. */
  evidence: string[];
  /** Extra detail specific to this finding (e.g. "Menge: 500 g"). */
  note?: string;
  /** 'modell' when Jev chose the quoted sentence; otherwise keyword passages. */
  quoteBasis?: 'modell';
  /**
   * Added or downgraded by the two-model second opinion – or removed by it, which
   * only findings in `ScanReport.removedFindings` are.
   */
  secondJudge?: 'added' | 'downgraded' | 'removed';
}

export interface ScanStats {
  products: number;
  decisions: number;
  inputTokens: number;
  costUsd: number;
  errors: number;
  durationMs: number;
}

export interface ScanReport {
  id: string;
  origin: string;
  platform: ShopSnapshot['platform'];
  createdAt: string;
  mode: 'jev' | 'demo';
  model: string;
  /** How product pages were checked; missing in reports from before this existed. */
  pageCheck?: 'browser' | 'static';
  truncated: boolean;
  findings: Finding[];
  stats: ScanStats;
  errors: string[];
  // Optional for reports saved before coverage existed.
  coverage?: ScanCoverage;
  /** The two-model second opinion, when it ran. `coverage` stays the scan's own. */
  secondJudge?: SecondJudgeSummary;
  /**
   * Findings the second opinion removed. Not shown to the merchant;
   * kept here and in the CSV export, marked `secondJudge: 'removed'`. `findings` holds only what the merchant sees.
   */
  removedFindings?: Finding[];
  /** Detailed pipeline outcomes, included only when tracing is requested. */
  checks?: RuleCheck[];
}

/** What the two-model second opinion ("veto+t") did to a scan. */
export interface SecondJudgeSummary {
  models: string[];
  requests: number;
  costUsd: number;
  /** The cost cap per scan. */
  maxUsd: number;
  durationMs: number;
  /** Products in the scan; judged by both models; in a batch whose request failed twice; left out at the cost cap. */
  products: number;
  judged: number;
  failed: number;
  overCap: number;
  /** Products sent without page excerpts, because their page was not rendered. */
  withoutPage: number;
  dropped: number;
  downgraded: number;
  added: number;
  /** `why` – both models' reasons, joined by " | ". */
  changes: { productId: string; ruleId: string; change: 'dropped' | 'downgraded' | 'added'; level: Level; why?: string }[];
  /** The key was refused (HTTP 401, 402 or 403); later batches were not sent. */
  stoppedBy?: string;
}

// Observed stages, not inferred causes or legal verdicts.
export type CheckOutcome = 'not-triggered' | 'below-threshold' | 'preparation-error' | 'decision-error' | 'page-dismissed' | 'page-inconclusive' | 'finding';
export interface RuleCheck {
  subjectId: string;
  subjectType: 'product' | 'page';
  ruleId: string;
  input: 'feed' | 'page' | 'metadata';
  inputChars: number;
  questionKeys: string[];
  outcome: CheckOutcome;
  reviewThreshold: number;
  score?: number;
  page: 'not-needed' | 'static' | 'rendered' | 'unavailable' | 'render-failed';
  incomplete: boolean;
  level?: Level;
}

export interface ScanCoverage {
  products: number;
  productRuleChecks: number;
  outcomes: Record<CheckOutcome, number>;
  incompleteProducts: number;
  incompleteRuleIds: string[];
  missingDescriptions: number;
  recoveredDescriptions: number;
  pageLoads: { attempted: number; failed: number };
  /** `reasons` – why browser loads failed, e.g. { "HTTP 429": 20 }. */
  browserLoads: { attempted: number; failed: number; reasons?: Record<string, number> };
  unreachableShopPages: number;
  productFindings: number;
  riskFindings: number;
  /** Unweighted share of product findings at Risiko; null when there are no findings. */
  riskShare: number | null;
}
