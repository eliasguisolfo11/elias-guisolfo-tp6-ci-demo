import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryAuthDatabase {
  directory: string;
  path: string;
  cleanup: () => void;
}

export function createTemporaryAuthDatabase(): TemporaryAuthDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'auth-test-'));
  const path = join(directory, 'auth.db');
  let isCleaned = false;

  return {
    directory,
    path,
    cleanup: () => {
      if (!isCleaned) {
        rmSync(directory, { recursive: true, force: true });
        isCleaned = true;
      }
    },
  };
}