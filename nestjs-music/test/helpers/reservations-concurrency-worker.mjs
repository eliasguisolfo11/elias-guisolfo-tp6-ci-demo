import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parentPort, threadId, workerData } from 'node:worker_threads';

if (parentPort === null) {
  throw new Error('Concurrency worker requires a parent thread.');
}

process.env.RESERVATIONS_DATABASE_PATH = workerData.reservationsDatabasePath;
process.env.RESERVATIONS_COORDINATION_DATABASE_PATH =
  workerData.coordinationDatabasePath;
process.env.AUTH_DATABASE_PATH = workerData.authDatabasePath;
process.env.JWT_SECRET = workerData.jwtSecret;
if (typeof workerData.catalogDatabasePath === 'string') {
  process.env.DATABASE_PATH = workerData.catalogDatabasePath;
}

let app;
let database;
let coordinator;
let port;
let activeRequestId = null;
let paymentBehavior = { kind: 'success', outcome: 'success' };
let capturePaymentEvidence = false;
let isShuttingDown = false;

async function start() {
  try {
    const testing = await import('@nestjs/testing');
    const nestCommon = await import('@nestjs/common');
    const databaseModule = await import(
      pathToFileURL(workerData.appModulePath).href.replace(
        /app\.module\.js$/u,
        'reservations/reservations.database.service.js',
      )
    );
    const coordinatorModule = await import(
      pathToFileURL(workerData.appModulePath).href.replace(
        /app\.module\.js$/u,
        'reservations/reservations-idempotency-coordinator.service.js',
      )
    );
    const appModule = await import(
      pathToFileURL(workerData.appModulePath).href
    );
    const paymentModule = await import(
      pathToFileURL(workerData.appModulePath).href.replace(
        /app\.module\.js$/u,
        'reservations/payment-simulator.js',
      )
    );
    const clockModule = await import(
      pathToFileURL(workerData.appModulePath).href.replace(
        /app\.module\.js$/u,
        'reservations/reservation-clock.js',
      )
    );
    const filterModule = await import(
      pathToFileURL(workerData.appModulePath).href.replace(
        /app\.module\.js$/u,
        'common/filters/api-exception.filter.js',
      )
    );

    const paymentSimulator = {
      confirm() {
        if (paymentBehavior.kind === 'failure') {
          throw new Error('Concurrency test payment failure.');
        }

        if (paymentBehavior.kind === 'hold') {
          const gate = new Int32Array(paymentBehavior.gate);
          Atomics.store(gate, 0, 1);
          Atomics.notify(gate, 0);
          parentPort.postMessage({
            type: 'payment-waiting',
            workerIndex: workerData.workerIndex,
            requestId: activeRequestId,
          });
          const result = Atomics.wait(gate, 1, 0, 30_000);
          const releaseValue = Atomics.load(gate, 1);
          if (
            result === 'timed-out' ||
            (releaseValue !== 1 && releaseValue !== 2)
          ) {
            throw new Error('Concurrency test payment barrier timed out.');
          }
          if (paymentBehavior.outcome === 'failure' || releaseValue === 2) {
            throw new Error('Concurrency test payment failure.');
          }
        }

        return { result: 'EXITOSO' };
      },
    };
    const fixedClock = { now: () => new Date('2026-11-12T12:00:00.000Z') };
    const moduleBuilder = testing.Test.createTestingModule({
      imports: [appModule.AppModule],
    })
      .overrideProvider(paymentModule.PaymentSimulator)
      .useValue(paymentSimulator)
      .overrideProvider(clockModule.ReservationClock)
      .useValue(fixedClock);
    const testingModule = await moduleBuilder.compile();
    app = testingModule.createNestApplication();
    app.useGlobalFilters(new filterModule.ApiExceptionFilter());
    app.useGlobalPipes(
      new nestCommon.ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new nestCommon.BadRequestException({
            message: 'Los datos enviados no son válidos.',
            errors: errors.map((error) => ({
              field: error.property,
              message:
                Object.values(error.constraints ?? {}).join(' ') ||
                'Valor inválido.',
            })),
          }),
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    database = app.get(databaseModule.ReservationsDatabaseService);
    coordinator = app.get(
      coordinatorModule.ReservationsIdempotencyCoordinatorService,
    );

    const connectionProbe = randomUUID();
    database.run(
      'CREATE TEMP TABLE worker_connection_probe (connection_id TEXT NOT NULL)',
    );
    database.run(
      'INSERT INTO worker_connection_probe (connection_id) VALUES (?)',
      connectionProbe,
    );
    const persistedProbe = database.get(
      'SELECT connection_id AS connectionId FROM worker_connection_probe',
    );
    if (persistedProbe?.connectionId !== connectionProbe) {
      throw new Error('Worker connection-local probe was not isolated.');
    }

    const address = app.getHttpServer().address();
    if (address === null || typeof address === 'string') {
      throw new Error('Worker app did not expose its HTTP port.');
    }
    port = address.port;

    const databasePath = database
      .all('PRAGMA database_list')
      .find((entry) => entry.name === 'main')?.file;
    const appId = randomUUID();
    const originalTransactionImmediate =
      database.transactionImmediate.bind(database);
    database.transactionImmediate = (operation) => {
      if (activeRequestId !== null) {
        parentPort.postMessage({
          type: 'write-attempt',
          workerIndex: workerData.workerIndex,
          requestId: activeRequestId,
          appId,
          connectionProbe,
        });
      }
      return originalTransactionImmediate(operation);
    };

    parentPort.postMessage({
      type: 'ready',
      workerIndex: workerData.workerIndex,
      evidence: {
        workerIndex: workerData.workerIndex,
        threadId,
        appId,
        connectionProbe,
        databasePath,
        coordinatorInstanceId: coordinator.instanceId,
        port,
      },
    });
    parentPort.on('message', handleCommand);
  } catch (error) {
    parentPort.postMessage({
      type: 'startup-error',
      workerIndex: workerData.workerIndex,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    await closeApp();
  }
}

async function handleCommand(command) {
  if (command?.type === 'shutdown') {
    isShuttingDown = true;
    await closeApp();
    parentPort.postMessage({
      type: 'stopped',
      workerIndex: workerData.workerIndex,
    });
    parentPort.close();
    return;
  }

  if (command?.type === 'register-coordinator-ticket') {
    const admission = coordinator.registerTicket(
      command.userId,
      command.idempotencyKey,
      command.canonicalContent,
    );
    parentPort.postMessage({
      type: 'coordinator-ticket',
      workerIndex: workerData.workerIndex,
      requestId: command.requestId,
      admission,
    });
    return;
  }

  if (command?.type === 'read-slots') {
    await respondToHttpRequest(
      command,
      'slots-response',
      'GET',
      '/reservations/slots',
    );
    return;
  }

  if (command?.type !== 'create-reservation') {
    return;
  }

  if (command.startBarrier instanceof SharedArrayBuffer) {
    const startBarrier = new Int32Array(command.startBarrier);
    Atomics.add(startBarrier, 0, 1);
    parentPort.postMessage({
      type: 'start-ready',
      workerIndex: workerData.workerIndex,
      requestId: command.requestId,
    });
    const result = Atomics.wait(startBarrier, 1, 0, 30_000);
    if (result === 'timed-out') {
      parentPort.postMessage({
        type: 'command-error',
        workerIndex: workerData.workerIndex,
        requestId: command.requestId,
        error: 'Concurrent request barrier timed out.',
      });
      return;
    }
  }

  const paymentOutcome =
    command.payment === 'failure' || command.payment === 'hold-failure'
      ? 'failure'
      : 'success';
  const heldByBarrier =
    command.payment === 'hold' ||
    command.payment === 'hold-failure' ||
    command.payment === 'hold-success';
  paymentBehavior = heldByBarrier
    ? { kind: 'hold', gate: command.paymentGate, outcome: paymentOutcome }
    : { kind: paymentOutcome, outcome: paymentOutcome };
  capturePaymentEvidence = command.capturePaymentEvidence === true;
  if (capturePaymentEvidence) {
    parentPort.postMessage({
      type: 'payment-profile',
      workerIndex: workerData.workerIndex,
      requestId: command.requestId,
      outcome: paymentOutcome,
      heldByBarrier,
    });
  }
  await respondToHttpRequest(
    command,
    'reservation-response',
    'POST',
    '/reservations',
    {
      'Idempotency-Key': command.idempotencyKey,
    },
    command.body,
  );
}

async function respondToHttpRequest(
  command,
  responseType,
  method,
  pathname,
  extraHeaders = {},
  body,
) {
  const requestId = command.requestId;
  activeRequestId = requestId;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${command.token}`,
        ...extraHeaders,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let responseBody;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
    }
    parentPort.postMessage({
      type: responseType,
      workerIndex: workerData.workerIndex,
      requestId,
      status: response.status,
      body: responseBody,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'command-error',
      workerIndex: workerData.workerIndex,
      requestId,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    activeRequestId = null;
    capturePaymentEvidence = false;
  }
}

async function closeApp() {
  if (!app || (isShuttingDown && app.isClosed)) {
    return;
  }
  try {
    await app.close();
  } catch {
    // A failed start can leave a partial module; terminating the worker closes it.
  }
}

void start();
