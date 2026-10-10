import { AveragingProvider } from './decisions/averaging.js';
import { DemoProvider } from './decisions/demo.js';
import { JevProvider } from './decisions/jev.js';
import { SecondJudge, type SecondJudgeOptions } from './scan/second-judge.js';
import type { DecisionProvider } from './decisions/types.js';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file — rely on the real environment
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: num('PORT', 3000),
  maxProducts: num('MAX_PRODUCTS', 250),
  /** Scans the web app runs at the same time. */
  maxActiveScans: Math.max(1, Math.floor(num('MAX_ACTIVE_SCANS', 1))),
  riskThreshold: num('RISK_THRESHOLD', 0.7),
  reviewThreshold: num('REVIEW_THRESHOLD', 0.4),
  /** Parallel Jev calls; the provider itself spaces request starts. */
  concurrency: num('CONCURRENCY', 8),
  /** How product pages are checked: headless Chrome ("browser"), plain HTML ("static"), or browser if available ("auto"). */
  pageCheck: (['browser', 'static'].includes(process.env.PAGE_CHECK ?? '') ? process.env.PAGE_CHECK : 'auto') as 'auto' | 'browser' | 'static',
  /**
   * Product pages open in the browser at the same time. More puts more load on the shop and can make it throttle.
   */
  pageConcurrency: num('PAGE_CONCURRENCY', 3),
};

/**
 * The two-model second opinion ("veto+t") after the scan; SECOND_JUDGE_MAX_USD caps its
 * cost per scan (default 0.30 $). On whenever an OpenRouter key is set, SECOND_JUDGE=off switches it off.
 * `overrides` lets a test record and replay the models' answers (`fetch`).
 */
export function createSecondJudge(overrides: Partial<SecondJudgeOptions> = {}): SecondJudge | undefined {
  if (process.env.SECOND_JUDGE === 'off' || !process.env.OPENROUTER_API_KEY) return undefined;
  return new SecondJudge({ apiKey: process.env.OPENROUTER_API_KEY, maxUsd: num('SECOND_JUDGE_MAX_USD', 0.3), ...overrides });
}

export function createProvider(): DecisionProvider {
  const model = process.env.JEV_MODEL || undefined;
  // Jev is asked n times per request and the probabilities are averaged – three by
  // default (about 12 instead of 4 cents per shop; an identical single rerun flipped about 20 findings on the test products,
  // and the thresholds were measured on averaged answers). JEV_AVERAGE=1 asks once.
  const average = Math.max(1, Math.round(num('JEV_AVERAGE', 3)));
  const averaged = (p: DecisionProvider) => (average > 1 ? new AveragingProvider(p, average) : p);
  if (process.env.OPENROUTER_API_KEY) {
    return averaged(new JevProvider({ apiKey: process.env.OPENROUTER_API_KEY, via: 'openrouter', model }));
  }
  if (process.env.TYPESAFE_API_KEY) {
    return averaged(new JevProvider({ apiKey: process.env.TYPESAFE_API_KEY, via: 'typesafe', model }));
  }
  return new DemoProvider();
}
