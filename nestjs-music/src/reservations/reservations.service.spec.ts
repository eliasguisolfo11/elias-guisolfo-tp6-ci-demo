import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { ReservationsIdempotencyCoordinatorDatabaseService } from './reservations-idempotency-coordinator.database.service.js';
import { ReservationsIdempotencyCoordinatorService } from './reservations-idempotency-coordinator.service.js';
import { ReservationsSchemaService } from './reservations-schema.service.js';
import { SlotsRepository } from './slots.repository.js';
import { ReservationsRepository } from './reservations.repository.js';
import { PaymentsRepository } from './payments.repository.js';
import { ReservationsService } from './reservations.service.js';
import { PaymentSimulator } from './payment-simulator.js';
import { ReservationClock } from './reservation-clock.js';

const FIXED_NOW = '2030-01-01T00:00:00.000Z';
const FUTURE_SLOT = '2030-01-01T02:00:00+01:00';

class FixedReservationClock extends ReservationClock {
  constructor(private readonly currentTime: string) {
    super();
  }

  override now(): Date {
    return new Date(this.currentTime);
  }
}

describe('ReservationsService.create', () => {
  const temporaryDirectories: string[] = [];
  const coordinatorDatabases: ReservationsIdempotencyCoordinatorDatabaseService[] = [];
  const coordinators: ReservationsIdempotencyCoordinatorService[] = [];
  let database: ReservationsDatabaseService;
  let slotsRepository: SlotsRepository;
  let reservationsRepository: ReservationsRepository;
  let paymentsRepository: PaymentsRepository;
  let clock: FixedReservationClock;
  let simulator: PaymentSimulator;
  let service: ReservationsService;

  function createDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservation-create-'));
    temporaryDirectories.push(directory);
    return join(directory, 'reservations.db');
  }

  function createCoordinationDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservation-coordination-'));
    temporaryDirectories.push(directory);
    return join(directory, 'coordination.db');
  }

  function insertSlot(startsAt: string, capacity: number): number {
    database.run(
      'INSERT INTO slots (starts_at, starts_at_utc, capacity) VALUES (?, ?, ?)',
      startsAt,
      new Date(Date.parse(startsAt)).toISOString(),
      capacity,
    );
    return database.get<{ id: number }>(
      'SELECT last_insert_rowid() AS id',
    )!.id;
  }

  function reservationCount(): number {
    return database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM reservations',
    )!.count;
  }

  function paymentCount(): number {
    return database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM payments',
    )!.count;
  }

  function createService(paymentSimulator: PaymentSimulator = simulator): void {
    const coordinatorDatabase = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({
        RESERVATIONS_COORDINATION_DATABASE_PATH:
          createCoordinationDatabasePath(),
      }),
    );
    const coordinator = new ReservationsIdempotencyCoordinatorService(
      coordinatorDatabase,
    );
    coordinatorDatabases.push(coordinatorDatabase);
    coordinators.push(coordinator);
    service = new ReservationsService(
      database,
      slotsRepository,
      reservationsRepository,
      paymentsRepository,
      clock,
      paymentSimulator,
      coordinator,
    );
  }

  beforeEach(() => {
    database = new ReservationsDatabaseService(
      new ConfigService({ RESERVATIONS_DATABASE_PATH: createDatabasePath() }),
    );
    new ReservationsSchemaService(database).onModuleInit();
    slotsRepository = new SlotsRepository(database);
    reservationsRepository = new ReservationsRepository(database);
    paymentsRepository = new PaymentsRepository(database);
    clock = new FixedReservationClock(FIXED_NOW);
    simulator = new PaymentSimulator();
    createService();
  });

  afterEach(() => {
    for (const coordinator of coordinators.splice(0)) {
      coordinator.onModuleDestroy();
    }
    for (const coordinatorDatabase of coordinatorDatabases.splice(0)) {
      coordinatorDatabase.onModuleDestroy();
    }
    database.onModuleDestroy();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid quantity (%s) without creating a reservation or payment',
    (quantity) => {
      insertSlot(FUTURE_SLOT, 4);

      expect(() =>
        service.create(7, 'invalid-quantity', {
          startsAt: FUTURE_SLOT,
          quantity,
        }),
      ).toThrow(BadRequestException);
      expect(reservationCount()).toBe(0);
      expect(paymentCount()).toBe(0);
    },
  );

  it.each([
    ['missing offset', '2030-01-01T01:00:00'],
    ['impossible calendar date', '2030-02-30T01:00:00Z'],
    ['invalid offset', '2030-01-01T01:00:00+24:00'],
    ['malformed timestamp', 'tomorrow'],
  ])('rejects %s before searching for a slot or writing', (_case, startsAt) => {
    expect(() =>
      service.create(7, 'invalid-date', { startsAt, quantity: 1 }),
    ).toThrow(BadRequestException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);
  });

  it.each([
    ['at the current instant', '2030-01-01T01:00:00+01:00'],
    ['before the current instant', '2029-12-31T18:59:59-05:00'],
  ])('rejects a slot %s even when no configured slot exists', (_case, startsAt) => {
    expect(() =>
      service.create(7, 'expired-slot', { startsAt, quantity: 1 }),
    ).toThrow(BadRequestException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);
  });

  it('returns 404 for a valid future instant without a configured slot', () => {
    expect(() =>
      service.create(7, 'missing-slot', {
        startsAt: '2030-01-01T00:01:00Z',
        quantity: 1,
      }),
    ).toThrow(NotFoundException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);
  });

  it('returns the remaining capacity when the requested quantity does not fit', () => {
    const slotId = insertSlot(FUTURE_SLOT, 2);
    database.run(
      `INSERT INTO reservations (
         user_id, slot_id, quantity, status, idempotency_key, request_payload
       ) VALUES (91, ?, 1, 'PAGADA', 'existing-reservation', '{}')`,
      slotId,
    );

    let error: ConflictException | undefined;
    try {
      service.create(7, 'insufficient-capacity', {
        startsAt: FUTURE_SLOT,
        quantity: 2,
      });
    } catch (caught) {
      if (caught instanceof ConflictException) {
        error = caught;
      } else {
        throw caught;
      }
    }

    expect(error).toBeInstanceOf(ConflictException);
    expect(error?.getStatus()).toBe(409);
    expect(error?.getResponse()).toEqual(
      expect.objectContaining({ remainingCapacity: 1 }),
    );
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(0);
  });

  it('rolls back the pending reservation and its key when payment fails', () => {
    insertSlot(FUTURE_SLOT, 4);
    let pendingReservationsDuringPayment = 0;
    const failingConfirm = vi.fn(() => {
      pendingReservationsDuringPayment = database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM reservations WHERE status = 'PENDIENTE'",
      )!.count;
      throw new Error('simulated payment rejection');
    });
    const failingSimulator = { confirm: failingConfirm };
    createService(failingSimulator);

    expect(() =>
      service.create(7, 'retryable-key', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }),
    ).toThrow(BadGatewayException);

    expect(pendingReservationsDuringPayment).toBe(1);
    expect(failingConfirm).toHaveBeenCalledOnce();
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);
    expect(
      database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM reservations WHERE idempotency_key = 'retryable-key'",
      )!.count,
    ).toBe(0);
  });

  it('persists one paid reservation and its single successful payment atomically', () => {
    insertSlot(FUTURE_SLOT, 4);
    let pendingReservationsDuringPayment = 0;
    const observedConfirm = vi.fn(() => {
      pendingReservationsDuringPayment = database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM reservations WHERE status = 'PENDIENTE'",
      )!.count;
      expect(paymentCount()).toBe(0);
      return { result: 'EXITOSO' as const };
    });
    const observedSimulator = { confirm: observedConfirm };
    createService(observedSimulator);

    const reservation = service.create(7, 'success-key', {
      startsAt: '2030-01-01T01:00:00Z',
      quantity: 2,
    });

    expect(pendingReservationsDuringPayment).toBe(1);
    expect(observedConfirm).toHaveBeenCalledOnce();
    expect(reservation.status).toBe('PAGADA');
    expect(reservation.startsAt).toBe(FUTURE_SLOT);
    expect(reservation.quantity).toBe(2);
    expect(reservation.payment).toEqual(
      expect.objectContaining({ result: 'EXITOSO' }),
    );
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
    expect(
      database.get<{ status: string; idempotency_key: string }>(
        'SELECT status, idempotency_key FROM reservations WHERE id = ?',
        reservation.id,
      ),
    ).toEqual({ status: 'PAGADA', idempotency_key: 'success-key' });
    expect(
      database.get<{ result: string; reservation_id: number }>(
        'SELECT result, reservation_id FROM payments WHERE reservation_id = ?',
        reservation.id,
      ),
    ).toEqual({ result: 'EXITOSO', reservation_id: reservation.id });
  });

  it('replays the original receipt after its slot has passed and filled', () => {
    insertSlot(FUTURE_SLOT, 4);
    const confirm = vi.fn(() => ({ result: 'EXITOSO' as const }));
    createService({ confirm });
    const input = { startsAt: FUTURE_SLOT, quantity: 2 };

    const original = service.create(7, 'replay-key', input);
    database.run(
      "UPDATE reservations SET status = 'CANCELADA' WHERE id = ?",
      original.id,
    );
    const otherReservation = service.create(8, 'fill-slot', {
      startsAt: FUTURE_SLOT,
      quantity: 4,
    });
    expect(slotsRepository.findAll()).toContainEqual({
      startsAt: FUTURE_SLOT,
      capacity: 4,
      remainingCapacity: 0,
    });

    clock = new FixedReservationClock('2030-01-01T02:00:00.000Z');
    createService({ confirm });
    const replay = service.create(7, 'replay-key', input);

    expect(replay).toEqual(original);
    expect(replay.status).toBe('PAGADA');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(reservationCount()).toBe(2);
    expect(paymentCount()).toBe(2);
    expect(
      database.all<{ id: number; status: string }>(
        'SELECT id, status FROM reservations ORDER BY id',
      ),
    ).toEqual([
      { id: original.id, status: 'CANCELADA' },
      { id: otherReservation.id, status: 'PAGADA' },
    ]);
    expect(slotsRepository.findAll()).toContainEqual({
      startsAt: FUTURE_SLOT,
      capacity: 4,
      remainingCapacity: 0,
    });
  });

  it('returns 409 for different content and preserves the successful receipt', () => {
    insertSlot(FUTURE_SLOT, 4);
    const original = service.create(7, 'different-content-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
    });

    expect(() =>
      service.create(7, 'different-content-key', {
        startsAt: FUTURE_SLOT,
        quantity: 2,
      }),
    ).toThrow(ConflictException);
    expect(
      service.create(7, 'different-content-key', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }),
    ).toEqual(original);
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('treats every request property as idempotent content', () => {
    insertSlot(FUTURE_SLOT, 4);
    service.create(7, 'extra-property-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
    });

    expect(() =>
      service.create(7, 'extra-property-key', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
        foo: 'extra',
      }),
    ).toThrow(ConflictException);
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('replays the same JSON content when object keys are reordered', () => {
    insertSlot(FUTURE_SLOT, 4);
    const original = service.create(7, 'canonical-content-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
      context: { first: 'one', second: 'two' },
    });

    const replay = service.create(7, 'canonical-content-key', {
      context: { second: 'two', first: 'one' },
      quantity: 1,
      startsAt: FUTURE_SLOT,
    });

    expect(replay).toEqual(original);
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it.each([
    [
      'an invalid date',
      { startsAt: 'not-a-date', quantity: 1 },
    ],
    [
      'the estado field',
      { startsAt: FUTURE_SLOT, quantity: 1, estado: 'CANCELADA' },
    ],
  ])('returns 409 before validating %s for an existing successful key', (_case, changedInput) => {
    insertSlot(FUTURE_SLOT, 4);
    const original = service.create(7, 'precedence-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
    });
    const originalPayload = database.get<{ request_payload: string }>(
      'SELECT request_payload FROM reservations WHERE id = ?',
      original.id,
    )?.request_payload;

    expect(() => service.create(7, 'precedence-key', changedInput)).toThrow(
      ConflictException,
    );
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
    expect(
      database.get<{ request_payload: string }>(
        'SELECT request_payload FROM reservations WHERE id = ?',
        original.id,
      )?.request_payload,
    ).toBe(originalPayload);
  });

  it('treats the same key as independent for different users', () => {
    insertSlot(FUTURE_SLOT, 4);

    const first = service.create(7, 'shared-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
    });
    const second = service.create(8, 'shared-key', {
      startsAt: FUTURE_SLOT,
      quantity: 1,
    });

    expect(second.id).not.toBe(first.id);
    expect(reservationCount()).toBe(2);
    expect(paymentCount()).toBe(2);
  });

  it('rejects estado for a new key without consuming it', () => {
    insertSlot(FUTURE_SLOT, 4);
    const inputWithEstado = {
      startsAt: FUTURE_SLOT,
      quantity: 1,
      estado: 'PAGADA',
    };

    expect(() => service.create(7, 'new-state-key', inputWithEstado)).toThrow(
      BadRequestException,
    );
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    expect(
      service.create(7, 'new-state-key', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('allows a corrected request to reuse its key after a 400 validation error', () => {
    insertSlot(FUTURE_SLOT, 4);

    expect(() =>
      service.create(7, 'retry-after-400', {
        startsAt: FUTURE_SLOT,
        quantity: 0,
      }),
    ).toThrow(BadRequestException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    expect(
      service.create(7, 'retry-after-400', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('allows the same key to be reused after an invalid-date 400', () => {
    insertSlot(FUTURE_SLOT, 4);

    expect(() =>
      service.create(7, 'retry-after-invalid-date', {
        startsAt: 'not-a-date',
        quantity: 1,
      }),
    ).toThrow(BadRequestException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    expect(
      service.create(7, 'retry-after-invalid-date', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('allows the same key to be reused after a 404 missing-slot error', () => {
    expect(() =>
      service.create(7, 'retry-after-404', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }),
    ).toThrow(NotFoundException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    insertSlot(FUTURE_SLOT, 4);
    expect(
      service.create(7, 'retry-after-404', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('allows the same key to be reused after a 409 capacity error', () => {
    insertSlot(FUTURE_SLOT, 1);

    expect(() =>
      service.create(7, 'retry-after-409', {
        startsAt: FUTURE_SLOT,
        quantity: 2,
      }),
    ).toThrow(ConflictException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    expect(
      service.create(7, 'retry-after-409', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });

  it('allows the same key to be reused after a 502 payment error', () => {
    insertSlot(FUTURE_SLOT, 4);
    createService({ confirm: () => { throw new Error('simulated rejection'); } });

    expect(() =>
      service.create(7, 'retry-after-502', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }),
    ).toThrow(BadGatewayException);
    expect(reservationCount()).toBe(0);
    expect(paymentCount()).toBe(0);

    createService();
    expect(
      service.create(7, 'retry-after-502', {
        startsAt: FUTURE_SLOT,
        quantity: 1,
      }).status,
    ).toBe('PAGADA');
    expect(reservationCount()).toBe(1);
    expect(paymentCount()).toBe(1);
  });
});
