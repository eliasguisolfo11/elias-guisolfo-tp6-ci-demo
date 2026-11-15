import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface TemporaryDatabase {
  path: string;
  cleanup: () => void;
}

export function createTemporaryDatabase(
  sourcePath = resolve(process.cwd(), 'data/chinook.db'),
): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'chinook-test-'));
  const path = join(directory, 'chinook.db');

  try {
    copyFileSync(sourcePath, path);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  let isCleaned = false;
  return {
    path,
    cleanup: () => {
      if (!isCleaned) {
        rmSync(directory, { recursive: true, force: true });
        isCleaned = true;
      }
    },
  };
}
