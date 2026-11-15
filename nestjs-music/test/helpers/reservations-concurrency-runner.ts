import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { AuthDatabaseService } from '../../src/auth/auth-database.service.js';
import { AuthRepository } from '../../src/auth/auth.repository.js';
import { AUTH_TEST_JWT_SECRET } from './auth-test-context.js';
import { createTemporaryAuthDatabase } from './temp-auth-database.js';
import { createTemporaryReservationsDatabase } from './temp-reservations-database.js';
import { createTemporaryReservationsCoordinationDatabase } from './temp-reservations-coordination-database.js';
import { ReservationsIdempotencyCoordinatorDatabaseService } from '../../src/reservations/reservations-idempotency-coordinator.database.service.js';

export interface ReservationRequestPlan {
  userIndex: 0 | 1;
  idempotencyKey: string;
  body: unknown;
  payment?: 'success' | 'failure';
}

export interface ReservationHttpResult {
  status: number;
  body: unknown;
}

export interface ReservationWorkerEvidence {
  workerIndex: number;
  threadId: number;
  appId: string;
  connectionProbe: string;
  databasePath: string;
  coordinatorInstanceId: string;
  port: number;
}

export interface ReservationCoordinatorTicketSnapshot {
  ticketId: string;
  generationId: string;
  instanceId: string;
}

export interface ReservationCoordinatorGenerationSnapshot {
  generationId: string;
  idempotencyKey: string;
  phase: string;
  httpStatus: number | null;
  httpBody: string | null;
}

export interface ReservationCoordinatorSnapshot {
  tickets: ReservationCoordinatorTicketSnapshot[];
  generations: ReservationCoordinatorGenerationSnapshot[];
}

export interface ReservationCoordinatorAdmission {
  kind: 'leader' | 'participant' | 'draining' | 'conflict';
  ticketId?: string;
  generationId?: string;
}

export class CoordinatorWorkerLifecycle {
  private readonly registeredWorkers = new Map<Worker, string>();

  constructor(
    private readonly database: ReservationsIdempotencyCoordinatorDatabaseService,
  ) {}

  register(worker: Worker, instanceId: string): void {
    this.registeredWorkers.set(worker, instanceId);
    worker.once('exit', () => this.retireWorker(worker));
  }

  retireRegisteredWorkers(): void {
    for (const worker of this.registeredWorkers.keys()) {
      this.retireWorker(worker);
    }
  }

  private retireWorker(worker: Worker): void {
    const instanceId = this.registeredWorkers.get(worker);
    if (instanceId === undefined) {
      return;
    }

    this.database.retireInstance(instanceId);
    this.registeredWorkers.delete(worker);
  }
}

export interface ReservationDatabaseSnapshot {
  reservations: number;
  payments: number;
  remainingCapacity: number | null;
}

export interface ReservationPaymentProfileEvidence {
  workerIndex: 0 | 1;
  requestId: string;
  outcome: 'success' | 'failure';
  heldByBarrier: boolean;
}

interface WorkerMessage {
  type: string;
  workerIndex: number;
  [key: string]: unknown;
}

interface PendingMessage {
  matches: (message: WorkerMessage) => boolean;
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ResetScenario {
  startsAt?: string;
  capacity?: number;
  occupiedQuantity?: number;
}

interface RaceResult {
  responses: [ReservationHttpResult, ReservationHttpResult];
  workerEvidence: [ReservationWorkerEvidence, ReservationWorkerEvidence];
  finalSnapshot: ReservationDatabaseSnapshot;
}

interface RollbackRaceResult {
  responses: [ReservationHttpResult, ReservationHttpResult];
  paymentProfiles: [
    ReservationPaymentProfileEvidence,
    ReservationPaymentProfileEvidence,
  ];
  paymentStarted: WorkerMessage;
  pendingRead: ReservationHttpResult;
  pendingSnapshot: ReservationDatabaseSnapshot;
  afterRollbackRead: ReservationHttpResult;
  afterRollbackSnapshot: ReservationDatabaseSnapshot;
  writeAttempt: WorkerMessage & {
    transactionHeldByWorkerIndex: number;
  };
  finalRead: ReservationHttpResult;
  finalSnapshot: ReservationDatabaseSnapshot;
}

type TransientDuplicateFailureRaceResult = Pick<
  RollbackRaceResult,
  'paymentProfiles' | 'paymentStarted' | 'finalSnapshot'
> & {
  responses: [ReservationHttpResult, ReservationHttpResult];
  participantTicketCount: number;
  coordinatorGenerations: number;
  coordinatorTickets: number;
  persistedKeyAssociations: number;
};
const READY_TIMEOUT_MS = 20_000;
const MESSAGE_TIMEOUT_MS = 20_000;

export class ReservationsConcurrencyHarness {
  readonly databasePath: string;
  readonly coordinationDatabasePath: string;

