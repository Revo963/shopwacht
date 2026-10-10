import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanReport, ShopSnapshot } from '../types.js';
import type { Progress } from './engine.js';

// SHOPWACHT_DATA_DIR moves the folder; the tests use it to keep their made-up reports out of the real ones.
export const REPORT_DIR = join(process.env.SHOPWACHT_DATA_DIR ?? join(process.cwd(), 'data'), 'reports');

export type JobState =
  | { status: 'laden'; target: string; loaded: number }
  | { status: 'pruefen'; target: string; progress: Progress }
  | { status: 'fertig'; target: string; report: ScanReport }
  | { status: 'fehler'; target: string; error: string };

const jobs = new Map<string, JobState>();

export function newJobId(): string {
  // Unguessable: reports can contain a shop's weak spots.
  return randomBytes(9).toString('base64url');
}

export function setJob(id: string, state: JobState): void {
  jobs.set(id, state);
}

/** A running or finished scan of this process, or a report saved by an earlier one. */
export async function getJob(id: string): Promise<JobState | undefined> {
  const live = jobs.get(id);
  if (live) return live;
  if (!/^[\w-]{6,40}$/.test(id)) return undefined;
  try {
    const report = JSON.parse(await readFile(join(REPORT_DIR, `${id}.json`), 'utf8')) as ScanReport;
    return { status: 'fertig', target: report.origin, report };
  } catch {
    return undefined;
  }
}

export async function saveReport(report: ScanReport): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(join(REPORT_DIR, `${report.id}.json`), JSON.stringify(report, null, 2));
}

/** Runs load + scan in the background and keeps the job state current for the progress page. */
export function startJob(
  target: string,
  load: (onLoaded: (n: number) => void) => Promise<ShopSnapshot>,
  scan: (id: string, shop: ShopSnapshot, onProgress: (p: Progress) => void) => Promise<ScanReport>,
  /** Called once, whether the scan succeeded or failed. */
  onFinish?: () => void,
): string {
  const id = newJobId();
  setJob(id, { status: 'laden', target, loaded: 0 });
  void (async () => {
    try {
      const shop = await load((loaded) => setJob(id, { status: 'laden', target, loaded }));
      const report = await scan(id, shop, (progress) => setJob(id, { status: 'pruefen', target, progress }));
      await saveReport(report);
      setJob(id, { status: 'fertig', target, report });
    } catch (err) {
      console.error('Scan fehlgeschlagen:', err);
      setJob(id, { status: 'fehler', target, error: (err as Error).message });
    } finally {
      onFinish?.();
    }
  })();
  return id;
}
