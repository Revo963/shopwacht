import type { Level, Severity } from '../../types.js';

// Test-table marks, drawn: filled = Risiko, hollow dashed = Prüfen, dot = ohne Befund, dash = nicht relevant.

export function LevelMark({ level }: { level: Level | 'ok' | 'na' }) {
  if (level === 'risiko') {
    return (
      <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" fill="currentColor" />
      </svg>
    );
  }
  if (level === 'pruefen') {
    return (
      <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2" />
      </svg>
    );
  }
  if (level === 'ok') {
    return (
      <svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg class="mark mark--na" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 8h8" stroke="currentColor" stroke-width="1.6" />
    </svg>
  );
}

const SEVERITY_STEPS: Record<Severity, number> = { hoch: 3, mittel: 2, niedrig: 1 };

/** Three-step bar, like a rating scale in a test table. */
export function SeverityMark({ severity }: { severity: Severity }) {
  const filled = SEVERITY_STEPS[severity];
  return (
    <span class="severity">
      <svg class="severity__bar" viewBox="0 0 30 10" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect x={i * 10.5} y="0.75" width="8.5" height="8.5" fill={i < filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" />
        ))}
      </svg>
      <span class="severity__label">{severity}</span>
    </span>
  );
}

export function ExternalIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 8h10M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" />
    </svg>
  );
}
