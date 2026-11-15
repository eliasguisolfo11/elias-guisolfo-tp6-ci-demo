import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { ReservationsModule } from './reservations.module.js';
import { ReservationsSchemaService } from './reservations-schema.service.js';
import { INITIAL_SLOTS, prepareInitialSlots } from './initial-slots.js';

interface SlotRow {
  id: number;
  starts_at: string;
  starts_at_utc: string;
  capacity: number;
}

interface ReservationRow {
  id: number;
  user_id: number;
  slot_id: number;
  quantity: number;
  status: string;
  idempotency_key: string;
  request_payload: string;
}

interface PaymentRow {
  id: number;
  reservation_id: number;
  result: string;
}

describe('ReservationsSchemaService', () => {
  const catalogPath = resolve(process.cwd(), 'data/chinook.db');
  const temporaryDirectories: string[] = [];
  const databaseServices: ReservationsDatabaseService[] = [];

  function createTemporaryDatabasePath(): {
    directory: string;
    path: string;
  } {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservations-schema-'));
    temporaryDirectories.push(directory);

    return { directory, path: join(directory, 'reservations.db') };
  }

  function openInitializedDatabase(path: string): ReservationsDatabaseService {
    const database = new ReservationsDatabaseService(
      new ConfigService({ RESERVATIONS_DATABASE_PATH: path }),
    );
    databaseServices.push(database);
    new ReservationsSchemaService(database).onModuleInit();
    return database;
  }

  function insertReservation(
    database: ReservationsDatabaseService,
    userId: number,
    slotId: number,
    idempotencyKey: string,
  ): number {
    database.run(
      `INSERT INTO reservations (
         user_id, slot_id, quantity, status, idempotency_key, request_payload
       ) VALUES (?, ?, 1, 'PAGADA', ?, '{}')`,
      userId,
      slotId,
      idempotencyKey,
    );

    return database.get<{ id: number }>(
      'SELECT last_insert_rowid() AS id',
    )!.id;
  }

  afterEach(() => {
    for (const database of databaseServices.splice(0)) {
      database.onModuleDestroy();
    }

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses a separate configured SQLite file with foreign keys enabled', () => {
    const catalogHash = createHash('sha256')
      .update(readFileSync(catalogPath))
      .digest('hex');
    const temporaryDatabase = createTemporaryDatabasePath();
    const database = openInitializedDatabase(temporaryDatabase.path);

    expect(existsSync(temporaryDatabase.path)).toBe(true);
    expect(database.get<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual(
      { foreign_keys: 1 },
    );
    expect(database.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )).toEqual(
      expect.arrayContaining([
        { name: 'slots' },
        { name: 'reservations' },
        { name: 'payments' },
      ]),
    );
    expect(
      createHash('sha256').update(readFileSync(catalogPath)).digest('hex'),
    ).toBe(catalogHash);
    expect(catalogHash.toUpperCase()).toBe(
      '9FBE219EE9E67D2EDCCD26271AF9AFDA37EC1C0D7E17F0DF3C02C705FF0DFA1D',
    );
  });

  it('seeds only the approved local demo slots with their fixed capacities', () => {
    const temporaryDatabase = createTemporaryDatabasePath();
    const database = openInitializedDatabase(temporaryDatabase.path);
    const slots = database.all<SlotRow>(
      `SELECT id, starts_at, starts_at_utc, capacity
       FROM slots ORDER BY starts_at_utc`,
    );

    expect(INITIAL_SLOTS).toEqual([
      { startsAt: '2026-12-15T10:00:00-03:00', capacity: 4 },
      { startsAt: '2026-12-15T12:00:00-03:00', capacity: 4 },
      { startsAt: '2026-12-15T14:00:00-03:00', capacity: 4 },
    ]);
    expect(slots.map(({ starts_at, capacity }) => ({
      startsAt: starts_at,
      capacity,
    }))).toEqual(INITIAL_SLOTS);
    expect(slots.map(({ starts_at_utc }) => starts_at_utc)).toEqual([
      '2026-12-15T13:00:00.000Z',
      '2026-12-15T15:00:00.000Z',
      '2026-12-15T17:00:00.000Z',
    ]);
  });

  it('ignores invalid initial timestamps and timestamps without an offset', () => {
    expect(
      prepareInitialSlots([
        { startsAt: '2026-12-16T10:00:00-03:00', capacity: 4 },
        { startsAt: '2026-02-30T10:00:00-03:00', capacity: 4 },
        { startsAt: '2026-12-17T10:00:00', capacity: 4 },
      ]),
    ).toEqual([
      {
        startsAt: '2026-12-16T10:00:00-03:00',
        startsAtUtc: '2026-12-16T13:00:00.000Z',
        capacity: 4,
      },
    ]);
  });

  it('preserves existing slots, capacities, reservations, and payments after reopening', () => {
    const temporaryDatabase = createTemporaryDatabasePath();
    const firstConnection = openInitializedDatabase(temporaryDatabase.path);
    const firstSlot = firstConnection.get<SlotRow>(
      'SELECT id, starts_at, starts_at_utc, capacity FROM slots ORDER BY id LIMIT 1',
    )!;
    firstConnection.run('UPDATE slots SET capacity = 9 WHERE id = ?', firstSlot.id);
    const reservationId = insertReservation(
      firstConnection,
      41,
      firstSlot.id,
      'persistent-demo-key',
    );
    firstConnection.run(
      `INSERT INTO payments (reservation_id, result)
       VALUES (?, 'EXITOSO')`,
      reservationId,
    );
    const slotsBeforeRestart = firstConnection.all<SlotRow>(
      'SELECT id, starts_at, starts_at_utc, capacity FROM slots ORDER BY id',
    );
    firstConnection.onModuleDestroy();

    const reopenedConnection = openInitializedDatabase(temporaryDatabase.path);

    expect(
      reopenedConnection.all<SlotRow>(
        'SELECT id, starts_at, starts_at_utc, capacity FROM slots ORDER BY id',
      ),
    ).toEqual(slotsBeforeRestart);
    expect(
      reopenedConnection.all<ReservationRow>(
        `SELECT id, user_id, slot_id, quantity, status, idempotency_key,
                request_payload
         FROM reservations ORDER BY id`,
      ),
    ).toEqual([
      {
        id: reservationId,
        user_id: 41,
        slot_id: firstSlot.id,
        quantity: 1,
        status: 'PAGADA',
        idempotency_key: 'persistent-demo-key',
        request_payload: '{}',
      },
    ]);
    expect(
      reopenedConnection.all<PaymentRow>(
        'SELECT id, reservation_id, result FROM payments ORDER BY id',
      ),
    ).toEqual([
      { id: 1, reservation_id: reservationId, result: 'EXITOSO' },
    ]);
  });

  it('uniquely identifies slots by their absolute UTC instant', () => {
    const temporaryDatabase = createTemporaryDatabasePath();
    const database = openInitializedDatabase(temporaryDatabase.path);

    expect(() =>
      database.run(
        `INSERT INTO slots (starts_at, starts_at_utc, capacity)
         VALUES (?, ?, ?)`,
        '2026-12-15T13:00:00+00:00',
        '2026-12-15T13:00:00.000Z',
        4,
      ),
    ).toThrow();
  });

  it('enforces reservation idempotency, payment uniqueness, and foreign keys', () => {
    const temporaryDatabase = createTemporaryDatabasePath();
    const database = openInitializedDatabase(temporaryDatabase.path);
    const slot = database.get<SlotRow>(
      'SELECT id, starts_at, starts_at_utc, capacity FROM slots ORDER BY id LIMIT 1',
    )!;
    const firstReservationId = insertReservation(
      database,
      51,
      slot.id,
      'same-key',
    );

    expect(() =>
      insertReservation(database, 51, slot.id, 'same-key'),
    ).toThrow();
    expect(insertReservation(database, 52, slot.id, 'same-key')).toBeGreaterThan(
      firstReservationId,
    );
    expect(() =>
      insertReservation(database, 53, 999999, 'missing-slot'),
    ).toThrow();
    expect(() =>
      database.run(
        `INSERT INTO payments (reservation_id, result)
         VALUES (?, 'EXITOSO')`,
        999999,
      ),
    ).toThrow();

    database.run(
      `INSERT INTO payments (reservation_id, result)
       VALUES (?, 'EXITOSO')`,
      firstReservationId,
    );
    expect(() =>
      database.run(
        `INSERT INTO payments (reservation_id, result)
         VALUES (?, 'EXITOSO')`,
        firstReservationId,
      ),
    ).toThrow();
  });

  it('initializes and closes the reservation database through Nest module lifecycle', async () => {
    const temporaryDatabase = createTemporaryDatabasePath();
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ RESERVATIONS_DATABASE_PATH: temporaryDatabase.path })],
        }),
        ReservationsModule,
      ],
    }).compile();
    const app = testingModule.createNestApplication();
    let database: ReservationsDatabaseService | undefined;

    try {
      await app.init();
      database = app.get(ReservationsDatabaseService);
      expect(database.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'slots'",
      )).toEqual([{ name: 'slots' }]);
      expect(existsSync(temporaryDatabase.path)).toBe(true);
    } finally {
      await app.close();
    }

    expect(database).toBeDefined();
    expect(() => database!.get('PRAGMA foreign_keys')).toThrow();
  });

  it('documents and ignores the runtime reservation database and SQLite sidecars', () => {
    const applicationRoot = resolve(process.cwd());
    const environmentExample = readFileSync(
      join(applicationRoot, '.env.example'),
      'utf8',
    );
    const ignoreRules = readFileSync(join(applicationRoot, '.gitignore'), 'utf8');

    expect(environmentExample).toMatch(/^RESERVATIONS_DATABASE_PATH=$/m);
    expect(ignoreRules).toMatch(/^\/data\/reservations\.db\*$/m);
  });
});
