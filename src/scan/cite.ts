// The report quoted what a keyword list matched, not what Jev objected to – on
// one shop's scan a guarantee banner ("Du und Deine Gesundheit stehen im Vordergrund!") was the "evidence" for
// 70 health findings. Jev writes no text but picks from up to 255 given options, so after a claim finding it is shown the
// product's own sentences and asked which one makes the claim. The verdict request is not touched; this is a second request.

import type { ChoiceQuestion } from '../decisions/types.js';
import type { Answers, ProductRule } from '../rules/types.js';
import { matches, MANDATORY_NOTICE } from '../rules/text.js';
import type { Product } from '../types.js';

/** Options per question, besides "none". Jev takes 255; fewer keep the request small and the choice focused. */
export const MAX_OPTIONS = 60;
const MIN_CHARS = 12;
const MAX_CHARS = 400;
/** A second sentence is quoted too when Jev gives it at least this probability. */
const SECOND = 0.3;

export interface Citation {
  key: string;
  question: ChoiceQuestion & { criteria: Record<string, string> };
  /** Keyword guess for demo mode: the first sentence with a trigger word. */
  hint: string;
}

// A sentence ends at . ! ? before a space – not after a single letter ("z. B.", "Vitamin C.") or a common abbreviation
// ("Deutschlands Nr. 1", "16 Mrd. Kulturen") – and after a footnote mark behind the full stop ("Energiehaushalt.* Unsere").
const ABBREVIATION = String.raw`\p{L}|nr|bspw|bzw|ca|mrd|mio|inkl|exkl|evtl|ggf|vgl|usw|std|max|min|mind|zzgl|gem|lt|tel`;
const SENTENCE_BREAK = new RegExp(
  String.raw`(?<=[.!?])(?<!(?<![\p{L}])(?:${ABBREVIATION})\.)\s+|(?<=\p{L}[.!?][\d*¹²³⁴⁵⁶⁷⁸⁹⁰,'’]{1,8})\s+|\n+|\s*[•|]\s+`,
  'iu',
);

/** The product name and its sentences, in order, without the notices the law requires and without repeats. */
export function sentencesOf(p: Product): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // A template heading ("✔ Ganzheitliche Wirkung:") says nothing by itself: it goes with the promise after it.
  const pieces: string[] = [];
  for (const piece of p.text.split(SENTENCE_BREAK)) {
    const last = pieces.at(-1);
    if (last !== undefined && /:\s*$/.test(last)) pieces[pieces.length - 1] = `${last} ${piece}`;
    else pieces.push(piece);
  }
  for (const raw of [p.title, ...pieces]) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s.length < MIN_CHARS && s !== p.title.trim()) continue;
    if (!/\p{L}{3}/u.test(s) || MANDATORY_NOTICE.test(s)) continue;
    const quote = s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)} …` : s;
    const k = quote.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(quote);
  }
  return out;
}

/** The sentence question for a claim rule, or null for rules that do not quote a claim. */
export function citationFor(rule: ProductRule, p: Product): Citation | null {
  if (!rule.cite) return null;
  const all = sentencesOf(p).filter((s, i) => i === 0 || !rule.citeSkip?.(s));
  if (all.length === 0) return null;
  // A long text is cut to MAX_OPTIONS: the name first, then the sentences with the rule's trigger words, then the rest in order.
  const hit = (s: string) => (rule.highlight ? matches(s, rule.highlight) : false);
  const picked = all.length <= MAX_OPTIONS ? all : [all[0]!, ...all.slice(1).filter(hit), ...all.slice(1).filter((s) => !hit(s))].slice(0, MAX_OPTIONS);
  const ordered = all.filter((s) => picked.includes(s));
  const criteria: Record<string, string> = {};
  ordered.forEach((s, i) => (criteria[`s${i + 1}`] = s));
  criteria.none = 'No sentence says this.';
  const first = ordered.findIndex(hit);
  return {
    key: `satz_${rule.id.replace(/-/g, '_')}`,
    question: {
      type: 'choice',
      instructions: `Which sentence of the product text contains ${rule.cite}? Pick the sentence that states it most directly. Answer "none" if no sentence does.`,
      criteria,
    },
    hint: first >= 0 ? `s${first + 1}` : 'none',
  };
}

/** The chosen sentence (and a close second), or null when Jev picked "none" or gave no usable answer. */
export function quotesFrom(answers: Answers, c: Citation): string[] | null {
  let choice: string;
  try {
    choice = answers.choice(c.key);
  } catch {
    return null;
  }
  if (choice === 'none' || !(choice in c.question.criteria)) return null;
  const quotes = [c.question.criteria[choice]!];
  const probabilities = answers.probabilities(c.key);
  if (probabilities) {
    const second = Object.entries(probabilities)
      .filter(([k]) => k !== choice && k !== 'none' && k in c.question.criteria)
      .sort((a, b) => b[1] - a[1])[0];
    if (second && second[1] >= SECOND) quotes.push(c.question.criteria[second[0]]!);
  }
  return quotes;
}
