import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ReservationsIdempotencyCoordinatorDatabaseService } from './reservations-idempotency-coordinator.database.service.js';

describe('ReservationsIdempotencyCoordinatorDatabaseService', () => {
  const temporaryDirectories: string[] = [];
  let firstConnection: ReservationsIdempotencyCoordinatorDatabaseService;
  let secondConnection: ReservationsIdempotencyCoordinatorDatabaseService;

  function createDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservation-coordination-'));
    temporaryDirectories.push(directory);
    return join(directory, 'coordination.db');
  }

  beforeEach(() => {
    const path = createDatabasePath();
    firstConnection = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({ RESERVATIONS_COORDINATION_DATABASE_PATH: path }),
    );
    secondConnection = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({ RESERVATIONS_COORDINATION_DATABASE_PATH: path }),
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

  it('shares the coordinator schema and write lock across independent connections', () => {
    const tables = secondConnection
      .all<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' ORDER BY name`,
      )
      .map(({ name }) => name);

    expect(tables).toEqual([
      'idempotency_generations',
      'idempotency_tickets',
    ]);

    firstConnection.transactionImmediate(() => {
      firstConnection.run(
        `INSERT INTO idempotency_generations (
           generation_id, user_id, idempotency_key, canonical_content, phase
         ) VALUES ('generation-1', 7, 'request-1', '{}', 'RUNNING')`,
      );

      expect(() =>
        secondConnection.run(
          `INSERT INTO idempotency_generations (
             generation_id, user_id, idempotency_key, canonical_content, phase
           ) VALUES ('generation-2', 7, 'request-2', '{}', 'RUNNING')`,
        ),
      ).toThrow();
    });

    expect(
      secondConnection.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_generations',
      ),
    ).toEqual({ count: 1 });
  });
});
