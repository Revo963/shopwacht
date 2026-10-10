// The shop's own catalogue as evidence for multipack prices.
// A crossed-out price is a multipack saving only if it equals n × the *current* single price; Commission Guidance
// 2021/C 526/02 (section 3) puts such multi-buys outside Art. 6a PID. Price endings (…,99 / …,90) guess at that and guess
// wrong both ways; the shop's own single product answers it.

import type { Product } from '../types.js';

export interface CatalogueItem {
  id: string;
  title: string;
  variants: { title: string; price: number | null | undefined }[];
}

export interface Catalogue {
  /** Normalised product name → the single products of that name and their current prices. */
  byName: Map<string, { id: string; prices: number[] }[]>;
}

const cents = (x: number) => Math.round(x * 100);
const COUNT = /(?<![\p{L}\p{N}.,])(\d{1,2})\s*[x×](?![\p{L}])/gu;
const PLUS = /(?<![\p{L}\p{N}.,])(\d{1,2})\s*\+\s*(\d{1,2})(?![\p{L}\p{N}])/gu;
const WORD_COUNTS: [RegExp, number][] = [
  [/(?<![\p{L}])(?:doppel|zweier)[- ]?pack\p{L}*/iu, 2],
  [/(?<![\p{L}])dreier[- ]?pack\p{L}*/iu, 3],
];
const ER_PACK = /(?<![\p{L}\p{N}])(\d{1,2})er[- ](?:pack|packung|set|box)(?![\p{L}])/giu;

/** "Magic Brew (2 x 370g)" → name "magic brew", counts [2]. Counts are the pack sizes the title states. */
export function packName(title: string): { name: string; counts: number[] } {
  const t = title.toLowerCase().normalize('NFC');
  const counts = new Set<number>();
  for (const m of t.matchAll(PLUS)) counts.add(Number(m[1]) + Number(m[2]));
  for (const m of t.replace(PLUS, ' ').matchAll(COUNT)) counts.add(Number(m[1]));
  for (const m of t.matchAll(ER_PACK)) counts.add(Number(m[1]));
  for (const [re, n] of WORD_COUNTS) if (re.test(t)) counts.add(n);
  const name = t
    .replace(/\([^)]*\d[^)]*\)/g, ' ')
    .replace(PLUS, ' ')
    .replace(COUNT, ' ')
    .replace(ER_PACK, ' ')
    .replace(/(?<![\p{L}])(?:doppel|zweier|dreier)[- ]?pack\p{L}*|(?<![\p{L}])multipack:?/giu, ' ')
    .replace(/(?<![\p{L}])je\s+\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l)(?![\p{L}])/giu, ' ')
    .replace(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l)(?![\p{L}])/giu, ' ')
    .replace(/[^\p{L}\p{N}+&\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, counts: [...counts].filter((n) => n >= 2).sort((a, b) => a - b) };
}

export function buildCatalogue(items: CatalogueItem[]): Catalogue {
  const byName = new Map<string, { id: string; prices: number[] }[]>();
  for (const item of items) {
    const { name, counts } = packName(item.title);
    // A product that is itself a pack is no single product.
    if (!name || counts.length > 0) continue;
    // Pack variants of a single product ("2x 370g") are no single price either.
    const prices = item.variants.filter((v) => v.price != null && v.price > 0 && packName(v.title).counts.length === 0).map((v) => v.price!);
    if (prices.length === 0) continue;
    byName.set(name, [...(byName.get(name) ?? []), { id: item.id, prices }]);
  }
  return { byName };
}

/**
 * "7-Tage Gemüse Saftkur + 8 gratis Carlo Carrot" shows
 * "Normaler Preis 229,20 €" at 190 € – 190 € plus 8 × 4,90 €, Carlo Carrot's current single price: a free-gift value comparison,
 * not a former price. The title or description names the free items ("+ 8 gratis Carlo Carrot", "gratis Brühe und
 * Fastentee"); each is priced from the shop's single products carrying its name, never from a bundle that names gifts itself;
 * the crossed-out price must be the current price plus n × those prices within 1 %. An item not sold singly cannot be priced.
 */
const GIFT = /(?<![\p{L}\p{N}])(?:(\d{1,2})\s*[x×]?\s*)?(?:gratis|kostenlose?n?|geschenkte?n?)[\s-]+([^\n+,;:!?()|–—]{2,60})/giu;
const NAMES_GIFT = /(?<![\p{L}])(?:gratis|kostenlos\p{L}*|geschenk\p{L}*)(?![\p{L}])/iu;
const nameWords = (s: string) => s.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && w !== 'bio');
/** "Shots" names the "Shot": plural endings only. */
const sameWord = (a: string, b: string) => {
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && /^(?:|s|e|n|en|es)$/u.test(long.slice(short.length));
};

