import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Finding, ScanReport } from '../types.js';

const FEEDBACK_FILE = join(process.env.SHOPWACHT_DATA_DIR ?? join(process.cwd(), 'data'), 'feedback.jsonl');

/**
 * One "Fehlalarm" report from a user. It copies the finding so it stays readable
 * even if the report is deleted. No IP address or other personal data is stored.
 */
export interface FeedbackEntry {
  at: string;
  reportId: string;
  origin: string;
  index: number;
  verdict: 'fehlalarm';
  comment?: string;
  finding: Pick<Finding, 'ruleId' | 'level' | 'basis' | 'confidence' | 'evidence' | 'note'> & { subject: string; url?: string };
  model: string;
}

export async function recordFeedback(report: ScanReport, index: number, comment?: string, file = FEEDBACK_FILE): Promise<FeedbackEntry> {
  const f = report.findings[index];
  if (!f) throw new RangeError('Unbekannter Befund');
  const entry: FeedbackEntry = {
    at: new Date().toISOString(),
    reportId: report.id,
    origin: report.origin,
    index,
    verdict: 'fehlalarm',
    ...(comment?.trim() ? { comment: comment.trim().slice(0, 500) } : {}),
    finding: {
      ruleId: f.ruleId,
      level: f.level,
      basis: f.basis,
      confidence: f.confidence,
      evidence: f.evidence,
      note: f.note,
      subject: f.subject.title,
      url: f.subject.url,
    },
    model: report.model,
  };
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`);
  return entry;
}

export async function readFeedback(file = FEEDBACK_FILE): Promise<FeedbackEntry[]> {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as FeedbackEntry];
      } catch {
        return [];
      }
    });
}