  private readonly workers: Worker[] = [];
  private readonly messageQueues: [WorkerMessage[], WorkerMessage[]] = [[], []];
  private readonly messageWaiters: [PendingMessage[], PendingMessage[]] = [
    [],
    [],
  ];
  private readonly workerEvidence: ReservationWorkerEvidence[] = [];
  private readonly reservationTemporaryDatabase =
    createTemporaryReservationsDatabase();
  private readonly coordinationTemporaryDatabase =
    createTemporaryReservationsCoordinationDatabase();
  private readonly authTemporaryDatabase = createTemporaryAuthDatabase();
  private readonly authDatabase: AuthDatabaseService;
  private readonly authTokens: [string, string];
  private readonly authUserIds: [number, number];
  private readonly observerDatabase: Database.Database;
  private readonly observerCoordinationDatabase: Database.Database;
  private readonly coordinatorDatabase: ReservationsIdempotencyCoordinatorDatabaseService;
  private readonly workerLifecycle: CoordinatorWorkerLifecycle;
  private finalCoordinatorSnapshot: ReservationCoordinatorSnapshot | undefined;
  private closing = false;
  private closed = false;
  private requestSequence = 0;

  private constructor() {
    this.databasePath = this.reservationTemporaryDatabase.path;
    this.coordinationDatabasePath = this.coordinationTemporaryDatabase.path;
    this.observerDatabase = new Database(this.databasePath);
    this.observerDatabase.pragma('foreign_keys = ON');
    this.observerCoordinationDatabase = new Database(
      this.coordinationDatabasePath,
    );
    this.observerCoordinationDatabase.pragma('foreign_keys = ON');
    this.coordinatorDatabase = new ReservationsIdempotencyCoordinatorDatabaseService(
      new ConfigService({
        RESERVATIONS_COORDINATION_DATABASE_PATH: this.coordinationDatabasePath,
      }),
    );
    this.workerLifecycle = new CoordinatorWorkerLifecycle(
      this.coordinatorDatabase,
    );

    this.authDatabase = new AuthDatabaseService(
      new ConfigService({
        AUTH_DATABASE_PATH: this.authTemporaryDatabase.path,
      }),
    );
    const authRepository = new AuthRepository(this.authDatabase);
    const firstUser = authRepository.create({
      username: `concurrency-viewer-${randomUUID()}`,
      email: `concurrency-viewer-${randomUUID()}@example.test`,
      passwordHash: 'concurrency-test-fixture-hash',
      role: 'viewer',
      enabled: true,
    });
    const secondUser = authRepository.create({
      username: `concurrency-viewer-${randomUUID()}`,
      email: `concurrency-viewer-${randomUUID()}@example.test`,
      passwordHash: 'concurrency-test-fixture-hash',
      role: 'viewer',
      enabled: true,
    });
    const jwtService = new JwtService({ secret: AUTH_TEST_JWT_SECRET });
    this.authTokens = [
      jwtService.sign({ sub: String(firstUser.id) }),
      jwtService.sign({ sub: String(secondUser.id) }),
    ];
    this.authUserIds = [firstUser.id, secondUser.id];
    this.authDatabase.onModuleDestroy();
  }

  static async create(): Promise<ReservationsConcurrencyHarness> {
    const harness = new ReservationsConcurrencyHarness();
    try {
      await harness.startWorkers();
      return harness;
    } catch (error) {
      await harness.close();
      throw error;
    }
  }

