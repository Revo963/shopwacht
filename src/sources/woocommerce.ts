// Public WooCommerce Store API adapter for the shared scan engine.
import type { Product, ShopPage, ShopSnapshot, Variant } from '../types.js';
import { extractLinks, htmlToText } from './html.js';
import { FetchError, normalizeShopUrl, type Fetcher } from './http.js';
import { LEGAL_PAGES, loadLegalPage } from './shopify.js';

const PAGE_SIZE = 100;
const API_PATH = '/wp-json/wc/store/v1/products';
const LEGAL_FALLBACKS: Record<Exclude<ShopPage['kind'], 'home'>, string> = {
  impressum: '/impressum/',
  widerruf: '/widerrufsbelehrung/',
  datenschutz: '/datenschutz/',
  agb: '/agb/',
};

interface StoreProduct {
  id: number | string;
  name?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  variation?: string;
  categories?: { name?: string }[];
  tags?: { name?: string }[];
  has_options?: boolean;
  is_password_protected?: boolean;
  on_sale?: boolean;
  prices?: {
    price?: string;
    regular_price?: string;
    currency_code?: string;
    currency_minor_unit?: number;
  };
}

export async function loadWooCommerce(
  input: string,
  fetcher: Fetcher,
  opts: { maxProducts: number; onProgress?: (loaded: number) => void },
): Promise<ShopSnapshot> {
  const start = normalizeShopUrl(input);
  const home = await fetcher.get(`${start}/`);
  const origin = new URL(home.url).origin;
  const rawProducts: StoreProduct[] = [];
  let truncated = false;
  for (let page = 1; rawProducts.length < opts.maxProducts; page++) {
    const batch = await fetchProducts(fetcher, origin, new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) }));
    for (const raw of batch) {
      if (raw.is_password_protected) continue;
      if (rawProducts.length >= opts.maxProducts) { truncated = true; break; }
      rawProducts.push(raw);
    }
    opts.onProgress?.(rawProducts.length);
    if (batch.length < PAGE_SIZE) break;
    if (rawProducts.length >= opts.maxProducts) { truncated = true; break; }
  }

  const products: Product[] = [];
  for (const raw of rawProducts) {
    const variants = raw.has_options ? await loadVariations(fetcher, origin, raw.id) : undefined;
    products.push(mapWooProduct(raw, origin, variants));
  }

  const homeLinks = home.status < 400 ? extractLinks(home.body, home.url) : [];
  const pages: ShopPage[] = home.status < 400
    ? [{ kind: 'home', url: home.url, html: home.body, text: htmlToText(home.body) }]
    : [];
  const unreachable: ShopSnapshot['unreachable'] = home.status >= 400 ? [{ kind: 'home', url: home.url }] : [];
  for (const spec of LEGAL_PAGES) {
    const result = await loadLegalPage(fetcher, origin, homeLinks, { ...spec, fallback: LEGAL_FALLBACKS[spec.kind] });
    if (result && 'page' in result) pages.push(result.page);
    else if (result) unreachable.push({ kind: spec.kind, url: result.unreachable });
  }
  const language = /<html\b[^>]*\blang=["']?([a-z]{2,3})/i.exec(home.body)?.[1]?.toLowerCase();
  const currency = rawProducts.find((p) => p.prices?.currency_code)?.prices?.currency_code;
  const storefront = language || currency ? { ...(language ? { language } : {}), ...(currency ? { currency } : {}) } : undefined;
  return { origin, platform: 'woocommerce', products, pages, homeLinks, truncated, unreachable, ...(storefront ? { storefront } : {}) };
}

async function fetchProducts(fetcher: Fetcher, origin: string, query: URLSearchParams): Promise<StoreProduct[]> {
  const url = `${origin}${API_PATH}?${query}`;
  const res = await fetcher.get(url, 'application/json');
  if (res.status === 429) throw new FetchError('Der Shop erhält zu viele Anfragen (HTTP 429). Bitte versuchen Sie es später erneut.', 429);
  let data: unknown;
  try { data = JSON.parse(res.body); } catch { /* HTML error pages are not catalogues. */ }
  if (res.status >= 400 || !Array.isArray(data)) {
    throw new FetchError('Kein öffentlicher WooCommerce-Produktkatalog erreichbar. Sie können stattdessen einen CSV-Export hochladen.', res.status);
  }
  return data as StoreProduct[];
}

async function loadVariations(fetcher: Fetcher, origin: string, parent: number | string): Promise<StoreProduct[]> {
  const variants: StoreProduct[] = [];
  for (let page = 1; ; page++) {
    const batch = await fetchProducts(fetcher, origin, new URLSearchParams({ type: 'variation', parent: String(parent), per_page: String(PAGE_SIZE), page: String(page) }));
    variants.push(...batch.filter((p) => !p.is_password_protected));
    if (batch.length < PAGE_SIZE) return variants;
  }
}

function mapWooProduct(raw: StoreProduct, origin: string, rawVariants?: StoreProduct[]): Product {
  const long = htmlToText(raw.description ?? '');
  const short = htmlToText(raw.short_description ?? '');
  const text = long.includes(short) ? long : [short, long].filter(Boolean).join('\n');
  const sameShopUrl = (url: string | undefined) => {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      const expected = new URL(origin);
      return parsed.protocol === expected.protocol && parsed.hostname.replace(/^www\./, '') === expected.hostname.replace(/^www\./, '') ? parsed.href : undefined;
    } catch { return undefined; }
  };
  return {
    id: String(raw.id),
    title: htmlToText(raw.name ?? '') || '(ohne Titel)',
    url: sameShopUrl(raw.permalink),
    category: raw.categories?.[0]?.name ? htmlToText(raw.categories[0].name) : undefined,
    tags: (raw.tags ?? []).map((t) => htmlToText(t.name ?? '')).filter(Boolean).slice(0, 15),
    text,
    variants: raw.has_options
      ? rawVariants?.length ? rawVariants.map(mapVariant) : [{ title: '', price: null, compareAtPrice: null }]
      : [mapVariant(raw)],
  };
}

function mapVariant(raw: StoreProduct): Variant {
  const price = amount(raw.prices?.price, raw.prices?.currency_minor_unit);
  const regular = amount(raw.prices?.regular_price, raw.prices?.currency_minor_unit);
  return {
    title: htmlToText(raw.variation ?? ''),
    price,
    compareAtPrice: raw.on_sale && regular != null && price != null && regular > price ? regular : null,
  };
}

function amount(raw: string | undefined, minorUnit: number | undefined): number | null {
  if (raw == null || raw === '' || !/^\d+$/.test(raw) || minorUnit == null || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 3) return null;
  const value = Number(raw) / 10 ** minorUnit;
  return Number.isFinite(value) ? value : null;
}
