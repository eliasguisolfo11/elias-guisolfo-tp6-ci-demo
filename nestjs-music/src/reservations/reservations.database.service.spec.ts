import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ReservationsDatabaseService } from './reservations.database.service.js';

describe('ReservationsDatabaseService', () => {
  const temporaryDirectories: string[] = [];
  let firstConnection: ReservationsDatabaseService;
  let secondConnection: ReservationsDatabaseService;

  function createDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservation-lock-'));
    temporaryDirectories.push(directory);
    return join(directory, 'reservations.db');
  }

  beforeEach(() => {
    const path = createDatabasePath();
    firstConnection = new ReservationsDatabaseService(
      new ConfigService({ RESERVATIONS_DATABASE_PATH: path }),
    );
    firstConnection.run(
      'CREATE TABLE transaction_lock_check (value INTEGER NOT NULL)',
    );
    secondConnection = new ReservationsDatabaseService(
      new ConfigService({ RESERVATIONS_DATABASE_PATH: path }),
    );
    secondConnection.run('PRAGMA busy_timeout = 0');
  });

  afterEach(() => {
    firstConnection.onModuleDestroy();
    secondConnection.onModuleDestroy();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('acquires the SQLite write lock before running its transaction callback', () => {
    const secondWriterWasBlocked = firstConnection.transactionImmediate(() => {
      expect(() =>
        secondConnection.run(
          'INSERT INTO transaction_lock_check (value) VALUES (1)',
        ),
      ).toThrow();
      return true;
    });

    expect(secondWriterWasBlocked).toBe(true);
    expect(
      firstConnection.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transaction_lock_check',
      ),
    ).toEqual({ count: 0 });
  });
});
