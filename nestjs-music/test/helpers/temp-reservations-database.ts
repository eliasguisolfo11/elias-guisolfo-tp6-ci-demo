import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryReservationsDatabase {
  directory: string;
  path: string;
  cleanup: () => void;
}

export function createTemporaryReservationsDatabase(): TemporaryReservationsDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'reservations-test-'));
  const path = join(directory, 'reservations.db');
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
