import type { Product, ShopPage, ShopSnapshot } from '../types.js';
import { extractLinks, htmlToText, mainText, type Link } from './html.js';
import { FetchError, RedirectLimitError, normalizeShopUrl, type Fetcher, type FetchResult } from './http.js';

const PAGE_SIZE = 250;

// Only an absent Shopify feed permits trying another public shop source.
export class UnsupportedShopifyFeed extends FetchError {}

interface ShopifyVariant {
  title?: string;
  price?: string | number | null;
  compare_at_price?: string | number | null;
}

interface ShopifyProduct {
  id: number | string;
  title?: string;
  handle?: string;
  body_html?: string | null;
  product_type?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
}

export async function loadShopify(
  input: string,
  fetcher: Fetcher,
  opts: { maxProducts: number; onProgress?: (loaded: number) => void },
): Promise<ShopSnapshot> {
  const start = normalizeShopUrl(input);
  const home = await fetcher.get(`${start}/`);
  const origin = new URL(home.url).origin;
  if (new URL(home.url).pathname.startsWith('/password')) {
    throw new FetchError('Der Shop ist passwortgeschützt und kann nicht geprüft werden.');
  }

  const products: Product[] = [];
  let truncated = false;
  for (let page = 1; products.length < opts.maxProducts; page++) {
    const batch = await fetchProductPage(fetcher, origin, page);
    for (const raw of batch) {
      if (products.length >= opts.maxProducts) {
        truncated = true;
        break;
      }
      products.push(mapProduct(raw, origin));
    }
    opts.onProgress?.(products.length);
    if (batch.length < PAGE_SIZE) break;
    if (products.length >= opts.maxProducts) truncated = true;
  }

  const homeLinks = home.status < 400 ? extractLinks(home.body, home.url) : [];
  const pages: ShopPage[] = [];
  if (home.status < 400) pages.push({ kind: 'home', url: home.url, html: home.body, text: htmlToText(home.body) });
  const unreachable: ShopSnapshot['unreachable'] = [];
  // products.json can succeed while the homepage is unavailable.
  if (home.status >= 400) unreachable.push({ kind: 'home', url: home.url });
  for (const spec of LEGAL_PAGES) {
    const result = await loadLegalPage(fetcher, origin, homeLinks, spec);
    if (result && 'page' in result) pages.push(result.page);
    else if (result) unreachable.push({ kind: spec.kind, url: result.unreachable });
  }

  const storefront = home.status < 400 ? storefrontOf(home.body) : undefined;
  return { origin, platform: 'shopify', products, pages, homeLinks, truncated, unreachable, ...(storefront ? { storefront } : {}) };
}

/** The language and currency a Shopify homepage declares, if it declares them. */
export function storefrontOf(html: string): ShopSnapshot['storefront'] {
  const language = /<html\b[^>]*\blang=["']?([a-z]{2,3})/i.exec(html)?.[1]?.toLowerCase();
  const currency = /Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1];
  return language || currency ? { ...(language ? { language } : {}), ...(currency ? { currency } : {}) } : undefined;
}

async function fetchProductPage(fetcher: Fetcher, origin: string, page: number): Promise<ShopifyProduct[]> {
  let res: FetchResult;
  try {
    res = await fetcher.get(`${origin}/products.json?limit=${PAGE_SIZE}&page=${page}`, 'application/json');
  } catch (error) {
    // Only a looping first feed means Shopify was not established.
    if (page === 1 && error instanceof RedirectLimitError) {
      throw new UnsupportedShopifyFeed(
        'Kein Shopify-Shop erkannt. Unterstützt werden aktuell Shopify-Shops per Adresse und alle anderen Shopsysteme per CSV-Export.',
      );
    }
    throw error;
  }
  // A 429 is temporary, including on later pages; never return a silently partial catalog.
  if (res.status === 429) {
    throw new FetchError('Der Shop erhält zu viele Anfragen (HTTP 429). Bitte versuchen Sie es später erneut.', 429);
  }
  if (res.status >= 500) throw new FetchError('Der Produktkatalog ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.', res.status);
  let data: { products?: ShopifyProduct[] } | undefined;
  try {
    data = JSON.parse(res.body) as { products?: ShopifyProduct[] };
  } catch {
    data = undefined;
  }
  if (res.status >= 400 || !Array.isArray(data?.products)) {
    if (page > 1) return [];
    throw new UnsupportedShopifyFeed(
      'Kein Shopify-Shop erkannt. Unterstützt werden aktuell Shopify-Shops per Adresse und alle anderen Shopsysteme per CSV-Export.',
      res.status,
    );
  }
  return data.products;
}

