// The EU list of permitted health claims as reference data for Jev.
// Jev does not know the register by heart; given the authorised wordings for the nutrients a text
// names, it only has to judge whether each statement is one of them or means the same.
// Data: src/rules/data/health-claims.json, built by tools/import-health-claims.ts from EUR-Lex.

import { readFileSync } from 'node:fs';

interface RegisterClaim {
  nutrient: string;
  claim: string;
  conditions: string;
  restrictions: string;
}

const REGISTER = JSON.parse(readFileSync(new URL('./data/health-claims.json', import.meta.url), 'utf8')) as {
  source: string;
  claims: RegisterClaim[];
};

// How shops name the substances. Keys are the register's names (prefix match on the register entry).
const ALIASES: [RegExp, string[]][] = [
  [/vitamin\s?a(?![\p{L}\d])|retinol|beta-?carotin/iu, ['Vitamin A']],
  [/vitamin\s?b\s?1(?!\d)|thiamin/iu, ['Thiamin']],
  [/vitamin\s?b\s?2|riboflavin/iu, ['Riboflavin']],
  [/vitamin\s?b\s?3|niacin|nicotinamid/iu, ['Niacin']],
  [/vitamin\s?b\s?5|pantothen/iu, ['Pantothensäure']],
  [/vitamin\s?b\s?6|pyridoxin|(?<![\p{L}\d])b6(?!\d)/iu, ['Vitamin B6']],
  [/vitamin\s?b\s?7|biotin/iu, ['Biotin']],
  [/vitamin\s?b\s?9|fol(?:at|säure|ic)|methylfolat/iu, ['Folat']],
  [/vitamin\s?b\s?12|cobalamin|(?<![\p{L}\d])b12(?!\d)/iu, ['Vitamin B12']],
  [/vitamin\s?c(?![\p{L}\d])|ascorbin/iu, ['Vitamin C']],
  // Shops write "D3+K2", "B12 Spray".
  [/vitamin\s?d\s?3?(?![\p{L}\d])|cholecalciferol|sonnenvitamin|(?<![\p{L}\d])d3(?!\d)/iu, ['Vitamin D']],
  [/vitamin\s?e(?![\p{L}\d])|tocopherol/iu, ['Vitamin E']],
  [/vitamin\s?k\s?[12]?(?![\p{L}\d])|menachinon|menaquinon|phyllochinon|(?<![\p{L}\d])k[12](?!\d)/iu, ['Vitamin K']],
  [/calcium|kalzium/iu, ['Calcium']],
  [/magnesium/iu, ['Magnesium']],
  [/(?<![\p{L}])eisen(?!bahn|werk|hut)|(?<![\p{L}])iron(?![\p{L}])/iu, ['Eisen']],
  [/zink|zinc/iu, ['Zink']],
  [/(?<![\p{L}])selen(?:ium)?(?![\p{L}])/iu, ['Selen']],
  [/(?<![\p{L}])jod(?![\p{L}])|jodid|iodine/iu, ['Jod']],
  [/kupfer|copper/iu, ['Kupfer']],
  [/(?<![\p{L}])mangan(?![\p{L}])/iu, ['Mangan']],
  [/(?<![\p{L}])chrom(?:ium)?(?![\p{L}])/iu, ['Chrom']],
  [/molybdän/iu, ['Molybdän']],
  [/kalium|potassium/iu, ['Kalium']],
  [/phosphor(?!e)/iu, ['Phosphor']],
  [/fluorid/iu, ['Fluorid']],
  [/protein|eiweiß|whey|casein/iu, ['Proteine']],
  [/kreatin|creatin/iu, ['Kreatin']],
  [/melatonin/iu, ['Melatonin']],
  [/omega-?3|(?<![\p{L}])dha(?![\p{L}])|(?<![\p{L}])epa(?![\p{L}])|docosahexaen|eicosapentaen|fischöl|algenöl|krillöl/iu, ['Docosahexaensäure', 'Eicosapentaensäure']],
  [/alpha-?linolen|(?<![\p{L}])ala(?![\p{L}])|leinöl|leinsamen/iu, ['Alpha-Linolensäure']],
  [/linolsäure/iu, ['Linolsäure']],
  [/elektrolyt|electrolyte/iu, ['Kohlenhydrat-Elektrolyt-Lösungen']],
  [/kohlenhydrat|carbs|dextrin|maltodextrin|dextrose/iu, ['Kohlenhydrat']],
  [/beta-?glucan/iu, ['Beta-Glucane']],
  [/glucomannan|konjak/iu, ['Glucomannan']],
  [/inulin|zichorie|chicor/iu, ['Natives Zichorieninulin']],
  [/pektin/iu, ['Pektine']],
  [/guarkern|guar gum/iu, ['Guarkernmehl']],
  [/weizenkleie/iu, ['Weizenkleie']],
  [/roggen/iu, ['Roggen-Ballaststoffe']],
  [/haferkleie|haferballast|beta-?glucan aus hafer/iu, ['Haferkorn-Ballaststoffe', 'Beta-Glucane aus Hafer']],
  [/gerste/iu, ['Gerstenkorn-Ballaststoffe']],
  [/resistente stärke/iu, ['Resistente Stärke']],
  [/joghurtkultur|lebende kulturen/iu, ['Lebende Joghurtkulturen']],
  [/lactase|laktase/iu, ['Lactase']],
  [/kakaoflavanol|kakao-flavanol/iu, ['Kakaoflavanole']],
  [/olivenöl-?polyphenol|hydroxytyrosol/iu, ['Olivenöl-Polyphenole']],
  [/walnuss|walnüss/iu, ['Walnüsse']],
  [/phytosterin|phytostanol|pflanzensterin/iu, ['Phytosterine']],
  [/(?<![\p{L}])betain/iu, ['Betain']],
  [/(?<![\p{L}])cholin(?![\p{L}])/iu, ['Cholin']],
  [/chitosan/iu, ['Chitosan']],
  [/aktivkohle/iu, ['Aktivkohle']],
  [/mahlzeitersatz|mahlzeit-ersatz/iu, ['Mahlzeitersatz']],
  [/pflaume/iu, ['Getrocknete Pflaumen']],
  [/kiwi/iu, ['Grüne Kiwifrüchte']],
];

