import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryReservationsCoordinationDatabase {
  directory: string;
  path: string;
  cleanup: () => void;
}

export function createTemporaryReservationsCoordinationDatabase(): TemporaryReservationsCoordinationDatabase {
  const directory = mkdtempSync(
    join(tmpdir(), 'reservations-coordination-test-'),
  );
  const path = join(directory, 'coordination.db');
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
