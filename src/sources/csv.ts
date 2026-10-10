import { parse } from 'csv-parse/sync';
import type { Product, ShopSnapshot, Variant } from '../types.js';
import { htmlToText } from './html.js';

type Row = Record<string, string>;

/**
 * Reads product exports: Shopify's product CSV, WooCommerce's product CSV (German or
 * English headers) and simple custom sheets with title/description/price columns.
 */
export function loadCsv(content: string, name: string, maxProducts: number): ShopSnapshot {
  const rows = parseRows(content);
  if (rows.length === 0) throw new Error('Die CSV-Datei enthält keine Zeilen.');
  const headers = Object.keys(rows[0]!);
  const products = headers.includes('Handle') && headers.includes('Title') ? fromShopify(rows) : fromGeneric(rows, headers);
  if (products.length === 0) {
    throw new Error('Keine Produkte erkannt. Die CSV braucht mindestens eine Spalte für den Produktnamen (z. B. „Title“, „Name“, „Titel“).');
  }
  return {
    origin: `CSV: ${name}`,
    platform: 'csv',
    products: products.slice(0, maxProducts),
    pages: [],
    homeLinks: [],
    truncated: products.length > maxProducts,
    unreachable: [],
  };
}

function parseRows(content: string): Row[] {
  const firstLine = content.slice(0, content.indexOf('\n') >>> 0);
  const delimiter = [';', ',', '\t'].sort((a, b) => count(firstLine, b) - count(firstLine, a))[0]!;
  return parse(content, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    bom: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  }) as Row[];
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

function fromShopify(rows: Row[]): Product[] {
  const byHandle = new Map<string, Product>();
  for (const row of rows) {
    const handle = row.Handle?.trim();
    if (!handle) continue;
    let product = byHandle.get(handle);
    if (!product) {
      if (!row.Title?.trim()) continue;
      product = {
        id: handle,
        title: row.Title.trim(),
        category: (row.Type || row['Product Category'])?.trim() || undefined,
        tags: (row.Tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        text: htmlToText(row['Body (HTML)'] ?? ''),
        variants: [],
      };
      byHandle.set(handle, product);
    }
    const price = toNumber(row['Variant Price']);
    if (price == null) continue;
    const options = ['Option1 Value', 'Option2 Value', 'Option3 Value']
      .map((k) => row[k]?.trim())
      .filter((v) => v && v !== 'Default Title');
    product.variants.push({
      title: options.join(' / '),
      price,
      compareAtPrice: toNumber(row['Variant Compare At Price']),
      hasUnitPrice: !!row['Unit Price Total Measure']?.trim(),
    });
  }
  return [...byHandle.values()];
}

const COLUMN_ALIASES = {
  title: ['title', 'titel', 'name', 'produktname', 'product name', 'artikelname', 'bezeichnung'],
  text: [
    'description',
    'beschreibung',
    'body (html)',
    'body',
    'text',
    'produktbeschreibung',
    'langbeschreibung',
    'short description',
    'kurzbeschreibung',
    'material',
    'materialzusammensetzung',
    'zusammensetzung',
  ],
  price: ['sale price', 'angebotspreis', 'price', 'preis', 'verkaufspreis', 'regular price', 'regulärer preis'],
  regular: ['regular price', 'regulärer preis', 'compare at price', 'streichpreis', 'alter preis', 'uvp'],
  url: ['url', 'link', 'produkt-url', 'product url', 'permalink'],
  category: ['category', 'categories', 'kategorie', 'kategorien', 'type', 'produkttyp', 'warengruppe'],
  id: ['id', 'sku', 'artikelnummer', 'produkt-id', 'product id'],
} as const;

function fromGeneric(rows: Row[], headers: string[]): Product[] {
  const lower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const pick = (aliases: readonly string[]) => aliases.map((a) => lower.get(a)).filter((h): h is string => !!h);
  const col = Object.fromEntries(Object.entries(COLUMN_ALIASES).map(([k, a]) => [k, pick(a)])) as Record<keyof typeof COLUMN_ALIASES, string[]>;
  if (col.title.length === 0) return [];

  const first = (row: Row, keys: string[]) => keys.map((k) => row[k]?.trim()).find((v) => v);
  return rows.flatMap((row, i): Product[] => {
    const title = first(row, col.title);
    if (!title) return [];
    // WooCommerce: "Sale price" is the current price when set; otherwise "Regular price".
    const price = toNumber(first(row, col.price));
    const regular = toNumber(first(row, col.regular));
    const variant: Variant = {
      title: '',
      price,
      compareAtPrice: regular != null && price != null && regular > price ? regular : null,
    };
    const textParts = col.text.map((k) => row[k]?.trim()).filter((v): v is string => !!v);
    const url = first(row, col.url);
    return [
      {
        id: first(row, col.id) ?? String(i + 1),
        title,
        url: url && /^https?:\/\//i.test(url) ? url : undefined,
        category: first(row, col.category),
        tags: [],
        text: htmlToText([...new Set(textParts)].join('\n')),
        variants: [variant],
      },
    ];
  });
}

function toNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  // Accept "1.299,00", "1299.00", "12,99 €"
  let v = value.replace(/[^\d,.-]/g, '');
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