  async reset(scenario: ResetScenario): Promise<void> {
    this.observerDatabase.exec(
      'DELETE FROM payments; DELETE FROM reservations; DELETE FROM slots;',
    );

    if (scenario.startsAt === undefined || scenario.capacity === undefined) {
      return;
    }

    const startsAtUtc = new Date(scenario.startsAt).toISOString();
    const slot = this.observerDatabase
      .prepare(
        `INSERT INTO slots (starts_at, starts_at_utc, capacity)
         VALUES (?, ?, ?)`,
      )
      .run(scenario.startsAt, startsAtUtc, scenario.capacity);
    const occupiedQuantity = scenario.occupiedQuantity ?? 0;

    if (occupiedQuantity > 0) {
      const reservation = this.observerDatabase
        .prepare(
          `INSERT INTO reservations (
             user_id, slot_id, quantity, status, idempotency_key, request_payload
           ) VALUES (?, ?, ?, 'PAGADA', ?, ?)`,
        )
        .run(
          99_999,
          Number(slot.lastInsertRowid),
          occupiedQuantity,
          'concurrency-prefill',
          '{}',
        );
      this.observerDatabase
        .prepare(
          "INSERT INTO payments (reservation_id, result) VALUES (?, 'EXITOSO')",
        )
        .run(Number(reservation.lastInsertRowid));
    }
  }

  setCapacity(capacity: number): void {
    const result = this.observerDatabase
      .prepare('UPDATE slots SET capacity = ?')
      .run(capacity);
    if (result.changes !== 1) {
      throw new Error(
        'Expected exactly one slot while changing test capacity.',
      );
    }
  }

  async race(
    requests: [ReservationRequestPlan, ReservationRequestPlan],
  ): Promise<RaceResult> {
    const requestIds = [this.nextRequestId(), this.nextRequestId()] as const;
    const startBarrier = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * 2,
    );
    const barrier = new Int32Array(startBarrier);
    const responsePromises = requestIds.map((requestId, index) =>
      this.waitForMessage(
        index,
        (message) =>
          message.type === 'reservation-response' &&
          message.requestId === requestId,
      ),
    );
    const startPromises = requestIds.map((requestId, index) =>
      this.waitForMessage(
        index,
        (message) =>
          message.type === 'start-ready' && message.requestId === requestId,
      ),
    );

    requests.forEach((request, index) => {
      this.workers[index]?.postMessage({
        type: 'create-reservation',
        requestId: requestIds[index],
        token: this.tokenFor(request.userIndex),
        idempotencyKey: request.idempotencyKey,
        body: request.body,
        payment: request.payment ?? 'success',
        startBarrier,
      });
    });

    await startPromises[0];
    await startPromises[1];
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, 2);