function namedGifts(text: string): { n: number; name: string }[][] {
  return [...text.matchAll(GIFT)].map((m) =>
    m[2]!.split(/\s+(?:und|&)\s+/iu).map((part, i) => {
      const own = part.trim().match(/^(\d{1,2})\s*[x×]?\s+(.+)$/u);
      return own ? { n: Number(own[1]), name: own[2]! } : { n: i === 0 && m[1] ? Number(m[1]) : 1, name: part.trim() };
    }),
  );
}

function singlePrices(catalogue: Catalogue, name: string, own: string): number[] {
  const first = nameWords(name)[0];
  if (!first) return [];
  const prices = new Set<number>();
  for (const [title, singles] of catalogue.byName) {
    if (NAMES_GIFT.test(title) || !nameWords(title).some((w) => sameWord(first, w))) continue;
    for (const s of singles) if (s.id !== own) for (const price of s.prices) prices.add(price);
  }
  return [...prices];
}

export function freeGiftValueFromCatalogue(p: Product, v: Product['variants'][number], catalogue: Catalogue | undefined): boolean {
  if (!catalogue || v.price == null || v.compareAtPrice == null || v.compareAtPrice <= v.price) return false;
  const [price, was] = [v.price, v.compareAtPrice];
  return namedGifts(`${p.title}\n${p.text}`).some((gifts) => {
    let sums = [0];
    for (const { n, name } of gifts) sums = singlePrices(catalogue, name, p.id).flatMap((single) => sums.map((s) => s + n * single)).slice(0, 1000);
    return sums.some((s) => Math.abs(price + s - was) <= 0.01 * was);
  });
}

/**
 * true: the crossed-out price is n × the current price of the same product sold singly (another variant, or another product of
 * the same name); false: that single product exists but at another price, so the pack's crossed-out price is not n × it;
 * null: no single product to compare with.
 */
/**
 * A supply pack names no count –
 * „Shop5 Strawberry ohne Fluorid Jahresvorrat“, 35,50 € statt 47,70 € = 6 × 7,95 €, the current price of „Shop5
 * Zahnputztabletten Strawberry ohne Fluorid 125 Stk“. The single product is found by its name containing every other word of the
 * pack's title; the pack counts as a multipack only if its crossed-out price is exactly 2 to 12 times that single's current price.
 * Nothing found says nothing (null), so the other checks decide as before.
 */
const SUPPLY = /(?<![\p{L}])(?:halb)?jahresvorrat|(?<![\p{L}])(?:monats|quartals|wochen)vorrat|(?<![\p{L}])vorrats?pack(?:ung)?\p{L}*/giu;

function supplyPackFromCatalogue(p: Product, was: number, catalogue: Catalogue): true | null {
  if (!SUPPLY.test(p.title)) return null;
  SUPPLY.lastIndex = 0;
  const words = packName(p.title.replace(SUPPLY, ' ')).name.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  for (const [single, entries] of catalogue.byName) {
    const own = new Set(single.split(' '));
    if (!words.every((w) => own.has(w))) continue;
    for (const s of entries) {
      if (s.id === p.id) continue;
      for (const price of s.prices) {
        const n = was / cents(price);
        if (Number.isInteger(n) && n >= 2 && n <= 12) return true;
      }
    }
  }
  return null;
}

export function multipackFromCatalogue(p: Product, v: Product['variants'][number], catalogue: Catalogue | undefined): boolean | null {
  if (v.price == null || v.compareAtPrice == null) return null;
  const was = cents(v.compareAtPrice);
  // A variant "2x 500ml" next to a variant "500ml" of the same product.
  const ownCounts = packName(v.title).counts;
  if (ownCounts.length > 0) {
    const rest = v.title.toLowerCase().replace(COUNT, ' ').replace(/\s+/g, ' ').trim();
    for (const w of p.variants) {
      if (w === v || w.price == null || w.title.toLowerCase().replace(/\s+/g, ' ').trim() !== rest) continue;
      if (ownCounts.some((n) => was === n * cents(w.price!))) return true;
    }
  }
  if (!catalogue) return null;
  const { name, counts } = packName(p.title);
  if (counts.length === 0) return supplyPackFromCatalogue(p, was, catalogue);
  const singles = (catalogue.byName.get(name) ?? []).filter((s) => s.id !== p.id);
  if (singles.length === 0) return null;
  return singles.some((s) => s.prices.some((price) => counts.some((n) => was === n * cents(price))));
}
