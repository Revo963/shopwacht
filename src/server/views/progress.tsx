import type { JobState } from '../../scan/jobs.js';
import { displayName, Layout, Masthead } from './layout.js';
import { ScanForm, type ScanFormProps } from './landing.js';

type Phase = 'laden' | 'produkte' | 'seiten' | 'rechtstexte' | 'zweite-pruefung';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'laden', label: 'Produkte und Rechtstexte laden' },
  { id: 'produkte', label: 'Produkttexte beurteilen' },
  { id: 'seiten', label: 'Mit Produktseiten abgleichen' },
  { id: 'rechtstexte', label: 'Rechtstexte prüfen' },
  { id: 'zweite-pruefung', label: 'Zweite Prüfung' },
];

export interface ProgressView {
  phase: Phase;
  done: number;
  total: number | null;
}

export function progressView(state: Extract<JobState, { status: 'laden' | 'pruefen' }>): ProgressView {
  if (state.status === 'laden') return { phase: 'laden', done: state.loaded, total: null };
  return { phase: state.progress.phase, done: state.progress.done, total: state.progress.total };
}

export function ProgressPage(props: { id: string; state: Extract<JobState, { status: 'laden' | 'pruefen' }> }) {
  const view = progressView(props.state);
  const current = PHASES.findIndex((p) => p.id === view.phase);
  return (
    <Layout
      title={`Prüfung läuft – ${displayName(props.state.target)}`}
      head={
        <noscript>
          <meta http-equiv="refresh" content="3" />
        </noscript>
      }
    >
      <Masthead />
      <main id="inhalt" class="field field--page">
        <div class="page-head">
          <h1 class="page-head__title">{displayName(props.state.target)}</h1>
          <p class="page-head__meta">Die Prüfung läuft. Der Bericht erscheint hier automatisch, Sie können die Seite offen lassen.</p>
        </div>
        <ol class="phases" data-poll={`/api/bericht/${props.id}`} aria-live="polite">
          {PHASES.map((p, i) => {
            const status = i < current ? 'erledigt' : i === current ? 'läuft' : 'offen';
            return (
              <li class={`phase phase--${i < current ? 'done' : i === current ? 'active' : 'open'}`} data-phase={p.id}>
                <span class="phase__label">{p.label}</span>
                <span class="phase__status" data-status>
                  {status}
                </span>
                <span class="phase__count" data-count>
                  {i === current ? formatCount(view) : ''}
                </span>
                <span class="phase__bar" aria-hidden="true">
                  <span class="phase__fill" data-fill style={`--p:${i < current ? 1 : i === current && view.total ? view.done / view.total : 0}`}></span>
                </span>
              </li>
            );
          })}
        </ol>
      </main>
    </Layout>
  );
}

export function formatCount(view: ProgressView): string {
  return view.total ? `${view.done} / ${view.total}` : view.done > 0 ? `${view.done} Produkte` : '';
}

export function ErrorPage(props: { target: string; error: string } & Pick<ScanFormProps, 'maxProducts' | 'demo' | 'apiKey'>) {
  const isUrl = !props.target.startsWith('CSV: ');
  return (
    <Layout title="Prüfung nicht möglich – ShopWacht">
      <Masthead />
      <main id="inhalt" class="field field--page">
        <div class="page-head">
          <h1 class="page-head__title">Prüfung nicht möglich</h1>
          <p class="page-head__meta">{displayName(props.target)}</p>
        </div>
        <div class="error-panel">
          <p class="error-panel__message" role="alert">
            {props.error}
          </p>
          <ScanForm url={isUrl ? props.target : undefined} maxProducts={props.maxProducts} demo={props.demo} apiKey={props.apiKey} />
        </div>
      </main>
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <Layout title="Bericht nicht gefunden – ShopWacht">
      <Masthead />
      <main id="inhalt" class="field field--page">
        <div class="page-head">
          <h1 class="page-head__title">Bericht nicht gefunden</h1>
          <p class="page-head__meta">
            Der Link ist falsch oder der Bericht wurde gelöscht. <a href="/">Neue Prüfung starten</a>
          </p>
        </div>
      </main>
    </Layout>
  );
}
