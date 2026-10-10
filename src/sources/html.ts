import { parse, type HTMLElement } from 'node-html-parser';

const DROP = 'script, style, noscript, svg, template, iframe';

export function htmlToText(html: string): string {
  if (!html) return '';
  // The parser would keep "<!doctype html>" as literal text.
  const root = parse(html.replace(/<!doctype[^>]*>/i, ''));
  root.querySelectorAll(DROP).forEach((el) => el.remove());
  return tidy(root.structuredText);
}

const MAIN = 'main, [role="main"], #MainContent, #main-content, #main';

/**
 * Text of the page's main content, without header, menus, cookie banners and footer.
 * Legal pages carry thousands of characters of navigation before the actual text.
 */
// Product recovery must not substitute menus for missing content.
export function mainText(html: string, scope: 'page' | 'product' = 'page'): string {
  if (!html) return '';
  const root = parse(html.replace(/<!doctype[^>]*>/i, ''));
  root.querySelectorAll(DROP).forEach((el) => el.remove());
  const main = (scope === 'product' ? root.querySelector('.main-product') : null) ?? root.querySelector(MAIN);
  if (scope === 'product') {
    if (!main) return '';
    main.querySelectorAll('nav, footer, product-recommendations, .product-recommendations, [data-product-recommendations]').forEach((el) => el.remove());
    return tidy(main.structuredText);
  }
  const text = tidy((main ?? root).structuredText);
  // A theme whose <main> is nearly empty (content rendered elsewhere): fall back to the whole page.
  return main && text.length >= 200 ? text : tidy(root.structuredText);
}

export interface Link {
  text: string;
  href: string;
}

export function extractLinks(html: string, base: string): Link[] {
  const root = parse(html);
  const out: Link[] = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const href = resolve(a.getAttribute('href') ?? '', base);
    if (!href) continue;
    out.push({ text: tidy(linkText(a)), href });
  }
  return out;
}

function linkText(a: HTMLElement): string {
  return a.text || a.getAttribute('aria-label') || a.getAttribute('title') || '';
}

function resolve(href: string, base: string): string | null {
  if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function tidy(text: string): string {
  return decodeEntities(text)
    .replace(/[\t   ]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', shy: '' };

/** Decodes the entities that matter for our checks (&euro;, &nbsp;, numeric); leaves unknown ones as-is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n === 160 ? 32 : n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}
