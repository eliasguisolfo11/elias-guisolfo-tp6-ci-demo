import { ConfigService } from '@nestjs/config';
import { Worker } from 'node:worker_threads';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { ReservationsIdempotencyCoordinatorDatabaseService } from '../../src/reservations/reservations-idempotency-coordinator.database.service.js';
import { ReservationsIdempotencyCoordinatorService } from '../../src/reservations/reservations-idempotency-coordinator.service.js';
import { CoordinatorWorkerLifecycle } from './reservations-concurrency-runner.js';

describe('Reservations concurrency worker lifecycle', () => {
  let temporaryDirectory: string;
  let database: ReservationsIdempotencyCoordinatorDatabaseService;
  let firstCoordinator: ReservationsIdempotencyCoordinatorService;
  let secondCoordinator: ReservationsIdempotencyCoordinatorService;
  let lifecycle: CoordinatorWorkerLifecycle;
  let worker: Worker | undefined;

  beforeEach(() => {
    const temporaryRoot = resolve(process.cwd(), '.temp');
    mkdirSync(temporaryRoot, { recursive: true });
    temporaryDirectory = mkdtempSync(
      join(temporaryRoot, 'reservation-lifecycle-'),
    );
    database = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({
        RESERVATIONS_COORDINATION_DATABASE_PATH: join(
          temporaryDirectory,
          'coordination.db',
        ),
      }),
    );
    firstCoordinator = new ReservationsIdempotencyCoordinatorService(database);
    secondCoordinator = new ReservationsIdempotencyCoordinatorService(database);
    lifecycle = new CoordinatorWorkerLifecycle(database);
  });

  afterEach(async () => {
    if (worker !== undefined) {
      worker.postMessage({ type: 'exit' });
      await waitForExit(worker);
    }
    firstCoordinator.onModuleDestroy();
    secondCoordinator.onModuleDestroy();
    database.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('retires only an exiting worker ticket and preserves the shared result for its survivor', async () => {
    const leader = firstCoordinator.registerTicket(
      7,
      'worker-exit',
      '{"quantity":1}',
    );
    const participant = secondCoordinator.registerTicket(
      7,
      'worker-exit',
      '{"quantity":1}',
    );
    if (leader.kind !== 'leader' || participant.kind !== 'participant') {
      throw new Error('The coordinators did not create a shared generation.');
    }

    const sharedResponse = { status: 201, body: { id: 41 } };
    expect(firstCoordinator.publish(leader.ticketId, sharedResponse)).toBe(
      true,
    );
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_tickets',
      ),
    ).toEqual({ count: 2 });
    expect(
      database.all<{
        phase: string;
        httpStatus: number | null;
        httpBody: string | null;
      }>(
        `SELECT phase, http_status AS httpStatus, http_body AS httpBody
         FROM idempotency_generations`,
      ),
    ).toEqual([
      {
        phase: 'PUBLISHED',
        httpStatus: sharedResponse.status,
        httpBody: JSON.stringify(sharedResponse.body),
      },
    ]);

    worker = createLifecycleWorker();
    lifecycle.register(worker, firstCoordinator.instanceId);
    await waitForReady(worker);
    worker.postMessage({ type: 'exit' });
    await waitForExit(worker);
    worker = undefined;

    expect(
      database.all<{ ticketId: string; instanceId: string }>(
        `SELECT ticket_id AS ticketId, instance_id AS instanceId
         FROM idempotency_tickets`,
      ),
    ).toEqual([
      {
        ticketId: participant.ticketId,
        instanceId: secondCoordinator.instanceId,
      },
    ]);
    expect(
      database.all<{
        phase: string;
        httpStatus: number | null;
        httpBody: string | null;
      }>(
        `SELECT phase, http_status AS httpStatus, http_body AS httpBody
         FROM idempotency_generations`,
      ),
    ).toEqual([
      {
        phase: 'PUBLISHED',
        httpStatus: sharedResponse.status,
        httpBody: JSON.stringify(sharedResponse.body),
      },
    ]);
    expect(secondCoordinator.readTicket(participant.ticketId)).toEqual({
      kind: 'response',
      response: sharedResponse,
    });
  });

  it('retires tickets for still-registered workers during runner teardown', async () => {
    const leader = firstCoordinator.registerTicket(
      7,
      'runner-teardown',
      '{"quantity":1}',
    );
    if (leader.kind !== 'leader') {
      throw new Error('The coordinator did not create a leader ticket.');
    }

    worker = createLifecycleWorker();
    lifecycle.register(worker, firstCoordinator.instanceId);
    await waitForReady(worker);

    lifecycle.retireRegisteredWorkers();

    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_tickets',
      ),
    ).toEqual({ count: 0 });
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM idempotency_generations',
      ),
    ).toEqual({ count: 0 });
  });
});

function createLifecycleWorker(): Worker {
  return new Worker(
    resolve(
      process.cwd(),
      'test/helpers/reservations-concurrency-lifecycle-worker.mjs',
    ),
    { execArgv: [] },
  );
}

function waitForReady(workerToWait: Worker): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    workerToWait.once('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'ready'
      ) {
        resolveReady();
        return;
      }
      rejectReady(new Error('Lifecycle worker returned invalid readiness.'));
    });
    workerToWait.once('error', rejectReady);
  });
}

function waitForExit(workerToWait: Worker): Promise<void> {
  return new Promise((resolveExit, rejectExit) => {
    workerToWait.once('exit', (code) => {
      if (code === 0) {
        resolveExit();
        return;
      }
      rejectExit(new Error(`Lifecycle worker exited with ${code}.`));
    });
    workerToWait.once('error', rejectExit);
  });
}
