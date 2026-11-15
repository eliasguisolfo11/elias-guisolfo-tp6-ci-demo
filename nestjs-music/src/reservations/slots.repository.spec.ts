import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { ReservationsSchemaService } from './reservations-schema.service.js';
import { SlotsRepository } from './slots.repository.js';

interface SlotRow {
  id: number;
}

describe('SlotsRepository', () => {
  const temporaryDirectories: string[] = [];
  let database: ReservationsDatabaseService;
  let repository: SlotsRepository;

  function createDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'slots-repository-'));
    temporaryDirectories.push(directory);
    return join(directory, 'reservations.db');
  }

  function insertSlot(startsAt: string, capacity: number): number {
    const startsAtUtc = new Date(Date.parse(startsAt)).toISOString();
    database.run(
      'INSERT INTO slots (starts_at, starts_at_utc, capacity) VALUES (?, ?, ?)',
      startsAt,
      startsAtUtc,
      capacity,
    );
    return database.get<SlotRow>('SELECT last_insert_rowid() AS id')!.id;
  }

  function insertReservation(
    slotId: number,
    quantity: number,
    status: 'PAGADA' | 'COMPLETADA' | 'CANCELADA' | 'PENDIENTE',
    idempotencyKey: string,
  ): number {
    database.run(
      `INSERT INTO reservations (
         user_id, slot_id, quantity, status, idempotency_key, request_payload
       ) VALUES (1, ?, ?, ?, ?, '{}')`,
      slotId,
      quantity,
      status,
      idempotencyKey,
    );
    return database.get<SlotRow>('SELECT last_insert_rowid() AS id')!.id;
  }

  beforeEach(() => {
    database = new ReservationsDatabaseService(
      new ConfigService({ RESERVATIONS_DATABASE_PATH: createDatabasePath() }),
    );
    new ReservationsSchemaService(database).onModuleInit();
    repository = new SlotsRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('includes expired slots and preserves their configured offset', () => {
    const startsAt = '2020-02-03T08:30:00-04:00';
    const slotId = insertSlot(startsAt, 5);

    expect(repository.findAll()).toContainEqual({
      startsAt,
      capacity: 5,
      remainingCapacity: 5,
    });
    expect(slotId).toBeGreaterThan(0);
  });

  it('derives remaining capacity from paid and completed reservations only', () => {
    const slotId = insertSlot('2030-02-03T08:30:00+02:00', 10);
    const paidReservationId = insertReservation(
      slotId,
      2,
      'PAGADA',
      'paid-reservation',
    );
    insertReservation(slotId, 3, 'COMPLETADA', 'completed-reservation');
    insertReservation(slotId, 4, 'CANCELADA', 'cancelled-reservation');
    insertReservation(slotId, 1, 'PENDIENTE', 'pending-reservation');

    expect(repository.findAll()).toContainEqual({
      startsAt: '2030-02-03T08:30:00+02:00',
      capacity: 10,
      remainingCapacity: 5,
    });

    database.run(
      "UPDATE reservations SET status = 'CANCELADA' WHERE id = ?",
      paidReservationId,
    );

    expect(repository.findAll()).toContainEqual({
      startsAt: '2030-02-03T08:30:00+02:00',
      capacity: 10,
      remainingCapacity: 7,
    });
  });
});
