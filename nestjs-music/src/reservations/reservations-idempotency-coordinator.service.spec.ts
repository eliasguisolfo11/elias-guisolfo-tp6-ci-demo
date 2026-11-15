import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ReservationsIdempotencyCoordinatorDatabaseService } from './reservations-idempotency-coordinator.database.service.js';
import { ReservationsIdempotencyCoordinatorService } from './reservations-idempotency-coordinator.service.js';

describe('ReservationsIdempotencyCoordinatorService', () => {
  const temporaryDirectories: string[] = [];
  let firstDatabase: ReservationsIdempotencyCoordinatorDatabaseService;
  let secondDatabase: ReservationsIdempotencyCoordinatorDatabaseService;
  let firstCoordinator: ReservationsIdempotencyCoordinatorService;
  let secondCoordinator: ReservationsIdempotencyCoordinatorService;

  function createDatabasePath(): string {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'reservation-coordination-'));
    temporaryDirectories.push(directory);
    return join(directory, 'coordination.db');
  }

  beforeEach(() => {
    const path = createDatabasePath();
    firstDatabase = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({ RESERVATIONS_COORDINATION_DATABASE_PATH: path }),
    );
    secondDatabase = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({ RESERVATIONS_COORDINATION_DATABASE_PATH: path }),
    );
    firstCoordinator = new ReservationsIdempotencyCoordinatorService(
      firstDatabase,
    );
    secondCoordinator = new ReservationsIdempotencyCoordinatorService(
      secondDatabase,
    );
  });

  afterEach(() => {
    firstCoordinator.onModuleDestroy();
    secondCoordinator.onModuleDestroy();
    firstDatabase.onModuleDestroy();
    secondDatabase.onModuleDestroy();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('shares one active result, rejects different content, and drains before retry', () => {
    const leader = firstCoordinator.registerTicket(
      7,
      'request-1',
      '{"quantity":1}',
    );
    const participant = secondCoordinator.registerTicket(
      7,
      'request-1',
      '{"quantity":1}',
    );

    expect(leader.kind).toBe('leader');
    expect(participant.kind).toBe('participant');
    expect(
      secondCoordinator.registerTicket(7, 'request-1', '{"quantity":2}'),
    ).toEqual({ kind: 'conflict' });

    if (leader.kind !== 'leader' || participant.kind !== 'participant') {
      throw new Error('The coordinator did not register the expected tickets.');
    }

    const sharedResponse = {
      status: 502,
      body: { code: 502, message: 'Error interno del servidor.' },
    };
    expect(firstCoordinator.publish(leader.ticketId, sharedResponse)).toBe(
      true,
    );
    expect(firstCoordinator.readTicket(leader.ticketId)).toEqual({
      kind: 'response',
      response: sharedResponse,
    });
    expect(secondCoordinator.readTicket(participant.ticketId)).toEqual({
      kind: 'response',
      response: sharedResponse,
    });

    firstCoordinator.consume(leader.ticketId);
    expect(
      firstDatabase.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_generations',
      ),
    ).toEqual({ count: 1 });

    secondCoordinator.consume(participant.ticketId);
    expect(
      firstDatabase.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_generations',
      ),
    ).toEqual({ count: 0 });

    const retry = secondCoordinator.registerTicket(
      7,
      'request-1',
      '{"quantity":1}',
    );
    expect(retry.kind).toBe('leader');
    if (retry.kind === 'leader') {
      secondCoordinator.consume(retry.ticketId);
    }
  });

  it('removes only the cancelled request ticket and deletes its drained generation', async () => {
    const leaderCancellation = new AbortController();
    let releaseLeaderOperation: (() => void) | undefined;
    const leaderOperation = new Promise<{ status: number; body: unknown }>(
      (resolve) => {
        releaseLeaderOperation = () =>
          resolve({ status: 201, body: { id: 1 } });
      },
    );
    const leaderPromise = firstCoordinator.coordinate(
      7,
      'cancel-request',
      '{"quantity":1}',
      () => leaderOperation,
      leaderCancellation.signal,
    );
    const leaderCancellationExpectation = expect(leaderPromise).rejects.toThrow(
      'La solicitud de idempotencia fue cancelada durante la coordinación.',
    );

    const cancellation = new AbortController();
    let operationCalled = false;
    const participantPromise = secondCoordinator.coordinate(
      7,
      'cancel-request',
      '{"quantity":1}',
      () => {
        operationCalled = true;
        return { status: 201, body: { id: 1 } };
      },
      cancellation.signal,
    );
    const participantCancellation = expect(participantPromise).rejects.toThrow(
      'La solicitud de idempotencia fue cancelada durante la coordinación.',
    );

    expect(
      firstDatabase.all<{ ticketId: string }>(
        `SELECT ticket_id AS ticketId FROM idempotency_tickets
         ORDER BY ticket_id`,
      ),
    ).toHaveLength(2);

    cancellation.abort();
    await participantCancellation;

    expect(operationCalled).toBe(false);
    expect(
      firstDatabase.all<{ ticketId: string }>(
        'SELECT ticket_id AS ticketId FROM idempotency_tickets',
      ),
    ).toHaveLength(1);
    expect(
      firstDatabase.all<{ generationId: string }>(
        'SELECT generation_id AS generationId FROM idempotency_generations',
      ),
    ).toHaveLength(1);

    leaderCancellation.abort();
    if (releaseLeaderOperation === undefined) {
      throw new Error('The leader payment operation did not start.');
    }
    releaseLeaderOperation();
    await leaderCancellationExpectation;

    expect(
      firstDatabase.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_tickets',
      ),
    ).toEqual({ count: 0 });
    expect(
      firstDatabase.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_generations',
      ),
    ).toEqual({ count: 0 });
  });
});