// A sentence that is itself an authorised claim ("Vitamin B6 trägt zur Regulierung der
// Hormontätigkeit bei") for a substance it names is no evidence of an unauthorised one. Jev judged such sentences together with
// the rest of the text and flagged 38 products on the bench whose labels found nothing wrong. Matching is by the claim's content
// words (word stems), so "tragen zu einer normalen Funktion des Immunsystems bei" matches; a paraphrase ("unterstützt dein
// Immunsystem") does not and is still judged by Jev. A wrong pairing ("Vitamin B12 … Muskelmasse") never matches.
const CLAIM_FRAME = new Set(['trägt', 'tragen', 'dazu', 'einer', 'einem', 'eines', 'einen', 'eine', 'normalen', 'normale', 'normaler', 'normales', 'erhaltung', 'aufrechterhaltung', 'funktion', 'bei', 'zur', 'zum', 'des', 'der', 'die', 'das', 'dem', 'den', 'und', 'von', 'für', 'mit', 'hat', 'wird', 'werden', 'benötigt', 'sich']);
const STRONGER = /(?<![\p{L}])(?:heil\p{L}*|lindert|linderung|schützt vor|gegen(?![\p{L}])|stärkt|stärkung|steigert|verbessert|bekämpft|verhindert|beugt|vorbeug\p{L}*|optimal\p{L}*|maximal\p{L}*|entgift\p{L}*|detox)/iu;
// The register's own phrasing; a loose mention ("Proteine sind … in unseren Muskeln und Knochen") is no claim in its wording.
const CLAIM_WORDING = /(?<![\p{L}])(?:trägt|tragen|beiträgt|beitragen)(?![\p{L}])[^.!?]{0,160}?(?<![\p{L}])bei(?![\p{L}])|(?<![\p{L}])(?:hat|haben) eine (?:rolle|funktion) bei|(?<![\p{L}])(?:wird|werden) für [^.!?]{3,80}? benötigt|(?<![\p{L}])erhöht die (?:eisen|calcium)aufnahme/iu;
const stem = (w: string) => w.toLowerCase().normalize('NFC').slice(0, 6);
const words = (s: string) => s.toLowerCase().match(/\p{L}+/gu) ?? [];

function contentStems(claim: string, nutrient: string): string[] {
  const name = new Set(words(nutrient).map(stem));
  return [...new Set(words(claim).filter((w) => w.length >= 4 && !CLAIM_FRAME.has(w)).map(stem).filter((s) => !name.has(s)))];
}

const CLAIM_STEMS = REGISTER.claims.map((c) => ({ nutrient: c.nutrient, stems: contentStems(c.claim, c.nutrient) })).filter((c) => c.stems.length > 0);

/**
 * The word stems of the authorised claims a sentence states in register wording for a substance it names (null if none, or if
 * it promises something stronger). Callers check that every health word of the sentence is among them, so an added promise in
 * the same sentence ("… bei¹ – so unterstützt CORVIA Herz und Gefäße") is not waved through.
 */
export function authorisedClaimStems(sentence: string): Set<string> | null {
  if (STRONGER.test(sentence) || !CLAIM_WORDING.test(sentence)) return null;
  const names = new Set(ALIASES.filter(([re]) => re.test(sentence)).flatMap(([, n]) => n));
  if (names.size === 0) return null;
  const present = new Set(words(sentence).map(stem));
  const hit = CLAIM_STEMS.filter((c) => [...names].some((n) => c.nutrient.startsWith(n)) && c.stems.every((s) => present.has(s)));
  return hit.length ? new Set(hit.flatMap((c) => c.stems)) : null;
}

/** True if the sentence names a substance and states one of that substance's authorised claims, with nothing stronger added. */
export function isAuthorisedClaimSentence(sentence: string): boolean {
  return authorisedClaimStems(sentence) !== null;
}

/** Stem used for comparing a sentence's health words with a claim's words. */
export const claimStem = stem;

// "…die Mindestanforderungen an eine Vitamin-C-Quelle…": the same condition for every vitamin and mineral.
const GENERIC_CONDITION = /^Die Angabe darf nur für Lebensmittel verwendet werden, die (?:mindestens )?die Mindestanforderungen an eine/;

/**
 * The authorised claims for the substances a text names, as short lines for Jev: "Vitamin C: … [Bedingung: …]".
 * Cap 150 (was 80): multi-nutrient bundles name up to about 110 claims, and a cut in
 * register order dropped the later substances (all seven vitamin D claims for a kids' immune bundle).
 */
export function authorisedClaimsFor(text: string, max = 150): string[] {
  const names = new Set(ALIASES.filter(([re]) => re.test(text)).flatMap(([, n]) => n));
  if (names.size === 0) return [];
  const out: string[] = [];
  for (const c of REGISTER.claims) {
    if (![...names].some((n) => c.nutrient.startsWith(n))) continue;
    const condition = c.conditions && !GENERIC_CONDITION.test(c.conditions) ? ` [Bedingung: ${c.conditions.slice(0, 220)}${c.conditions.length > 220 ? ' …' : ''}]` : '';
    out.push(`${c.claim}${condition}`);
    if (out.length >= max) break;
  }
  return out;
}
