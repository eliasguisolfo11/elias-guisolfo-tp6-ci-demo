import { ReservationsConcurrencyHarness } from './helpers/reservations-concurrency-runner.js';
import { existsSync } from 'node:fs';

const SLOT = '2026-12-15T10:00:00-03:00';
const SLOT_BODY = { startsAt: SLOT, quantity: 1 };

describe('Reservations concurrent requests (e2e)', () => {
  let harness: ReservationsConcurrencyHarness;

  beforeAll(async () => {
    harness = await ReservationsConcurrencyHarness.create();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('serializes two independent HTTP requests competing for the last slot', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });

    const result = await harness.race([
      { userIndex: 0, idempotencyKey: 'race-user-one', body: SLOT_BODY },
      { userIndex: 1, idempotencyKey: 'race-user-two', body: SLOT_BODY },
    ]);

    expect(
      result.responses
        .map(({ status }) => status)
        .sort((first, second) => first - second),
    ).toEqual([201, 409]);
    expect(result.workerEvidence).toHaveLength(2);
    expect(
      new Set(result.workerEvidence.map(({ threadId }) => threadId)).size,
    ).toBe(2);
    expect(new Set(result.workerEvidence.map(({ appId }) => appId)).size).toBe(
      2,
    );
    expect(
      new Set(
        result.workerEvidence.map(({ connectionProbe }) => connectionProbe),
      ).size,
    ).toBe(2);
    expect(
      result.workerEvidence.map(({ databasePath }) => databasePath),
    ).toEqual([harness.databasePath, harness.databasePath]);
    expect(result.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
    expect(
      result.responses.find(({ status }) => status === 201)?.body,
    ).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(
      result.responses.find(({ status }) => status === 409)?.body,
    ).toEqual({
      code: 409,
      message: 'La cantidad solicitada supera el cupo disponible.',
      remainingCapacity: 0,
    });
    expect((await harness.readSlots(1)).body).toContainEqual({
      startsAt: SLOT,
      capacity: 1,
      remainingCapacity: 0,
    });
  });

  it('rolls back the held winner and lets the blocked writer reserve the released slot', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });

    const result = await harness.rollbackRace({
      request: {
        userIndex: 0,
        idempotencyKey: 'rollback-winner',
        body: SLOT_BODY,
      },
      waiter: {
        userIndex: 1,
        idempotencyKey: 'rollback-waiter',
        body: SLOT_BODY,
      },
    });

    expect(result.pendingRead.status).toBe(200);
    expect(result.pendingRead.body).toEqual([
      {
        startsAt: SLOT,
        capacity: 1,
        remainingCapacity: 1,
      },
    ]);
    expect(result.pendingRead.body).toContainEqual({
      startsAt: SLOT,
      capacity: 1,
      remainingCapacity: 1,
    });
    expect(result.pendingSnapshot).toMatchObject({
      reservations: 0,
      payments: 0,
      remainingCapacity: 1,
    });
    expect(result.writeAttempt.workerIndex).toBe(1);
    expect(result.writeAttempt.transactionHeldByWorkerIndex).toBe(0);
    expect(result.responses.map(({ status }) => status)).toEqual([502, 201]);
    expect(result.responses[0]?.body).toEqual({
      code: 502,
      message: 'Error interno del servidor.',
    });
    expect(result.responses[1]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(result.afterRollbackRead.body).toEqual([
      {
        startsAt: SLOT,
        capacity: 1,
        remainingCapacity: 1,
      },
    ]);
    expect(result.afterRollbackSnapshot).toMatchObject({
      reservations: 0,
      payments: 0,
      remainingCapacity: 1,
    });
    expect(result.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
    expect(result.finalRead.body).toContainEqual({
      startsAt: SLOT,
      capacity: 1,
      remainingCapacity: 0,
    });
  });

  it('replays one concurrent 201 for the same user, key, and body', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });

    const result = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-201', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-201', body: SLOT_BODY },
    ]);

    expect(result.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(result.responses[0]?.body).toEqual(result.responses[1]?.body);
    expect(result.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(result.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
  });

  it('returns the same concurrent 409 body without consuming the key', async () => {
    await harness.reset({
      startsAt: SLOT,
      capacity: 1,
      occupiedQuantity: 1,
    });

    const rejected = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-409', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-409', body: SLOT_BODY },
    ]);

    expect(rejected.responses.map(({ status }) => status)).toEqual([409, 409]);
    expect(rejected.responses[0]?.body).toEqual(rejected.responses[1]?.body);
    expect(rejected.responses[0]?.body).toEqual({
      code: 409,
      message: 'La cantidad solicitada supera el cupo disponible.',
      remainingCapacity: 0,
    });
    expect(rejected.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });

    harness.setCapacity(2);
    const retried = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-409', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-409', body: SLOT_BODY },
    ]);

    expect(retried.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(retried.responses[0]?.body).toEqual(retried.responses[1]?.body);
    expect(retried.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(retried.finalSnapshot).toMatchObject({
      reservations: 2,
      payments: 2,
      remainingCapacity: 0,
    });
  });

  it('returns the same concurrent 502 body and leaves the key available to retry', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });

    const failed = await harness.race([
      {
        userIndex: 0,
        idempotencyKey: 'duplicate-502',
        body: SLOT_BODY,
        payment: 'failure',
      },
      {
        userIndex: 0,
        idempotencyKey: 'duplicate-502',
        body: SLOT_BODY,
        payment: 'failure',
      },
    ]);

    expect(failed.responses.map(({ status }) => status)).toEqual([502, 502]);
    expect(failed.responses[0]?.body).toEqual(failed.responses[1]?.body);
    expect(failed.responses[0]?.body).toEqual({
      code: 502,
      message: 'Error interno del servidor.',
    });
    expect(failed.finalSnapshot).toMatchObject({
      reservations: 0,
      payments: 0,
      remainingCapacity: 1,
    });

    const retried = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-502', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-502', body: SLOT_BODY },
    ]);

    expect(retried.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(retried.responses[0]?.body).toEqual(retried.responses[1]?.body);
    expect(retried.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(retried.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
  });

  it('returns the same concurrent 400 body and leaves the key available to retry', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });
    const invalidBody = { startsAt: '2027-01-01T10:00:00', quantity: 1 };

    const rejected = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-400', body: invalidBody },
      { userIndex: 0, idempotencyKey: 'duplicate-400', body: invalidBody },
    ]);

    expect(rejected.responses.map(({ status }) => status)).toEqual([400, 400]);
    expect(rejected.responses[0]?.body).toEqual(rejected.responses[1]?.body);
    expect(rejected.responses[0]?.body).toEqual({
      code: 400,
      message:
        'La fecha y hora debe ser ISO válida e incluir un offset explícito.',
    });
    expect(rejected.finalSnapshot).toMatchObject({
      reservations: 0,
      payments: 0,
      remainingCapacity: 1,
    });

    const retried = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-400', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-400', body: SLOT_BODY },
    ]);

    expect(retried.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(retried.responses[0]?.body).toEqual(retried.responses[1]?.body);
    expect(retried.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(retried.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
  });

  it('returns the same concurrent 404 body and leaves the key available to retry', async () => {
    await harness.reset({});
    const requestBody = { startsAt: '2027-01-01T10:00:00-03:00', quantity: 1 };

    const rejected = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-404', body: requestBody },
      { userIndex: 0, idempotencyKey: 'duplicate-404', body: requestBody },
    ]);

    expect(rejected.responses.map(({ status }) => status)).toEqual([404, 404]);
    expect(rejected.responses[0]?.body).toEqual(rejected.responses[1]?.body);
    expect(rejected.responses[0]?.body).toEqual({
      code: 404,
      message: 'No existe un turno para esa fecha y hora.',
    });
    expect(rejected.finalSnapshot).toMatchObject({
      reservations: 0,
      payments: 0,
      remainingCapacity: null,
    });

    await harness.reset({ startsAt: SLOT, capacity: 1 });
    const retried = await harness.race([
      { userIndex: 0, idempotencyKey: 'duplicate-404', body: SLOT_BODY },
      { userIndex: 0, idempotencyKey: 'duplicate-404', body: SLOT_BODY },
    ]);

    expect(retried.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(retried.responses[0]?.body).toEqual(retried.responses[1]?.body);
    expect(retried.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(retried.finalSnapshot).toMatchObject({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
  });

  it('returns one shared transient failure to duplicate requests and allows a later retry', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 1 });

    const result = await harness.transientDuplicateFailureRace({
      request: {
        userIndex: 0,
        idempotencyKey: 'transient-duplicate-failure',
        body: SLOT_BODY,
      },
      duplicate: {
        userIndex: 0,
        idempotencyKey: 'transient-duplicate-failure',
        body: SLOT_BODY,
      },
    });

    expect(result.paymentProfiles).toEqual([
      {
        workerIndex: 0,
        requestId: expect.any(String),
        outcome: 'failure',
        heldByBarrier: true,
      },
      {
        workerIndex: 1,
        requestId: expect.any(String),
        outcome: 'success',
        heldByBarrier: false,
      },
    ]);
    expect(result.paymentStarted).toMatchObject({
      type: 'payment-waiting',
      workerIndex: 0,
      requestId: result.paymentProfiles[0].requestId,
    });
    expect(result.participantTicketCount).toBe(2);
    expect(result.paymentProfiles[1]).toMatchObject({
      workerIndex: 1,
      requestId: result.paymentProfiles[1].requestId,
      outcome: 'success',
      heldByBarrier: false,
    });
    expect(result.responses).toEqual([
      {
        status: 502,
        body: { code: 502, message: 'Error interno del servidor.' },
      },
      {
        status: 502,
        body: { code: 502, message: 'Error interno del servidor.' },
      },
    ]);
    expect(result.finalSnapshot).toEqual({
      reservations: 0,
      payments: 0,
      remainingCapacity: 1,
    });
    expect(result.finalSnapshot).toEqual(harness.snapshot());
    expect(result.coordinatorGenerations).toBe(0);
    expect(result.coordinatorTickets).toBe(0);
    expect(result.persistedKeyAssociations).toBe(0);

    const retried = await harness.race([
      {
        userIndex: 0,
        idempotencyKey: 'transient-duplicate-failure',
        body: SLOT_BODY,
      },
      {
        userIndex: 0,
        idempotencyKey: 'transient-duplicate-failure',
        body: SLOT_BODY,
      },
    ]);

    expect(retried.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(retried.responses[0]?.body).toEqual(retried.responses[1]?.body);
    expect(retried.responses[0]?.body).toMatchObject({
      startsAt: SLOT,
      quantity: 1,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(retried.finalSnapshot).toEqual({
      reservations: 1,
      payments: 1,
      remainingCapacity: 0,
    });
  }, 30_000);

  it('scopes the same key independently for two users', async () => {
    await harness.reset({ startsAt: SLOT, capacity: 2 });

    const result = await harness.race([
      {
        userIndex: 0,
        idempotencyKey: 'same-key-different-users',
        body: SLOT_BODY,
      },
      {
        userIndex: 1,
        idempotencyKey: 'same-key-different-users',
        body: SLOT_BODY,
      },
    ]);

    expect(result.responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(result.responses[0]?.body).not.toEqual(result.responses[1]?.body);
    expect(result.finalSnapshot).toMatchObject({
      reservations: 2,
      payments: 2,
      remainingCapacity: 0,
    });
  });

  it('retires tickets for registered workers before runner teardown removes its coordination database', async () => {
    const admission = await harness.registerCoordinatorTicket(
      0,
      0,
      'runner-teardown-cleanup',
      '{"quantity":1}',
    );
    expect(admission.kind).toBe('leader');
    expect(harness.fullCoordinatorSnapshot()).toMatchObject({
      tickets: [{ instanceId: expect.any(String) }],
      generations: [
        {
          idempotencyKey: 'runner-teardown-cleanup',
          phase: 'RUNNING',
          httpStatus: null,
          httpBody: null,
        },
      ],
    });

    const coordinationDatabasePath = harness.coordinationDatabasePath;
    const finalSnapshot = await harness.close();

    expect(finalSnapshot).toEqual({ tickets: [], generations: [] });
    expect(existsSync(coordinationDatabasePath)).toBe(false);
  }, 30_000);
});
