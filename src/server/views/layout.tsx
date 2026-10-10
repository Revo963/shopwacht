import type { Child } from 'hono/jsx';

export function Layout(props: { title: string; description?: string; children: Child; head?: Child; bodyClass?: string }) {
  return (
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        {props.description ? <meta name="description" content={props.description} /> : null}
        <meta name="theme-color" content="#ffd500" />
        <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
        <link rel="preload" href="/static/fonts/barlow-semicondensed-800.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="stylesheet" href="/static/app.css" />
        {props.head}
        <script src="/static/app.js" defer></script>
      </head>
      <body class={props.bodyClass}>
        {props.children}
        <SiteFooter />
      </body>
    </html>
  );
}

export function Masthead(props: { children?: Child }) {
  return (
    <header class="masthead">
      <a class="wordmark" href="/" aria-label="ShopWacht – Startseite">
        ShopWacht
      </a>
      <nav class="masthead__nav" aria-label="Hauptnavigation">
        {props.children}
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer class="site-footer">
      <p class="site-footer__disclaimer">
        <strong>Keine Rechtsberatung.</strong> ShopWacht ist eine automatisierte Vorprüfung öffentlich sichtbarer Shop-Inhalte. Sie ersetzt keine
        anwaltliche Prüfung und garantiert nicht, dass ein Shop abmahnsicher ist.
      </p>
    </footer>
  );
}

/** "https://www.shop.de" → "shop.de"; CSV names pass through. */
export function displayName(origin: string): string {
  if (origin.startsWith('CSV: ')) return origin.slice(5);
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin;
  }
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}