    const firstResponseMessage = await responsePromises[0];
    const secondResponseMessage = await responsePromises[1];
    return {
      responses: [
        toHttpResult(firstResponseMessage),
        toHttpResult(secondResponseMessage),
      ],
      workerEvidence: this.getWorkerEvidence(),
      finalSnapshot: this.snapshot(),
    };
  }

  async transientDuplicateFailureRace(input: {
    request: ReservationRequestPlan;
    duplicate: ReservationRequestPlan;
  }): Promise<TransientDuplicateFailureRaceResult> {
    if (
      input.request.userIndex !== input.duplicate.userIndex ||
      input.request.idempotencyKey !== input.duplicate.idempotencyKey ||
      JSON.stringify(input.request.body) !==
        JSON.stringify(input.duplicate.body)
    ) {
      throw new Error(
        'Transient duplicate requests must share user, key, and body.',
      );
    }

    const winnerRequestId = this.nextRequestId();
    const duplicateRequestId = this.nextRequestId();
    const paymentGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const gate = new Int32Array(paymentGate);
    const winnerResponsePromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'reservation-response' &&
        message.requestId === winnerRequestId,
      MESSAGE_TIMEOUT_MS,
      'held leader HTTP response',
    );
    const winnerPaymentProfilePromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'payment-profile' &&
        message.requestId === winnerRequestId,
      MESSAGE_TIMEOUT_MS,
      'held leader payment profile',
    );
    const paymentStartedPromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'payment-waiting' &&
        message.requestId === winnerRequestId,
      MESSAGE_TIMEOUT_MS,
      'held leader payment barrier',
    );

    this.workers[0]?.postMessage({
      type: 'create-reservation',
      requestId: winnerRequestId,
      token: this.tokenFor(input.request.userIndex),
      idempotencyKey: input.request.idempotencyKey,
      body: input.request.body,
      payment: 'hold-failure',
      paymentGate,
      capturePaymentEvidence: true,
    });

    const winnerPaymentProfile = toPaymentProfileEvidence(
      await winnerPaymentProfilePromise,
    );
    const paymentStarted = await paymentStartedPromise;
    const duplicateResponsePromise = this.waitForMessage(
      1,
      (message) =>
        message.type === 'reservation-response' &&
        message.requestId === duplicateRequestId,
      MESSAGE_TIMEOUT_MS,
      'duplicate HTTP response',
    );
    const duplicatePaymentProfilePromise = this.waitForMessage(
      1,
      (message) =>
        message.type === 'payment-profile' &&
        message.requestId === duplicateRequestId,
      MESSAGE_TIMEOUT_MS,
      'duplicate payment profile',
    );
    this.workers[1]?.postMessage({
      type: 'create-reservation',
      requestId: duplicateRequestId,
      token: this.tokenFor(input.duplicate.userIndex),
      idempotencyKey: input.duplicate.idempotencyKey,
      body: input.duplicate.body,
      payment: 'success',
      capturePaymentEvidence: true,
    });

    const duplicatePaymentProfile = toPaymentProfileEvidence(
      await duplicatePaymentProfilePromise,
    );
    const participantTicketCount = await this.waitForCoordinatorTickets(
      this.authUserId(input.request.userIndex),
      input.request.idempotencyKey,
      2,
    );

    Atomics.store(gate, 1, 2);
    Atomics.notify(gate, 1);

    const winnerResponse = toHttpResult(await winnerResponsePromise);
    const duplicateResponse = toHttpResult(await duplicateResponsePromise);
    const finalSnapshot = this.snapshot();
    const coordinatorSnapshot = this.coordinatorSnapshot(
      this.authUserId(input.request.userIndex),
      input.request.idempotencyKey,
    );
    const persistedKeyAssociations = this.observerDatabase
      .prepare(
        `SELECT COUNT(*) AS count FROM reservations
         WHERE user_id = ? AND idempotency_key = ?`,
      )
      .get<{ count: number }>(
        this.authUserId(input.request.userIndex),
        input.request.idempotencyKey,
      );

    return {
      responses: [winnerResponse, duplicateResponse],
      paymentProfiles: [winnerPaymentProfile, duplicatePaymentProfile],
      paymentStarted,
      participantTicketCount,
      coordinatorGenerations: coordinatorSnapshot.generations,
      coordinatorTickets: coordinatorSnapshot.tickets,
      persistedKeyAssociations: persistedKeyAssociations?.count ?? 0,
      finalSnapshot,
    };
  }

  async rollbackRace(input: {
    request: ReservationRequestPlan;
    waiter: ReservationRequestPlan;
    waiterPayment?: 'hold' | 'success';
  }): Promise<RollbackRaceResult> {
    const winnerRequestId = this.nextRequestId();
    const waiterRequestId = this.nextRequestId();
    const paymentGate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const waiterPaymentGate = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * 2,
    );
    const gate = new Int32Array(paymentGate);
    const waiterGate = new Int32Array(waiterPaymentGate);
    const waiterPaymentMode = input.waiterPayment ?? 'hold';
    const winnerResponsePromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'reservation-response' &&
        message.requestId === winnerRequestId,
    );
    const winnerPaymentProfilePromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'payment-profile' &&
        message.requestId === winnerRequestId,
    );
    const winnerPaymentPromise = this.waitForMessage(
      0,
      (message) =>
        message.type === 'payment-waiting' &&
        message.requestId === winnerRequestId,
    );

    this.workers[0]?.postMessage({
      type: 'create-reservation',
      requestId: winnerRequestId,
      token: this.tokenFor(input.request.userIndex),
      idempotencyKey: input.request.idempotencyKey,
      body: input.request.body,
      payment: 'hold-failure',
      paymentGate,
      capturePaymentEvidence: true,
    });

    const winnerPaymentProfile = toPaymentProfileEvidence(
      await winnerPaymentProfilePromise,
    );
    const paymentStarted = await winnerPaymentPromise;
    const pendingRead = await this.readSlots(1);
    const pendingSnapshot = this.snapshot();
    const waiterWriteAttemptPromise = this.waitForMessage(
      1,
      (message) =>
        message.type === 'write-attempt' &&
        message.requestId === waiterRequestId,
    );
    const waiterResponsePromise = this.waitForMessage(
      1,
      (message) =>
        message.type === 'reservation-response' &&
        message.requestId === waiterRequestId,
    );
    const waiterPaymentProfilePromise = this.waitForMessage(
      1,
      (message) =>
        message.type === 'payment-profile' &&
        message.requestId === waiterRequestId,
    );
    const waiterPaymentPromise =
      waiterPaymentMode === 'hold'
        ? this.waitForMessage(
            1,
            (message) =>
              message.type === 'payment-waiting' &&
              message.requestId === waiterRequestId,
          )
        : undefined;

    this.workers[1]?.postMessage({
      type: 'create-reservation',
      requestId: waiterRequestId,
      token: this.tokenFor(input.waiter.userIndex),
      idempotencyKey: input.waiter.idempotencyKey,
      body: input.waiter.body,
      payment: waiterPaymentMode === 'hold' ? 'hold-success' : 'success',
      ...(waiterPaymentMode === 'hold'
        ? { paymentGate: waiterPaymentGate }
        : {}),
      capturePaymentEvidence: true,
    });

    const waiterPaymentProfile = toPaymentProfileEvidence(
      await waiterPaymentProfilePromise,
    );
    const writeAttempt = await waiterWriteAttemptPromise;
    const heldWriteAttempt = {
      ...writeAttempt,
      transactionHeldByWorkerIndex: 0,
    };
    Atomics.store(gate, 1, 2);
    Atomics.notify(gate, 1);

    const winnerResponse = await winnerResponsePromise;
    if (waiterPaymentPromise !== undefined) {
      await waiterPaymentPromise;
    }
    const afterRollbackRead = await this.readSlots(0);
    const afterRollbackSnapshot = this.snapshot();
    if (waiterPaymentMode === 'hold') {
      Atomics.store(waiterGate, 1, 1);
      Atomics.notify(waiterGate, 1);
    }
    const waiterResponse = await waiterResponsePromise;
    const finalRead = await this.readSlots(0);

    return {
      responses: [toHttpResult(winnerResponse), toHttpResult(waiterResponse)],
      paymentProfiles: [winnerPaymentProfile, waiterPaymentProfile],
      paymentStarted,
      pendingRead,
      pendingSnapshot,
      afterRollbackRead,
      afterRollbackSnapshot,
      writeAttempt: heldWriteAttempt,
      finalRead,
      finalSnapshot: this.snapshot(),
    };
  }
  async readSlots(workerIndex: 0 | 1): Promise<ReservationHttpResult> {
    const requestId = this.nextRequestId();
    const responsePromise = this.waitForMessage(
      workerIndex,
      (message) =>
        message.type === 'slots-response' && message.requestId === requestId,
    );
    this.workers[workerIndex]?.postMessage({
      type: 'read-slots',
      requestId,
      token: this.tokenFor(0),
    });
    return toHttpResult(await responsePromise);
  }

  async registerCoordinatorTicket(
    workerIndex: 0 | 1,
    userIndex: 0 | 1,
    idempotencyKey: string,
    canonicalContent: string,
  ): Promise<ReservationCoordinatorAdmission> {
    const requestId = this.nextRequestId();
    const worker = this.workers[workerIndex];
    if (worker === undefined) {
      throw new Error(`Concurrency worker ${workerIndex} is not registered.`);
    }

    const responsePromise = this.waitForMessage(
      workerIndex,
      (message) =>
        message.type === 'coordinator-ticket' &&
        message.requestId === requestId,
    );
    worker.postMessage({
      type: 'register-coordinator-ticket',
      requestId,
      userId: this.authUserId(userIndex),
      idempotencyKey,
      canonicalContent,
    });
    const message = await responsePromise;
    if (!isCoordinatorAdmission(message.admission)) {
      throw new Error('Concurrency worker returned invalid ticket admission.');
    }
    return message.admission;
  }

  fullCoordinatorSnapshot(): ReservationCoordinatorSnapshot {
    return {
      tickets: this.observerCoordinationDatabase
        .prepare(
          `SELECT ticket_id AS ticketId,
                  generation_id AS generationId,
                  instance_id AS instanceId
           FROM idempotency_tickets ORDER BY ticket_id`,
        )
        .all() as ReservationCoordinatorTicketSnapshot[],
      generations: this.observerCoordinationDatabase
        .prepare(
          `SELECT generation_id AS generationId,
                  idempotency_key AS idempotencyKey,
                  phase,
                  http_status AS httpStatus,
                  http_body AS httpBody
           FROM idempotency_generations ORDER BY generation_id`,
        )
        .all() as ReservationCoordinatorGenerationSnapshot[],
    };
  }

  snapshot(): ReservationDatabaseSnapshot {
    const reservations = this.observerDatabase
      .prepare('SELECT COUNT(*) AS count FROM reservations')
      .get() as { count: number };
    const payments = this.observerDatabase
      .prepare('SELECT COUNT(*) AS count FROM payments')
      .get() as { count: number };
    const remainingCapacity = this.observerDatabase
      .prepare(
        `SELECT slots.capacity - COALESCE(
           SUM(CASE WHEN reservations.status IN ('PAGADA', 'COMPLETADA')
                    THEN reservations.quantity ELSE 0 END),
           0
         ) AS remainingCapacity
         FROM slots
         LEFT JOIN reservations ON reservations.slot_id = slots.id
         GROUP BY slots.id
         LIMIT 1`,
      )
      .get() as { remainingCapacity: number } | undefined;

    return {
      reservations: reservations.count,
      payments: payments.count,
      remainingCapacity: remainingCapacity?.remainingCapacity ?? null,
    };
  }

  private authUserId(userIndex: 0 | 1): number {
    return this.authUserIds[userIndex];
  }

  private coordinatorSnapshot(
    userId: number,
    idempotencyKey: string,
  ): { generations: number; tickets: number } {
    const generations = this.observerCoordinationDatabase
      .prepare(
        `SELECT COUNT(*) AS count FROM idempotency_generations
         WHERE user_id = ? AND idempotency_key = ?`,
      )
      .get(userId, idempotencyKey) as { count: number };
    const tickets = this.observerCoordinationDatabase
      .prepare(
        `SELECT COUNT(*) AS count
         FROM idempotency_tickets
         INNER JOIN idempotency_generations
           ON idempotency_generations.generation_id =
              idempotency_tickets.generation_id
         WHERE idempotency_generations.user_id = ?
           AND idempotency_generations.idempotency_key = ?`,
      )
      .get(userId, idempotencyKey) as { count: number };

    return { generations: generations.count, tickets: tickets.count };
  }

  private async waitForCoordinatorTickets(
    userId: number,
    idempotencyKey: string,
    expectedCount: number,
  ): Promise<number> {
    const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
    let ticketCount = 0;
    while (ticketCount < expectedCount) {
      const row = this.observerCoordinationDatabase
        .prepare(
          `SELECT COUNT(*) AS count
           FROM idempotency_tickets
           INNER JOIN idempotency_generations
             ON idempotency_generations.generation_id =
                idempotency_tickets.generation_id
           WHERE idempotency_generations.user_id = ?
             AND idempotency_generations.idempotency_key = ?`,
        )
        .get(userId, idempotencyKey) as { count: number };
      ticketCount = row.count;

      if (ticketCount >= expectedCount) {
        return ticketCount;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${expectedCount} coordinator tickets; found ${ticketCount}.`,
        );
      }

      await new Promise<void>((resolveWait) => setImmediate(resolveWait));
    }

    return ticketCount;
  }

  async close(): Promise<ReservationCoordinatorSnapshot> {
    if (this.closed) {
      return (
        this.finalCoordinatorSnapshot ?? { tickets: [], generations: [] }
      );
    }
    this.closing = true;
    this.workerLifecycle.retireRegisteredWorkers();

    for (let index = 0; index < this.workers.length; index += 1) {
      const worker = this.workers[index];
      if (worker === undefined) {
        continue;
      }

      try {
        const stoppedPromise = this.waitForMessage(
          index,
          (message) => message.type === 'stopped',
          1_500,
        );
        worker.postMessage({ type: 'shutdown' });
        await stoppedPromise;
      } catch {
        // terminate() below is the cleanup fallback for a stuck worker.
      }
    }

    for (const worker of this.workers) {
      await worker.terminate();
    }

    this.workerLifecycle.retireRegisteredWorkers();
    this.finalCoordinatorSnapshot = this.fullCoordinatorSnapshot();

    if (this.observerDatabase.open) {
      this.observerDatabase.close();
    }
    if (this.observerCoordinationDatabase.open) {
      this.observerCoordinationDatabase.close();
    }
    this.coordinatorDatabase.onModuleDestroy();
    this.authDatabase.onModuleDestroy();
    this.reservationTemporaryDatabase.cleanup();
    this.coordinationTemporaryDatabase.cleanup();
    this.authTemporaryDatabase.cleanup();
    this.closed = true;
    return this.finalCoordinatorSnapshot;
  }

  private async startWorkers(): Promise<void> {
    const appModulePath = resolve(process.cwd(), 'dist/app.module.js');
    const workerPath = resolve(
      process.cwd(),
      'test/helpers/reservations-concurrency-worker.mjs',
    );
    const workerData = {
      appModulePath,
      reservationsDatabasePath: this.databasePath,
      coordinationDatabasePath: this.coordinationTemporaryDatabase.path,
      authDatabasePath: this.authTemporaryDatabase.path,
      catalogDatabasePath: process.env.DATABASE_PATH,
      jwtSecret: AUTH_TEST_JWT_SECRET,
    };

    for (let workerIndex = 0; workerIndex < 2; workerIndex += 1) {
      const worker = new Worker(workerPath, {
        workerData: { ...workerData, workerIndex },
        execArgv: [],
      });
      this.workers[workerIndex] = worker;
      worker.on('message', (value: unknown) => {
        if (!isWorkerMessage(value)) {
          return;
        }
        this.deliverMessage(workerIndex, value);
      });
      worker.on('error', (error: Error) => {
        this.rejectWaiters(workerIndex, error);
      });
      worker.on('exit', (code) => {
        if (!this.closing && code !== 0) {
          this.rejectWaiters(
            workerIndex,
            new Error(`Concurrency worker ${workerIndex} exited with ${code}.`),
          );
        }
      });
    }

    for (let workerIndex = 0; workerIndex < 2; workerIndex += 1) {
      const ready = await this.waitForMessage(
        workerIndex,
        (message) =>
          message.type === 'ready' || message.type === 'startup-error',
        READY_TIMEOUT_MS,
        `worker ${workerIndex} startup`,
      );
      if (ready.type === 'startup-error') {
        const startupError = ready.error;
        throw new Error(
          typeof startupError === 'string'
            ? startupError
            : (JSON.stringify(startupError) ??
                'Concurrency worker failed to start.'),
        );
      }

      const evidence = ready.evidence;
      if (!isWorkerEvidence(evidence)) {
        throw new Error(
          'Concurrency worker returned invalid startup evidence.',
        );
      }
      this.workerEvidence[workerIndex] = evidence;
      const worker = this.workers[workerIndex];
      if (worker === undefined) {
        throw new Error(`Concurrency worker ${workerIndex} was not created.`);
      }
      this.workerLifecycle.register(worker, evidence.coordinatorInstanceId);
    }

    const evidence = this.getWorkerEvidence();
    if (
      new Set(evidence.map((worker) => worker.threadId)).size !== 2 ||
      new Set(evidence.map((worker) => worker.appId)).size !== 2 ||
      new Set(evidence.map((worker) => worker.connectionProbe)).size !== 2 ||
      evidence.some((worker) => worker.databasePath !== this.databasePath)
    ) {
      throw new Error(
        'Workers did not prove independent apps and shared database path.',
      );
    }
  }

  private getWorkerEvidence(): [
    ReservationWorkerEvidence,
    ReservationWorkerEvidence,
  ] {
    const first = this.workerEvidence[0];
    const second = this.workerEvidence[1];
    if (first === undefined || second === undefined) {
      throw new Error(
        'Both concurrency workers must be ready before requests run.',
      );
    }
    return [first, second];
  }

  private tokenFor(userIndex: 0 | 1): string {
    return this.authTokens[userIndex];
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `concurrency-request-${this.requestSequence}`;
  }

  private waitForMessage(
    workerIndex: number,
    matches: (message: WorkerMessage) => boolean,
    timeoutMs = MESSAGE_TIMEOUT_MS,
    description = 'worker message',
  ): Promise<WorkerMessage> {
    const queued = this.messageQueues[workerIndex];
    const queuedIndex = queued.findIndex(matches);
    if (queuedIndex >= 0) {
      const message = queued[queuedIndex];
      if (message !== undefined) {
        queued.splice(queuedIndex, 1);
        return Promise.resolve(message);
      }
    }

    return new Promise((resolveMessage, rejectMessage) => {
      const pending: PendingMessage = {
        matches,
        resolve: resolveMessage,
        reject: rejectMessage,
        timeout: setTimeout(() => {
          this.removeWaiter(workerIndex, pending);
          rejectMessage(
            new Error(
              `Timed out waiting for ${description} from concurrency worker ${workerIndex}.`,
            ),
          );
        }, timeoutMs),
      };
      this.messageWaiters[workerIndex].push(pending);
    });
  }

  private deliverMessage(workerIndex: number, message: WorkerMessage): void {
    const waiters = this.messageWaiters[workerIndex];
    const waiterIndex = waiters.findIndex((pending) =>
      pending.matches(message),
    );
    if (waiterIndex < 0) {
      this.messageQueues[workerIndex].push(message);
      return;
    }

    const pending = waiters[waiterIndex];
    if (pending === undefined) {
      return;
    }
    waiters.splice(waiterIndex, 1);
    clearTimeout(pending.timeout);
    pending.resolve(message);
  }

  private rejectWaiters(workerIndex: number, error: Error): void {
    for (const pending of this.messageWaiters[workerIndex].splice(0)) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private removeWaiter(workerIndex: number, pending: PendingMessage): void {
    const index = this.messageWaiters[workerIndex].indexOf(pending);
    if (index >= 0) {
      this.messageWaiters[workerIndex].splice(index, 1);
    }
  }
}

function toHttpResult(message: WorkerMessage): ReservationHttpResult {
  const status = message.status;
  if (typeof status !== 'number') {
    throw new Error('Concurrency worker returned a response without a status.');
  }
  return { status, body: message.body };
}

function toPaymentProfileEvidence(
  message: WorkerMessage,
): ReservationPaymentProfileEvidence {
  if (
    message.type !== 'payment-profile' ||
    (message.workerIndex !== 0 && message.workerIndex !== 1) ||
    typeof message.requestId !== 'string' ||
    (message.outcome !== 'success' && message.outcome !== 'failure') ||
    typeof message.heldByBarrier !== 'boolean'
  ) {
    throw new Error(
      'Concurrency worker returned invalid payment profile evidence.',
    );
  }
  return {
    workerIndex: message.workerIndex,
    requestId: message.requestId,
    outcome: message.outcome,
    heldByBarrier: message.heldByBarrier,
  };
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'workerIndex' in value &&
    typeof value.workerIndex === 'number'
  );
}

function isWorkerEvidence(value: unknown): value is ReservationWorkerEvidence {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'workerIndex' in value &&
    typeof value.workerIndex === 'number' &&
    'threadId' in value &&
    typeof value.threadId === 'number' &&
    'appId' in value &&
    typeof value.appId === 'string' &&
    'connectionProbe' in value &&
    typeof value.connectionProbe === 'string' &&
    'databasePath' in value &&
    typeof value.databasePath === 'string' &&
    'coordinatorInstanceId' in value &&
    typeof value.coordinatorInstanceId === 'string' &&
    'port' in value &&
    typeof value.port === 'number'
  );
}

function isCoordinatorAdmission(
  value: unknown,
): value is ReservationCoordinatorAdmission {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  return (
    value.kind === 'leader' ||
    value.kind === 'participant' ||
    value.kind === 'draining' ||
    value.kind === 'conflict'
  );
}
