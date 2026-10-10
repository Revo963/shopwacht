// Tests save made-up reports. They go to a throwaway folder, not next to the user's real ones in data/.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'shopwacht-test-'));
  process.env.SHOPWACHT_DATA_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