export function mapProduct(raw: ShopifyProduct, origin: string): Product {
  const tags = (Array.isArray(raw.tags) ? raw.tags : String(raw.tags ?? '').split(','))
    .map((t) => t.trim())
    .filter((t) => t && !t.includes(':'));
  return {
    id: String(raw.id),
    title: raw.title?.trim() || '(ohne Titel)',
    url: raw.handle ? `${origin}/products/${raw.handle}` : undefined,
    category: raw.product_type?.trim() || undefined,
    tags: tags.slice(0, 15),
    text: htmlToText(raw.body_html ?? ''),
    variants: (raw.variants ?? []).map((v) => ({
      title: v.title && v.title !== 'Default Title' ? v.title : '',
      price: toNumber(v.price),
      compareAtPrice: toNumber(v.compare_at_price),
    })),
  };
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

interface LegalPageSpec {
  kind: Exclude<ShopPage['kind'], 'home'>;
  /** Link text patterns, strongest first. */
  text: RegExp[];
  href: RegExp;
  /** Shopify's built-in policy page, used when the homepage has no link. */
  fallback: string;
}

export const LEGAL_PAGES: LegalPageSpec[] = [
  {
    kind: 'impressum',
    text: [/impressum/i, /imprint|legal notice|anbieterkennzeichnung/i],
    href: /impressum|imprint|legal-notice/i,
    fallback: '/policies/legal-notice',
  },
  {
    kind: 'widerruf',
    text: [/widerrufsbelehrung|widerrufsrecht/i, /^widerruf$|widerrufsbedingungen|rückgaberecht/i],
    href: /widerrufsbelehrung|widerrufsrecht|refund-policy|withdrawal/i,
    fallback: '/policies/refund-policy',
  },
  {
    kind: 'datenschutz',
    text: [/datenschutz/i, /privacy/i],
    href: /datenschutz|privacy/i,
    fallback: '/policies/privacy-policy',
  },
  {
    kind: 'agb',
    text: [/^agb$|allgemeine geschäftsbedingungen/i, /agb|terms/i],
    href: /agb|terms-of-service|geschaeftsbedingungen/i,
    fallback: '/policies/terms-of-service',
  },
];

export function findLegalLink(links: Link[], spec: LegalPageSpec, origin: string): string | undefined {
  const site = new URL(origin).hostname.replace(/^www\./, '');
  const own = links.filter((l) => new URL(l.href).hostname.replace(/^www\./, '').endsWith(site));
  for (const re of spec.text) {
    const hit = own.find((l) => re.test(l.text));
    if (hit) return hit.href;
  }
  return own.find((l) => spec.href.test(new URL(l.href).pathname))?.href;
}

type LegalResult = { page: ShopPage } | { unreachable: string } | null;

/**
 * A page counts as missing only if the homepage has no link to it and Shopify's
 * built-in policy URL answers "not found". Rate limits and server errors mean
 * "could not check", never "missing".
 */
export async function loadLegalPage(fetcher: Fetcher, origin: string, links: Link[], spec: LegalPageSpec): Promise<LegalResult> {
  const link = findLegalLink(links, spec, origin);
  const candidates = [link, `${origin}${spec.fallback}`].filter((u): u is string => !!u);
  let unreachable: string | undefined;
  for (const url of candidates) {
    try {
      const res = await fetcher.get(url);
      if (res.status === 404 || res.status === 410) continue;
      if (res.status >= 400) {
        unreachable ??= url;
        continue;
      }
      if (!res.contentType.includes('html')) continue;
      const text = mainText(res.body);
      if (text.length < 80) continue;
      return { page: { kind: spec.kind, url: res.url, html: res.body, text } };
    } catch {
      unreachable ??= url;
    }
  }
  if (link) unreachable ??= link;
  return unreachable ? { unreachable } : null;
}
