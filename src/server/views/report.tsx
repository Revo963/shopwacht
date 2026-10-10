import { ALL_RULES } from '../../rules/index.js';
import type { Rule } from '../../rules/types.js';
import { actionsFor, displayEvidence, SECOND_JUDGE_ADDED, secondJudgeGap, summarize, type Action, type RuleGroup } from '../../report/summary.js';
import { remedyFor } from '../../report/remedy.js';
import type { Finding, ScanReport } from '../../types.js';
import { displayName, formatDate, formatDay, Layout, Masthead } from './layout.js';
import { DownloadIcon, ExternalIcon, LevelMark, SeverityMark } from './marks.js';

const VISIBLE_ROWS = 40;
const TODAY = new Date().toISOString().slice(0, 10);

/** Where a finding sits in report.findings: the stable address for "Fehlalarm melden". */
interface RowContext {
  reportId: string;
  indexOf: Map<Finding, number>;
  flagged?: number;
  demo: boolean;
  /** The quotes to show, and findings grouped into actions. */
  shown: Map<Finding, string[]>;
  /** Findings whose only quote is a sentence found on many product pages. */
  generic: Set<Finding>;
  actions: Action[];
  actionIndex: Map<Action, number>;
}

const VISIBLE_ACTIONS = 12;

export function ReportPage({ report, flagged }: { report: ScanReport; flagged?: number }) {
  const summary = summarize(report);
  const actions = actionsFor(summary, report);
  const generic = new Set<Finding>();
  const shown = displayEvidence(report, generic);
  const ctx: RowContext = {
    reportId: report.id,
    indexOf: new Map(report.findings.map((f, i) => [f, i])),
    flagged,
    demo: report.mode === 'demo',
    shown,
    generic,
    actions,
    actionIndex: new Map(actions.map((a, i) => [a, i])),
  };
  const found = new Set(summary.groups.map((g) => g.rule.id));
  const shopChecked = report.platform !== 'csv';
  const quiet = ALL_RULES.filter((r) => !found.has(r.id));
  // Absent findings must not hide unreadable inputs.
  const incomplete = new Set(report.coverage?.incompleteRuleIds ?? []);
  const name = displayName(report.origin);

  return (
    <Layout title={`Prüfbericht ${name} – ShopWacht`} bodyClass="report">
      <Masthead>
        <a href="/">Neue Prüfung</a>
      </Masthead>
      <main id="inhalt">
        <section class="field report-head" aria-labelledby="report-title">
          <h1 class="page-head__title" id="report-title">
            {name}
          </h1>
          <p class="page-head__meta">
            Prüfbericht vom {formatDate(report.createdAt)} · {report.stats.products} Produkte
            {report.truncated ? ' (begrenzt)' : ''} · {report.platform === 'csv' ? 'CSV-Import' : report.platform === 'woocommerce' ? 'WooCommerce' : 'Shopify'}
          </p>
          <dl class="tally" aria-label="Ergebnis">
            <div>
              <dt>
                <LevelMark level="risiko" /> Risiko
              </dt>
              <dd>{summary.risiko}</dd>
            </div>
            <div>
              <dt>
                <LevelMark level="pruefen" /> Prüfen
              </dt>
              <dd>{summary.pruefen}</dd>
            </div>
            <div>
              <dt>
                <LevelMark level="ok" /> Prüfpunkte ohne Befund
              </dt>
              <dd>{quiet.filter((r) => (r.kind === 'product' || shopChecked) && !incomplete.has(r.id)).length}</dd>
            </div>
            <div>
              <dt>Produkte geprüft</dt>
              <dd>{report.stats.products}</dd>
            </div>
          </dl>
          {report.coverage && incomplete.size > 0 ? (
            <p class="demo-band">
              <strong>Prüfung eingeschränkt.</strong>{' '}
              {report.coverage.incompleteProducts > 0 ? `${report.coverage.incompleteProducts} von ${report.coverage.products} Produkten nur eingeschränkt geprüft. ` : ''}
              Einige Inhalte oder Prüfschritte waren nicht verfügbar. Kein Befund bedeutet keine vollständige Entwarnung.
            </p>
          ) : null}
          {secondJudgeGap(report) ? (
            <p class="demo-band">
              <strong>Zweite Prüfung unvollständig.</strong> {secondJudgeGap(report)}
            </p>
          ) : null}
          {report.mode === 'demo' ? (
            <p class="demo-band">
              {/* Keep the limitation, omit provider and setup details. */}
              <strong>Demo-Modus.</strong> Diese Ergebnisse stammen aus einer Stichwortsuche statt der regulären KI-gestützten Prüfung. Rechnen Sie mit Fehlalarmen.
            </p>
          ) : null}
        </section>

        <div class="paper">
          <section class="section overview" aria-labelledby="overview-title">
            <div class="section__head section__head--row">
              <h2 id="overview-title">Übersicht</h2>
              <div class="toolbar" role="group" aria-label="Befunde filtern" data-filters hidden>
                <button type="button" class="chip" aria-pressed="true" data-filter="alle">
                  Alle
                </button>
                <button type="button" class="chip" aria-pressed="false" data-filter="risiko">
                  <LevelMark level="risiko" /> Risiken
                </button>
                <button type="button" class="chip" aria-pressed="false" data-filter="pruefen">
                  <LevelMark level="pruefen" /> Zu prüfen
                </button>
              </div>
              <a class="button button--quiet" href={`/bericht/${report.id}/export.csv`} download>
                <DownloadIcon />
                CSV exportieren
              </a>
            </div>
            <div class="table-scroll">
              <table class="index-table">
                <thead>
                  <tr>
                    <th scope="col">Prüfpunkt</th>
                    <th scope="col">Schwere</th>
                    <th scope="col" class="num">
                      Risiko
                    </th>
                    <th scope="col" class="num">
                      Prüfen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.groups.map((g) => (
                    <tr data-counts={`${g.risiko},${g.pruefen}`}>
                      <th scope="row">
                        <a href={`#regel-${g.rule.id}`}>{g.rule.title}</a>
                      </th>
                      <td>
                        <SeverityMark severity={g.rule.severity} />
                      </td>
                      <td class="num">{g.risiko || ''}</td>
                      <td class="num">{g.pruefen || ''}</td>
                    </tr>
                  ))}
                  {quiet.map((rule) => {
                    const notRun = rule.kind === 'shop' && !shopChecked;
                    return (
                      <tr class="index-table__quiet">
                        <th scope="row">{rule.title}</th>
                        <td>
                          <SeverityMark severity={rule.severity} />
                        </td>
                        <td class="num" colspan={2}>
                          <span class="quiet-state">
                            <LevelMark level={notRun || incomplete.has(rule.id) ? 'na' : 'ok'} />
                            {notRun ? 'nicht geprüft' : incomplete.has(rule.id) ? 'teilweise nicht prüfbar' : 'ohne Befund'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!shopChecked ? <p class="footnote">Rechtstexte werden nur bei einer Prüfung per Shop-Adresse geprüft.</p> : null}
          </section>

          <ActionList ctx={ctx} total={report.findings.length} />

          {summary.groups.map((g) => (
            <FindingGroup group={g} ctx={ctx} />
          ))}

          {report.errors.length > 0 ? (
            <section class="section" aria-labelledby="errors-title">
              <div class="section__head">
                <h2 id="errors-title">Nicht vollständig geprüft</h2>
                {/* Partial checks can also retain findings for review. */}
                <p class="section__lede">Bei diesen Einträgen waren Inhalte oder Prüfschritte nicht vollständig verfügbar. Bitte die betroffenen Angaben selbst prüfen.</p>
              </div>
              {/* Raw errors may include provider responses or internal settings. */}
              <p class="footnote">{report.errors.length} Prüfschritte konnten nicht vollständig abgeschlossen werden.</p>
            </section>
          ) : null}

          <MethodBox report={report} />
        </div>
      </main>
    </Layout>
  );
}

/** What the owner has to do, biggest risks first; one line per shared sentence. */
function ActionList({ ctx, total }: { ctx: RowContext; total: number }) {
  if (ctx.actions.length === 0) return null;
  const top = ctx.actions.slice(0, VISIBLE_ACTIONS);
  const rest = ctx.actions.slice(VISIBLE_ACTIONS);
  return (
    <section class="section" aria-labelledby="actions-title">
      <div class="section__head">
        <h2 id="actions-title">Was zu tun ist</h2>
        <p class="section__lede">
          {total} Befunde in {ctx.actions.length} {ctx.actions.length === 1 ? 'Maßnahme' : 'Maßnahmen'}: Derselbe Satz in mehreren Produkten und Einstellungen,
          die alle Produkte betreffen, sind zusammengefasst. Die größten Risiken zuerst.
        </p>
      </div>
      <ol class="action-list">
        {top.map((a) => (
          <ActionItem action={a} ctx={ctx} />
        ))}
      </ol>
      {rest.length > 0 ? (
        <details class="more">
          <summary>Weitere {rest.length} Maßnahmen anzeigen</summary>
          <ol class="action-list" start={VISIBLE_ACTIONS + 1}>
            {rest.map((a) => (
              <ActionItem action={a} ctx={ctx} />
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function ActionItem({ action: a, ctx }: { action: Action; ctx: RowContext }) {
  const n = a.findings.length;
  return (
    <li class="action" data-counts={`${a.risiko},${a.pruefen}`}>
      <p class="action__head">
        <span class="action__counts">
          {a.risiko ? (
            <span>
              <LevelMark level="risiko" /> {a.risiko}
            </span>
          ) : null}
          {a.pruefen ? (
            <span>
              <LevelMark level="pruefen" /> {a.pruefen}
            </span>
          ) : null}
        </span>
        <a href={`#massnahme-${ctx.actionIndex.get(a)}`}>{a.rule.title}</a>
      </p>
      {a.quote ? <q class="quote">{highlight(a.quote, a.rule.kind === 'product' ? a.rule.highlight : undefined)}</q> : null}
      {a.generic ? <GenericNote /> : null}
      <p class="action__scope">{n === 1 ? a.findings[0]!.subject.title : a.quote ? `in ${n} Produkten` : `${n} Produkte – Anzeige im Shop prüfen`}</p>
    </li>
  );
}

function FindingGroup({ group, ctx }: { group: RuleGroup; ctx: RowContext }) {
  const { rule } = group;
  const actions = ctx.actions.filter((a) => a.rule.id === rule.id);
  const shown = actions.slice(0, VISIBLE_ROWS);
  const rest = actions.slice(VISIBLE_ROWS);
  return (
    <section class="group" id={`regel-${rule.id}`} aria-labelledby={`t-${rule.id}`} data-group data-counts={`${group.risiko},${group.pruefen}`}>
      <header class="group__head">
        <h2 id={`t-${rule.id}`}>{rule.title}</h2>
        <p class="group__meta">
          <SeverityMark severity={rule.severity} />
          {rule.since ? (
            <span class="since">
              {rule.since > TODAY ? 'gilt ab' : 'gilt seit'} {formatDay(rule.since)}
            </span>
          ) : null}
          <span class="group__counts">{countLine(group)}</span>
          <a class="to-overview" href="#overview-title">
            <UpIcon />
            Zur Übersicht
          </a>
        </p>
      </header>
      <div class="group__body">
        <div>
          <h3>Warum das abgemahnt wird</h3>
          <p>{rule.explain}</p>
        </div>
        <div>
          <h3>So beheben Sie es</h3>
          <p>{rule.fix}</p>
        </div>
      </div>
      <p class="group__law">
        <span>Rechtsgrundlage</span> {rule.law}
      </p>
      <ActionTable rule={rule} actions={shown} ctx={ctx} />
      {rest.length > 0 ? (
        <details class="more">
          <summary>Weitere {rest.length} Einträge anzeigen</summary>
          <ActionTable rule={rule} actions={rest} ctx={ctx} />
        </details>
      ) : null}
    </section>
  );
}

function ActionTable({ rule, actions, ctx }: { rule: Rule; actions: Action[]; ctx: RowContext }) {
  return (
    <table class="findings">
      <thead>
        <tr>
          <th scope="col">Stufe</th>
          <th scope="col">Betrifft</th>
          <th scope="col">Fundstelle</th>
          <th scope="col" class="num">
            Grundlage
          </th>
        </tr>
      </thead>
      <tbody>{actions.map((a) => (a.findings.length === 1 ? <FindingRow rule={rule} f={a.findings[0]!} ctx={ctx} anchor={`massnahme-${ctx.actionIndex.get(a)}`} /> : <GroupRow rule={rule} action={a} ctx={ctx} />))}</tbody>
    </table>
  );
}

/** The keyword search found no sentence of the product's own; Jev judged the whole description. */
function GenericNote() {
  return <span class="finding__note">Kein eigener Satz dieser Produkte gefunden – dieser Satz steht auf vielen Produktseiten. Das Modell hat die ganze Beschreibung bewertet: bitte dort nach Wirkaussagen suchen.</span>;
}

function Subject({ f }: { f: Finding }) {
  return f.subject.url ? (
    <a href={f.subject.url} target="_blank" rel="noopener noreferrer">
      {f.subject.title}
      <ExternalIcon />
      <span class="visually-hidden"> (öffnet neuen Tab)</span>
    </a>
  ) : (
    <>{f.subject.title}</>
  );
}

function Remedy({ rule, f }: { rule: Rule; f: Finding }) {
  const rem = remedyFor(rule, f);
  return (
    <div class="remedy">
      <span class="remedy__title">Handlungsempfehlung</span>
      <p class="remedy__text">{rem.text}</p>
      {rem.copySnippet ? (
        <button type="button" class="remedy__copy" data-copy={rem.copySnippet} title="Mustertext in die Zwischenablage kopieren">
          Mustertext kopieren
        </button>
      ) : null}
    </div>
  );
}

function FindingRow({ rule, f, ctx, anchor }: { rule: Rule; f: Finding; ctx: RowContext; anchor: string }) {
  const quotes = ctx.shown.get(f) ?? f.evidence;
  return (
    <tr class={`finding finding--${f.level}`} data-level={f.level} id={`f-${ctx.indexOf.get(f)}`}>
      <td class="finding__level" data-label="Stufe">
        <span id={anchor} />
        <LevelMark level={f.level} />
        {f.level === 'risiko' ? 'Risiko' : 'Prüfen'}
      </td>
      <th scope="row" class="finding__subject" data-label="Betrifft">
        <Subject f={f} />
      </th>
      <td class="finding__evidence" data-label="Fundstelle">
        {quotes.map((e) => (
          <q class="quote">{highlight(e, rule.kind === 'product' ? rule.highlight : undefined)}</q>
        ))}
        {ctx.generic.has(f) ? <GenericNote /> : null}
        {f.note ? <span class="finding__note">{f.note}</span> : null}
        {quotes.length === 0 && !f.note ? '—' : null}
        <Remedy rule={rule} f={f} />
      </td>
      <td class="num finding__basis" data-label="Grundlage">
        <Basis finding={f} demo={ctx.demo} />
        <FlagButton index={ctx.indexOf.get(f)!} ctx={ctx} />
      </td>
    </tr>
  );
}

/** One row for a sentence or setting shared by several products. */
function GroupRow({ rule, action: a, ctx }: { rule: Rule; action: Action; ctx: RowContext }) {
  const re = rule.kind === 'product' ? rule.highlight : undefined;
  // Under a template heading each product has its own sentence; without a shared sentence (theme-level rules) the detail is per product.
  const perProduct = !a.quote || a.quote.endsWith(': …');
  const levels = a.risiko && a.pruefen ? '' : ` finding--${a.risiko ? 'risiko' : 'pruefen'}`;
  const pct = a.findings.map((f) => Math.round(f.confidence * 100));
  const modelled = a.findings.every((f) => (f.basis ?? 'modell') === 'modell' && f.confidence < 0.999) && !ctx.demo;
  return (
    <tr class={`finding finding--group${levels}`} id={`massnahme-${ctx.actionIndex.get(a)}`}>
      <td class="finding__level" data-label="Stufe">
        {a.risiko ? (
          <span class="finding__levelcount">
            <LevelMark level="risiko" /> {a.risiko} Risiko
          </span>
        ) : null}
        {a.pruefen ? (
          <span class="finding__levelcount">
            <LevelMark level="pruefen" /> {a.pruefen} Prüfen
          </span>
        ) : null}
      </td>
      <th scope="row" class="finding__subject" data-label="Betrifft">
        {a.findings.length} Produkte
      </th>
      <td class="finding__evidence" data-label="Fundstelle">
        {a.quote ? <q class="quote">{highlight(a.quote, re)}</q> : null}
        {a.generic ? <GenericNote /> : null}
        <ul class="finding__products">
          {a.findings.map((f) => {
            const own = perProduct ? (a.own.get(f) ?? (ctx.shown.get(f) ?? f.evidence)[0]) : undefined;
            return (
              <li class={`finding--${f.level}`} data-level={f.level} id={`f-${ctx.indexOf.get(f)}`}>
                <LevelMark level={f.level} />
                <span class="finding__product">
                  <Subject f={f} />
                  {own ? <span class="finding__own">{highlight(own, re)}</span> : null}
                  {f.note ? <span class="finding__note">{f.note}</span> : null}
                  {f.secondJudge === 'added' ? <span class="finding__note">{SECOND_JUDGE_ADDED}</span> : null}
                </span>
                <FlagButton index={ctx.indexOf.get(f)!} ctx={ctx} />
              </li>
            );
          })}
        </ul>
        <Remedy rule={rule} f={a.findings[0]!} />
      </td>
      <td class="num finding__basis" data-label="Grundlage">
        {modelled ? (
          <span>
            Modell{' '}
            <span class="finding__pct">
              {Math.min(...pct) === Math.max(...pct) ? `${Math.max(...pct)} %` : `${Math.min(...pct)}–${Math.max(...pct)} %`}
            </span>
          </span>
        ) : (
          <Basis finding={a.findings[0]!} demo={ctx.demo} />
        )}
      </td>
    </tr>
  );
}

function MethodBox({ report }: { report: ScanReport }) {
  const s = report.stats;
  return (
    <section class="section section--method" aria-labelledby="method-title">
      <div class="section__head">
        <h2 id="method-title">So haben wir geprüft</h2>
      </div>
      <dl class="facts">
        <div>
          <dt>Beurteilung</dt>
          {/* Show the assessment type, not the model identity. */}
          <dd>{report.mode === 'demo' ? 'Stichwortsuche (Demo-Modus)' : 'KI-gestützte Vorprüfung'}</dd>
        </div>
        {report.pageCheck ? (
          <div>
            <dt>Produktseiten</dt>
            <dd>{report.pageCheck === 'browser' ? 'einschließlich nachgeladener Inhalte abgeglichen' : 'nur eingeschränkt abgeglichen'}</dd>
          </div>
        ) : null}
        <div>
          <dt>Dauer</dt>
          <dd class="num">
            {duration(s.durationMs + (report.secondJudge?.durationMs ?? 0))}
            {report.secondJudge ? `, davon ${duration(report.secondJudge.durationMs)} für die zweite Prüfung` : ''}
          </dd>
        </div>
        {report.secondJudge ? (
          <div>
            <dt>Zweite Prüfung</dt>
            <dd>
              {/* Preserve coverage and changes without provider or cost details. */}
              {report.secondJudge.judged} von {report.secondJudge.products} Produkten, {report.secondJudge.added} ergänzt,{' '}
              {report.secondJudge.downgraded} von „Risiko“ auf „Prüfen“, {report.secondJudge.dropped} entfernt (nur im CSV-Export)
            </dd>
          </div>
        ) : null}
      </dl>
      <aside class="limits">
        <h3>Grenzen</h3>
        <p>
          Wir sehen nur öffentlich sichtbare Inhalte. Kundenkonto, Checkout, Bilder und Werbung außerhalb des Shops sind nicht geprüft. „Prüfen“ heißt:
          Das Modell ist unsicher, oder der Punkt lässt sich von außen nicht feststellen. Einträge ohne Befund sind keine Garantie, dass ein Punkt in Ordnung
          ist.
        </p>
      </aside>
    </section>
  );
}

function countLine(g: RuleGroup): string {
  return [g.risiko ? `${g.risiko} Risiko` : '', g.pruefen ? `${g.pruefen} zu prüfen` : ''].filter(Boolean).join(' · ');
}

/** Where the finding comes from, kept apart from its level: a model percentage, a keyword hit, or a rule check. */
function Basis({ finding, demo }: { finding: Finding; demo: boolean }) {
  // Not "Modell 100 %" – the models gave a verdict, not a probability.
  if (finding.secondJudge === 'added') return <span>{SECOND_JUDGE_ADDED}</span>;
  const basis = finding.basis ?? (finding.confidence >= 0.999 ? 'regel' : demo ? 'stichwort' : 'modell');
  if (basis === 'modell') {
    return (
      <span>
        Modell <span class="finding__pct">{Math.round(finding.confidence * 100)} %</span>
      </span>
    );
  }
  return <span>{basis === 'stichwort' ? 'Stichwort' : 'Regelprüfung'}</span>;
}

/** "Fehlalarm?": one click tells us this finding is wrong. Works without JavaScript as a form post. */
function FlagButton({ index, ctx }: { index: number; ctx: RowContext }) {
  if (ctx.flagged === index) {
    return (
      <span class="flag flag--done" role="status">
        Gemeldet, danke
      </span>
    );
  }
  return (
    <form class="flag" method="post" action={`/bericht/${ctx.reportId}/feedback`} data-flag>
      <input type="hidden" name="index" value={String(index)} />
      <button type="submit" class="flag__button" title="Dieser Befund ist falsch? Mit einem Klick melden – das verbessert die Prüfung.">
        <FlagIcon />
        <span data-flag-label>Fehlalarm?</span>
      </button>
    </form>
  );
}

function FlagIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 14.5v-12M3.5 2.5h8l-1.8 3 1.8 3h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13.5v-10M4 7.5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
    </svg>
  );
}

/** Wraps the rule's trigger words inside a quote in <mark>. */
function highlight(text: string, re?: RegExp) {
  if (!re) return text;
  const parts: (string | ReturnType<typeof Hit>)[] = [];
  let last = 0;
  const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(pattern)) {
    if (m[0].length === 0) continue;
    parts.push(text.slice(last, m.index));
    parts.push(<Hit text={m[0]} />);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** "47,1 s" under a minute, "3 min 24 s" above. */
function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function Hit({ text }: { text: string }) {
  return <mark class="hit">{text}</mark>;
}
