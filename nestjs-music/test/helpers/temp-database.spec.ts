import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createTemporaryAuthDatabase } from './temp-auth-database.js';
import { createTemporaryDatabase } from './temp-database.js';
import { createTemporaryReservationsDatabase } from './temp-reservations-database.js';
import { createTemporaryReservationsCoordinationDatabase } from './temp-reservations-coordination-database.js';

interface TemporaryDatabaseFixture {
  path: string;
  cleanup: () => void;
}

const databaseHelpers: Array<{
  name: string;
  create: () => TemporaryDatabaseFixture;
}> = [
  { name: 'Chinook copy', create: createTemporaryDatabase },
  { name: 'auth database', create: createTemporaryAuthDatabase },
  { name: 'reservations database', create: createTemporaryReservationsDatabase },
  {
    name: 'reservations coordination database',
    create: createTemporaryReservationsCoordinationDatabase,
  },
];

describe('temporary database helpers', () => {
  it.each(databaseHelpers)(
    '$name cleanup is idempotent and preserves a sibling directory',
    ({ create }) => {
      const database = create();
      const databaseDirectory = dirname(database.path);
      const siblingDirectory = mkdtempSync(
        join(dirname(databaseDirectory), 'database-helper-sentinel-'),
      );
      const sentinelPath = join(siblingDirectory, 'keep.txt');
      writeFileSync(sentinelPath, 'preserve this sibling');
      if (!existsSync(database.path)) {
        writeFileSync(database.path, 'temporary database fixture');
      }

      try {
        expect(existsSync(databaseDirectory)).toBe(true);
        expect(existsSync(database.path)).toBe(true);

        database.cleanup();
        database.cleanup();

        expect(existsSync(databaseDirectory)).toBe(false);
        expect(existsSync(database.path)).toBe(false);
        expect(readFileSync(sentinelPath, 'utf8')).toBe(
          'preserve this sibling',
        );
      } finally {
        database.cleanup();
        rmSync(siblingDirectory, { recursive: true, force: true });
      }
    },
  );
});
