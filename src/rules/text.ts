/**
 * Builds a case-insensitive, Unicode-aware regex that matches any of the given
 * patterns at a word start. JS `\b` is ASCII-only, so it fails before "ö" or "Ü".
 */
export function words(...patterns: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${patterns.join('|')})`, 'giu');
}

/** Same as `words`, but also matches inside compounds ("Kopfschmerzen", "Gelenkschmerz"). */
export function stems(...patterns: string[]): RegExp {
  return new RegExp(`(?:${patterns.join('|')})`, 'giu');
}

export function matches(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  const hit = re.test(text);
  // `matchAll` starts a copy at the original's lastIndex, so a regex left after a
  // hit made the next product's `text.matchAll(GREEN_GENERIC)` skip the start of its text.
  re.lastIndex = 0;
  return hit;
}

/** Returns up to `max` short passages around matches, for display in the report. */
export function evidence(text: string, re: RegExp, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const snippet = passage(text, m.index, m[0].length);
    if (seen.has(snippet)) continue;
    seen.add(snippet);
    out.push(snippet);
    if (out.length >= max) break;
  }
  return out;
}

const BOUNDARY = /[.!?\n•|]/;

export function passage(text: string, index: number, length: number, radius = 110): string {
  let start = index;
  while (start > 0 && index - start < radius && !BOUNDARY.test(text[start - 1] ?? '')) start--;
  let end = index + length;
  while (end < text.length && end - index < radius && !BOUNDARY.test(text[end] ?? '')) end++;
  // A heading that ends in a colon ("✔ Ganzheitliche Wirkung:") says nothing by
  // itself – the promise is on the next line. One shop's scan quoted the bare heading 28 times.
  if (text[end] === '\n' && /:\s*$/.test(text.slice(start, end))) {
    end++;
    while (end < text.length && /\s/.test(text[end] ?? '')) end++;
    const from = end;
    while (end < text.length && end - from < radius && !BOUNDARY.test(text[end] ?? '')) end++;
  }
  if (end < text.length && /[.!?]/.test(text[end] ?? '')) end++;
  const cut = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 && !BOUNDARY.test(text[start - 1] ?? '') ? '… ' : '';
  const suffix = end < text.length && !BOUNDARY.test(text[end - 1] ?? '') ? ' …' : '';
  return prefix + cut + suffix;
}

/**
 * Notices the law requires on supplements (§ 4 Abs. 2 NemV, Art. 10 Abs. 2 HCVO): never a claim.
 * Shared with the sentence choice.
 */
export const MANDATORY_NOTICE =
  /kein(?:en)? Ersatz für eine (?:ausgewogene|abwechslungsreiche|vielfältige)|(?:abwechslungsreiche|ausgewogene|vielfältige)[^.!?\n]{0,60}Ernährung (?:sowie|und) (?:eine[rn]? )?gesunde[rn]? Lebensweise|empfohlene (?:tägliche )?Verzehrsmenge darf nicht|außerhalb der Reichweite (?:von )?(?:kleinen )?Kindern/iu;

/** Keeps the model input focused: Jev degrades on long, irrelevant state. */
export function clip(text: string, max = 6000): string {
  return text.length <= max ? text : `${text.slice(0, max)} …`;
}
