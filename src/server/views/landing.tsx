import { ALL_RULES } from '../../rules/index.js';
import type { Level } from '../../types.js';
import { formatDay, Layout, Masthead } from './layout.js';
import { ArrowIcon, LevelMark, SeverityMark } from './marks.js';

export interface ScanFormProps {
  url?: string;
  error?: string;
  maxProducts: number;
  demo: boolean;
  /** Present where the user can enter their own key (a local run); says how the last attempt went. */
  apiKey?: { error?: string; saved?: boolean };
}

/** Where the user enters their OpenRouter key. A key is never shown, neither the stored nor a refused one. */
function KeyForm(props: { demo: boolean; error?: string; saved?: boolean }) {
  const form = (
    <form class="key-form" method="post" action="/schluessel">
      <label class="scan-form__label" for="api-key">
        OpenRouter-Schlüssel
      </label>
      <div class="scan-form__row">
        <input
          id="api-key"
          class="scan-form__input"
          name="key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          placeholder="sk-or-…"
          aria-describedby={props.error ? 'key-error' : 'key-help'}
          aria-invalid={props.error ? 'true' : undefined}
        />
        <button class="button button--primary" type="submit">
          Speichern
        </button>
      </div>
      {props.error ? (
        <p class="scan-form__error" id="key-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <p class="scan-form__limits" id="key-help">
        Einen Schlüssel gibt es unter{' '}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
          openrouter.ai/keys
        </a>
        , am besten mit Ausgabenlimit. Er bleibt auf diesem Rechner (Datei .env) und geht nur an OpenRouter.
      </p>
    </form>
  );
  if (props.demo) {
    return (
      <div class="key-box">
        <p class="scan-form__demo">Demo-Modus: Ohne Schlüssel sucht ShopWacht nur nach Stichwörtern, die Ergebnisse sind entsprechend grob. Für die KI-gestützte Prüfung den eigenen Schlüssel eintragen.</p>
        {form}
      </div>
    );
  }
  return (
    <details class="key-box" open={!!props.error}>
      <summary>{props.saved ? 'Schlüssel gespeichert, die KI-gestützte Prüfung ist aktiv.' : 'Die KI-gestützte Prüfung ist aktiv.'} Schlüssel ändern</summary>
      {form}
    </details>
  );
}

export function ScanForm(props: ScanFormProps) {
  return (
    <>
      <ScanAddressForm {...props} />
      {props.apiKey ? <KeyForm demo={props.demo} {...props.apiKey} /> : null}
    </>
  );
}

function ScanAddressForm(props: ScanFormProps) {
  return (
    <form class="scan-form" method="post" action="/pruefen" data-scan-form>
      <label class="scan-form__label" for="shop-url">
        Shop-Adresse
      </label>
      <div class="scan-form__row">
        <input
          id="shop-url"
          class="scan-form__input"
          name="url"
          type="text"
          inputmode="url"
          autocomplete="url"
          spellcheck={false}
          placeholder="ihr-shop.de"
          value={props.url ?? ''}
          aria-describedby={props.error ? 'scan-error' : 'scan-limits'}
          aria-invalid={props.error ? 'true' : undefined}
        />
        <button class="button button--primary" type="submit" data-submit>
          <span data-submit-label>Shop prüfen</span>
          <ArrowIcon />
        </button>
      </div>
      {props.error ? (
        <p class="scan-form__error" id="scan-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <p class="scan-form__limits" id="scan-limits">
        Shopify- und WooCommerce-Shops per Adresse. Bis zu {props.maxProducts} Produkte je Prüfung, ohne Anmeldung.
      </p>
      {props.demo && !props.apiKey ? (
        <p class="scan-form__demo">
          Demo-Modus: Ohne Schlüssel sucht ShopWacht nur nach Stichwörtern, die Ergebnisse sind entsprechend grob.
        </p>
      ) : null}
    </form>
  );
}

type Cell = Level | 'ok' | 'na';

const EXAMPLE_COLUMNS = ['Umweltaussagen', 'Heilversprechen', 'Grundpreis', 'Faserangabe'];
const EXAMPLE_ROWS: { product: string; cells: Cell[] }[] = [
  { product: 'Bambus-Zahnbürste, 4er-Set', cells: ['risiko', 'na', 'na', 'na'] },
  { product: 'Kurkuma-Kapseln, 120 Stück', cells: ['ok', 'risiko', 'pruefen', 'na'] },
  { product: 'Bio-Espresso, 500 g', cells: ['pruefen', 'ok', 'risiko', 'na'] },
  { product: 'Merino-Socken, 3 Paar', cells: ['ok', 'na', 'na', 'ok'] },
];
const CELL_LABEL: Record<Cell, string> = { risiko: 'Risiko', pruefen: 'Prüfen', ok: 'ohne Befund', na: 'nicht relevant' };

function ExampleTable() {
  return (
    <figure class="example" aria-labelledby="example-caption">
      <div class="example__quote">
        <p class="example__sentence">
          „Unsere Zahnbürste ist <mark class="hit">100 % umweltfreundlich</mark> und kommt im Karton.“
        </p>
        <p class="example__verdict">
          <LevelMark level="risiko" /> <span>Pauschale Umweltaussage · verboten ab 27.09.2026</span>
        </p>
      </div>
      <div class="table-scroll">
        <table class="test-table">
          <thead>
            <tr>
              <th scope="col">Produkt</th>
              {EXAMPLE_COLUMNS.map((c) => (
                <th scope="col" class="test-table__crit">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_ROWS.map((row) => (
              <tr>
                <th scope="row">{row.product}</th>
                {row.cells.map((cell) => (
                  <td class={`test-table__cell test-table__cell--${cell}`}>
                    <LevelMark level={cell} />
                    <span class="visually-hidden">{CELL_LABEL[cell]}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption id="example-caption" class="example__caption">
        <span>Beispiel mit erfundenen Produkten.</span>
        <span class="legend">
          <span>
            <LevelMark level="risiko" /> Risiko
          </span>
          <span>
            <LevelMark level="pruefen" /> Prüfen
          </span>
          <span>
            <LevelMark level="ok" /> ohne Befund
          </span>
          <span>
            <LevelMark level="na" /> nicht relevant
          </span>
        </span>
      </figcaption>
    </figure>
  );
}

const TODAY = new Date().toISOString().slice(0, 10);

function RuleCatalogue() {
  return (
    <section class="section" id="pruefpunkte" aria-labelledby="pruefpunkte-title">
      <div class="section__head">
        <h2 id="pruefpunkte-title">Was wir prüfen</h2>
        <p class="section__lede">
          {ALL_RULES.length} Prüfpunkte, ausgewählt nach dem, was in Deutschland regelmäßig abgemahnt wird. Jeder Befund im Bericht nennt die Fundstelle, die
          Rechtsgrundlage und die Lösung.
        </p>
      </div>
      <div class="table-scroll">
        <table class="rule-table">
          <thead>
            <tr>
              <th scope="col">Prüfpunkt</th>
              <th scope="col">Schwere</th>
              <th scope="col">Rechtsgrundlage</th>
            </tr>
          </thead>
          <tbody>
            {ALL_RULES.map((rule) => (
              <tr>
                <th scope="row">
                  <span class="rule-table__title">{rule.title}</span>
                  {rule.since ? (
                    <span class="since">
                      {rule.since > TODAY ? 'gilt ab' : 'gilt seit'} {formatDay(rule.since)}
                    </span>
                  ) : null}
                  <span class="rule-table__scope">{rule.kind === 'shop' ? 'Rechtstexte' : 'Produkttexte'}</span>
                </th>
                <td>
                  <SeverityMark severity={rule.severity} />
                </td>
                <td class="rule-table__law">{rule.law}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Method() {
  return (
    <section class="section section--method" id="methode" aria-labelledby="methode-title">
      <div class="section__head">
        <h2 id="methode-title">So prüfen wir</h2>
      </div>
      <ol class="steps">
        <li>
          <h3>Laden</h3>
          <p>Produkte aus dem öffentlichen Shopify- oder WooCommerce-Katalog, dazu Startseite, Impressum, Widerrufsbelehrung, Datenschutz und AGB.</p>
        </li>
        <li>
          <h3>Vorfiltern</h3>
          <p>Stichwörter finden die Stellen, um die es geht: „klimaneutral“, „lindert“, „Testsieger“, Mengenangaben wie „500 g“.</p>
        </li>
        <li>
          <h3>Beurteilen</h3>
          <p>
            {/* Describe the assessment without naming the underlying model. */}
            Die KI-gestützte Prüfung bewertet Aussagen im Zusammenhang. „Nachhaltig produziert“ ist eine Umweltaussage, „nachhaltig begeistert“ nicht.
          </p>
        </li>
        <li>
          <h3>Abgleichen</h3>
          <p>Was fehlt, etwa Grundpreis oder Faserangabe, prüfen wir zusätzlich auf der echten Produktseite, bevor wir es melden.</p>
        </li>
      </ol>
      <aside class="limits" aria-labelledby="grenzen-title">
        <h3 id="grenzen-title">Grenzen</h3>
        <p>
          Wir sehen nur, was öffentlich sichtbar ist. Kundenkonto, Checkout, Bilder und Werbung außerhalb des Shops prüfen wir nicht. „Prüfen“ im Bericht
          heißt: Wir sind unsicher oder können es von außen nicht feststellen. Der Bericht ersetzt keine anwaltliche Prüfung.
        </p>
      </aside>
      <div class="closing">
        <p>Bereit? Geben Sie oben Ihre Shop-Adresse ein.</p>
        <a class="button button--primary" href="#shop-url" data-focus-scan>
          Zur Prüfung
          <UpArrow />
        </a>
      </div>
    </section>
  );
}

function UpArrow() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13.5v-10M4 7.5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
    </svg>
  );
}

export function LandingPage(props: ScanFormProps) {
  return (
    <Layout
      title="ShopWacht – Online-Shop auf Abmahnrisiken prüfen"
      description="Prüft jede Produktbeschreibung und die Rechtstexte Ihres Shops auf typische Abmahnrisiken: Umweltaussagen, Grundpreis, Heilversprechen, Impressum und mehr."
    >
      <Masthead>
        <a href="#pruefpunkte">Was wir prüfen</a>
        <a href="#methode">So prüfen wir</a>
      </Masthead>
      <main id="inhalt">
        <section class="hero field" aria-labelledby="hero-title">
          <div class="hero__copy">
            <h1 class="hero__title" id="hero-title">
              Prüfen Sie Ihren Shop, bevor es die Konkurrenz tut.
            </h1>
            <p class="hero__lede">
              ShopWacht liest jede Produktbeschreibung und Ihre Rechtstexte und markiert, was in Deutschland regelmäßig abgemahnt wird. Mit Fundstelle,
              Rechtsgrundlage und Lösung.
            </p>
          </div>
          <div class="hero__panel">
            <ScanForm {...props} />
          </div>
          <div class="hero__example">
            <ExampleTable />
          </div>
        </section>
        <div class="paper">
          <RuleCatalogue />
          <Method />
        </div>
      </main>
    </Layout>
  );
}
