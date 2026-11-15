import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { createConnection } from 'node:net';
import type { ValidationError } from 'class-validator';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { ReservationClock } from '../src/reservations/reservation-clock.js';
import { ReservationsDatabaseService } from '../src/reservations/reservations.database.service.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import {
  authenticatedRequest,
  getAuthTestContext,
  viewerRequest,
} from './helpers/auth-test-context.js';

interface PublicReservation {
  id: number;
  startsAt: string;
  quantity: number;
  status: 'PAGADA' | 'CANCELADA' | 'COMPLETADA';
  payment: {
    result: 'EXITOSO';
    createdAt: string;
  };
}

interface PublicSlotAvailability {
  startsAt: string;
  capacity: number;
  remainingCapacity: number;
}

interface DuplicateHeaderResponse {
  status: number;
  body: unknown;
}

const SLOT_10 = '2026-12-15T10:00:00-03:00';
const SLOT_12 = '2026-12-15T12:00:00-03:00';
const SLOT_14 = '2026-12-15T14:00:00-03:00';
const KEY_ERROR =
  'Debe enviar exactamente un encabezado Idempotency-Key no vacío.';
const RESERVATION_NOT_FOUND = {
  code: 404,
  message: 'No existe una reserva con ese id.',
};
const UNKNOWN_ROUTE = { code: 404, message: 'La ruta solicitada no existe.' };
const INVALID_TRANSITION = {
  code: 409,
  message: 'La transición solicitada no está permitida.',
};
const BEFORE_SCHEDULED_TIME = {
  code: 409,
  message: 'La reserva solo puede completarse desde el instante programado.',
};
const FIXED_NOW = Date.parse('2026-11-12T12:00:00.000Z');

describe('Reservations HTTP routes (e2e)', () => {
  let app: INestApplication<App>;
  let database: ReservationsDatabaseService;
  let currentTime: number;

  beforeAll(async () => {
    currentTime = FIXED_NOW;
    const testingModule: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ReservationClock)
      .useValue({ now: () => new Date(currentTime) })
      .compile();

    app = testingModule.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (validationErrors: ValidationError[]) =>
          new BadRequestException({
            message: 'Los datos enviados no son válidos.',
            errors: validationErrors.map((error) => ({
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
    database = app.get(ReservationsDatabaseService);
  });

  beforeEach(() => {
    currentTime = FIXED_NOW;
    database.run('DELETE FROM payments');
    database.run('DELETE FROM reservations');
  });

  afterAll(async () => {
    await app.close();
  });

  it('permite consultar slots a viewer y admin, conserva el offset y publica solo disponibilidad', async () => {
    database.run(
      `INSERT INTO slots (starts_at, starts_at_utc, capacity)
       VALUES (?, ?, ?)`,
      '2026-11-01T10:00:00-03:00',
      '2026-11-01T13:00:00.000Z',
      2,
    );

    const viewerSlots = await viewerRequest(app)
      .get('/reservations/slots')
      .expect(200);
    const adminSlots = await authenticatedRequest(app)
      .get('/reservations/slots')
      .expect(200);

    expect(viewerSlots.body).toEqual([
      {
        startsAt: '2026-11-01T10:00:00-03:00',
        capacity: 2,
        remainingCapacity: 2,
      },
      { startsAt: SLOT_10, capacity: 4, remainingCapacity: 4 },
      { startsAt: SLOT_12, capacity: 4, remainingCapacity: 4 },
      { startsAt: SLOT_14, capacity: 4, remainingCapacity: 4 },
    ]);
    expect(adminSlots.body).toEqual(viewerSlots.body);
  });

  it('requiere autenticación para consultar slots y crear reservas', async () => {
    const unauthenticatedGet = await request(app.getHttpServer())
      .get('/reservations/slots')
      .expect(401);
    const unauthenticatedPost = await request(app.getHttpServer())
      .post('/reservations')
      .set('Idempotency-Key', 'auth-required')
      .send({ startsAt: SLOT_10, quantity: 1 })
      .expect(401);
    const unauthenticatedGetReservation = await request(app.getHttpServer())
      .get('/reservations/1')
      .expect(401);
    const unauthenticatedCancel = await request(app.getHttpServer())
      .post('/reservations/1/cancel')
      .expect(401);
    const unauthenticatedTransition = await request(app.getHttpServer())
      .post('/reservations/1/transitions')
      .send({ status: 'COMPLETADA' })
      .expect(401);

    expect(unauthenticatedGet.headers['www-authenticate']).toBe('Bearer');
    expect(unauthenticatedPost.headers['www-authenticate']).toBe('Bearer');
    expect(unauthenticatedGetReservation.headers['www-authenticate']).toBe(
      'Bearer',
    );
    expect(unauthenticatedCancel.headers['www-authenticate']).toBe('Bearer');
    expect(unauthenticatedTransition.headers['www-authenticate']).toBe(
      'Bearer',
    );
    expect(unauthenticatedPost.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });
  });

  it('permite crear solo a viewer, y rechaza admin sin persistir', async () => {
    const response = await authenticatedRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'admin-cannot-create')
      .send({ startsAt: SLOT_10, quantity: 1 })
      .expect(403);

    expect(response.body).toEqual({ code: 403, message: 'Forbidden resource' });
    expect(countRows('reservations')).toBe(0);
    expect(countRows('payments')).toBe(0);
  });

  it('rechaza claves ausentes, vacías o duplicadas en el request HTTP', async () => {
    const body = { startsAt: SLOT_10, quantity: 1 };
    const missing = await viewerRequest(app)
      .post('/reservations')
      .send(body)
      .expect(400);
    const empty = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', '   ')
      .send(body)
      .expect(400);
    const duplicate = await sendDuplicateIdempotencyHeaders(app, body);

    expect(missing.body).toEqual({ code: 400, message: KEY_ERROR });
    expect(empty.body).toEqual({ code: 400, message: KEY_ERROR });
    expect(duplicate).toEqual({
      status: 400,
      body: { code: 400, message: KEY_ERROR },
    });
    expect(countRows('reservations')).toBe(0);
    expect(countRows('payments')).toBe(0);
  });

  it.each([
    { startsAt: '2027-01-01T10:00:00', quantity: 1 },
    { startsAt: '2027-02-30T10:00:00-03:00', quantity: 1 },
    { startsAt: SLOT_10, quantity: 0 },
    { startsAt: SLOT_10, quantity: -1 },
    { startsAt: SLOT_10, quantity: 1.5 },
    { startsAt: SLOT_10, quantity: '1' },
  ])(
    'rechaza la entrada inválida $startsAt / $quantity sin persistir',
    async (body) => {
      const response = await viewerRequest(app)
        .post('/reservations')
        .set('Idempotency-Key', `invalid-${JSON.stringify(body)}`)
        .send(body)
        .expect(400);

      expect(response.body.code).toBe(400);
      expect(countRows('reservations')).toBe(0);
      expect(countRows('payments')).toBe(0);
    },
  );

  it('responde 400 para un turno pasado antes de buscarlo y no escribe filas', async () => {
    const response = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'past-slot')
      .send({ startsAt: '2025-01-01T10:00:00-03:00', quantity: 1 })
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El turno debe estar en el futuro.',
    });
    expect(countRows('reservations')).toBe(0);
    expect(countRows('payments')).toBe(0);
    expect(await getRemainingCapacity(SLOT_10)).toBe(4);
  });

  it('responde 404 para un turno futuro no configurado y no escribe filas', async () => {
    const response = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'unknown-future-slot')
      .send({ startsAt: '2027-01-01T10:00:00-03:00', quantity: 1 })
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      message: 'No existe un turno para esa fecha y hora.',
    });
    expect(countRows('reservations')).toBe(0);
    expect(countRows('payments')).toBe(0);
  });

  it('crea una representación pública pagada, reproduce exactamente el éxito y prioriza el conflicto', async () => {
    const input = { startsAt: SLOT_10, quantity: 2 };
    const createdResponse = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'http-replay')
      .send(input)
      .expect(201);
    const original = createdResponse.body as PublicReservation;

    expect(original).toMatchObject({
      startsAt: SLOT_10,
      quantity: 2,
      status: 'PAGADA',
      payment: { result: 'EXITOSO' },
    });
    expect(Number.isSafeInteger(original.id)).toBe(true);
    expect(Object.keys(original).sort()).toEqual([
      'id',
      'payment',
      'quantity',
      'startsAt',
      'status',
    ]);
    expect(Object.keys(original.payment).sort()).toEqual([
      'createdAt',
      'result',
    ]);
    expect(original).not.toHaveProperty('userId');
    expect(original).not.toHaveProperty('slotId');
    expect(original).not.toHaveProperty('idempotencyKey');
    expect(original).not.toHaveProperty('requestPayload');
    expect(original.payment).not.toHaveProperty('reservationId');

    const replay = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'http-replay')
      .send(input)
      .expect(201);
    expect(replay.body).toEqual(createdResponse.body);
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
    expect(
      (await viewerRequest(app)
        .get(`/reservations/${original.id}`)
        .expect(200)).body,
    ).toEqual(createdResponse.body);
    expect(
      database.get<{
        status: string;
        quantity: number;
        paymentResult: string;
      }>(
        `SELECT reservations.status, reservations.quantity,
                payments.result AS paymentResult
         FROM reservations
         JOIN payments ON payments.reservation_id = reservations.id
         WHERE reservations.id = ?`,
        original.id,
      ),
    ).toEqual({ status: 'PAGADA', quantity: 2, paymentResult: 'EXITOSO' });

    const invalidDateReplay = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'http-replay')
      .send({ startsAt: 'no-es-una-fecha', quantity: 2 })
      .expect(409);
    const estadoReplay = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'http-replay')
      .send({ ...input, estado: 'CANCELADA' })
      .expect(409);

    expect(invalidDateReplay.body).toEqual({
      code: 409,
      message: 'La clave de idempotencia ya se usó con otro contenido.',
    });
    expect(estadoReplay.body).toEqual(invalidDateReplay.body);
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
    expect(
      (await viewerRequest(app).get('/reservations/slots').expect(200)).body,
    ).toContainEqual({
      startsAt: SLOT_10,
      capacity: 4,
      remainingCapacity: 2,
    });
    expect(
      (await viewerRequest(app)
        .get(`/reservations/${original.id}`)
        .expect(200)).body,
    ).toEqual(createdResponse.body);
    expect(await getStoredStatus(original.id)).toBe('PAGADA');
  });

  it('no consume una clave nueva al rechazar estado y permite reintentar con cuerpo válido', async () => {
    const key = 'new-key-with-state';
    const rejected = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', key)
      .send({ startsAt: SLOT_14, quantity: 1, estado: 'PAGADA' })
      .expect(400);

    expect(rejected.body).toEqual({
      code: 400,
      message: 'El estado de una reserva no puede definirse al crearla.',
    });
    expect(countRows('reservations')).toBe(0);
    expect(countRows('payments')).toBe(0);
    expect(await getRemainingCapacity(SLOT_14)).toBe(4);
    const retried = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', key)
      .send({ startsAt: SLOT_14, quantity: 1 })
      .expect(201);

    expect(retried.body).toMatchObject({ startsAt: SLOT_14, status: 'PAGADA' });
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
    expect(await getRemainingCapacity(SLOT_14)).toBe(3);
  });

  it('rechaza una cantidad por encima del cupo con remainingCapacity y sin escritura parcial', async () => {
    await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'fill-slot')
      .send({ startsAt: SLOT_12, quantity: 3 })
      .expect(201);

    const rejected = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', 'over-capacity')
      .send({ startsAt: SLOT_12, quantity: 2 })
      .expect(409);

    expect(rejected.body).toEqual({
      code: 409,
      message: 'La cantidad solicitada supera el cupo disponible.',
      remainingCapacity: 1,
    });
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
    expect(
      (await viewerRequest(app).get('/reservations/slots').expect(200)).body,
    ).toContainEqual({
      startsAt: SLOT_12,
      capacity: 4,
      remainingCapacity: 1,
    });
  });

  it('permite consultar la reserva propia y cualquiera como admin, y oculta ids ajenos o inexistentes', async () => {
    const created = await createPaidReservation('lookup-ownership');
    const otherViewerToken = getAuthTestContext().createAdditionalViewerToken();
    const path = `/reservations/${created.id}`;

    const ownerResponse = await viewerRequest(app).get(path).expect(200);
    const adminResponse = await authenticatedRequest(app).get(path).expect(200);
    expect(ownerResponse.body).toEqual(created);
    expect(adminResponse.body).toEqual(created);

    const otherViewerResponse = await viewerRequest(app, otherViewerToken)
      .get(path)
      .expect(404);
    const missingViewerResponse = await viewerRequest(app)
      .get('/reservations/2147483647')
      .expect(404);
    const missingAdminResponse = await authenticatedRequest(app)
      .get('/reservations/2147483647')
      .expect(404);

    expect(otherViewerResponse.body).toEqual(RESERVATION_NOT_FOUND);
    expect(missingViewerResponse.body).toEqual(RESERVATION_NOT_FOUND);
    expect(missingAdminResponse.body).toEqual(RESERVATION_NOT_FOUND);
    expect(otherViewerResponse.body).not.toHaveProperty('userId');
  });

  it('cancela una reserva pagada de forma idempotente y libera su cupo una sola vez', async () => {
    const created = await createPaidReservation('cancel-idempotently', 2);
    const path = `/reservations/${created.id}`;

    expect(await getRemainingCapacity(SLOT_10)).toBe(2);

    const firstCancellation = await viewerRequest(app)
      .post(`${path}/cancel`)
      .expect(200);
    const expectedCancellation = { ...created, status: 'CANCELADA' };
    expect(firstCancellation.body).toEqual(expectedCancellation);
    expect(await getRemainingCapacity(SLOT_10)).toBe(4);
    expect(
      database.get<{ status: string }>(
        'SELECT status FROM reservations WHERE id = ?',
        created.id,
      )?.status,
    ).toBe('CANCELADA');

    const repeatedCancellation = await viewerRequest(app)
      .post(`${path}/cancel`)
      .expect(200);
    expect(repeatedCancellation.body).toEqual(firstCancellation.body);
    expect(
      await viewerRequest(app)
        .get(path)
        .expect(200)
        .then((response) => response.body),
    ).toEqual(firstCancellation.body);
    expect(await getRemainingCapacity(SLOT_10)).toBe(4);
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
  });

  it('oculta la cancelación ajena y permite al admin cancelar cualquier reserva pagada', async () => {
    const created = await createPaidReservation('admin-cancel-any-reservation');
    const otherViewerToken = getAuthTestContext().createAdditionalViewerToken();
    const path = `/reservations/${created.id}`;

    const deniedByOwnership = await viewerRequest(app, otherViewerToken)
      .post(`${path}/cancel`)
      .expect(404);
    expect(deniedByOwnership.body).toEqual(RESERVATION_NOT_FOUND);
    expect(await getStoredStatus(created.id)).toBe('PAGADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(3);

    const adminCancellation = await authenticatedRequest(app)
      .post(`${path}/cancel`)
      .expect(200);
    expect(adminCancellation.body).toEqual({ ...created, status: 'CANCELADA' });

    const missingViewerCancellation = await viewerRequest(app)
      .post('/reservations/2147483647/cancel')
      .expect(404);
    const missingAdminCancellation = await authenticatedRequest(app)
      .post('/reservations/2147483647/cancel')
      .expect(404);
    expect(missingViewerCancellation.body).toEqual(RESERVATION_NOT_FOUND);
    expect(missingAdminCancellation.body).toEqual(RESERVATION_NOT_FOUND);
    expect(await getRemainingCapacity(SLOT_10)).toBe(4);
  });

  it('rechaza transiciones inválidas y permite PAGADA a CANCELADA por acción explícita', async () => {
    const created = await createPaidReservation('explicit-cancel-transition');
    const path = `/reservations/${created.id}/transitions`;

    for (const status of ['PENDIENTE', 'PAGADA']) {
      const invalidTransition = await authenticatedRequest(app)
        .post(path)
        .send({ status })
        .expect(409);
      expect(invalidTransition.body).toEqual(INVALID_TRANSITION);
    }
    expect(await getStoredStatus(created.id)).toBe('PAGADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(3);

    const allowedTransition = await viewerRequest(app)
      .post(path)
      .send({ status: 'CANCELADA' })
      .expect(200);
    expect(allowedTransition.body).toEqual({ ...created, status: 'CANCELADA' });
    expect(await getStoredStatus(created.id)).toBe('CANCELADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(4);
  });

  it('completa solo como admin desde el instante programado inclusive y oculta ids ajenos', async () => {
    const created = await createPaidReservation('complete-at-boundary');
    const path = `/reservations/${created.id}/transitions`;
    const otherViewerToken = getAuthTestContext().createAdditionalViewerToken();

    const beforeStart = await authenticatedRequest(app)
      .post(path)
      .send({ status: 'COMPLETADA' })
      .expect(409);
    expect(beforeStart.body).toEqual(BEFORE_SCHEDULED_TIME);
    expect(await getStoredStatus(created.id)).toBe('PAGADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(3);

    const otherViewerCompletion = await viewerRequest(app, otherViewerToken)
      .post(path)
      .send({ status: 'COMPLETADA' })
      .expect(404);
    const missingViewerCompletion = await viewerRequest(app)
      .post('/reservations/2147483647/transitions')
      .send({ status: 'COMPLETADA' })
      .expect(404);
    const missingAdminCompletion = await authenticatedRequest(app)
      .post('/reservations/2147483647/transitions')
      .send({ status: 'COMPLETADA' })
      .expect(404);
    expect(otherViewerCompletion.body).toEqual(RESERVATION_NOT_FOUND);
    expect(missingViewerCompletion.body).toEqual(RESERVATION_NOT_FOUND);
    expect(missingAdminCompletion.body).toEqual(RESERVATION_NOT_FOUND);

    currentTime = Date.parse(SLOT_10);
    const ownerForbidden = await viewerRequest(app)
      .post(path)
      .send({ status: 'COMPLETADA' })
      .expect(403);
    expect(ownerForbidden.body).toEqual({
      code: 403,
      message: 'Solo admin puede completar una reserva.',
    });
    expect(await getStoredStatus(created.id)).toBe('PAGADA');

    const completed = await authenticatedRequest(app)
      .post(path)
      .send({ status: 'COMPLETADA' })
      .expect(200);
    expect(completed.body).toEqual({ ...created, status: 'COMPLETADA' });
    expect(await getStoredStatus(created.id)).toBe('COMPLETADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(3);

    const cancelCompleted = await authenticatedRequest(app)
      .post(`/reservations/${created.id}/cancel`)
      .expect(409);
    expect(cancelCompleted.body).toEqual(INVALID_TRANSITION);
    expect(await getStoredStatus(created.id)).toBe('COMPLETADA');
    expect(await getRemainingCapacity(SLOT_10)).toBe(3);
  });

  it('responde 404 a PUT y PATCH sin mutar reserva ni disponibilidad', async () => {
    const created = await createPaidReservation(
      'unsupported-update',
      1,
      SLOT_14,
    );
    const path = `/reservations/${created.id}`;
    const update = { status: 'CANCELADA', estado: 'CANCELADA' };

    const putResponse = await viewerRequest(app)
      .put(path)
      .send(update)
      .expect(404);
    const patchResponse = await viewerRequest(app)
      .patch(path)
      .send(update)
      .expect(404);
    const adminPutResponse = await authenticatedRequest(app)
      .put(path)
      .send(update)
      .expect(404);
    const adminPatchResponse = await authenticatedRequest(app)
      .patch(path)
      .send(update)
      .expect(404);
    expect(putResponse.body).toEqual(UNKNOWN_ROUTE);
    expect(patchResponse.body).toEqual(UNKNOWN_ROUTE);
    expect(adminPutResponse.body).toEqual(UNKNOWN_ROUTE);
    expect(adminPatchResponse.body).toEqual(UNKNOWN_ROUTE);
    expect(await getStoredStatus(created.id)).toBe('PAGADA');
    expect(await getRemainingCapacity(SLOT_14)).toBe(3);
    expect(
      (await viewerRequest(app).get(path).expect(200)).body,
    ).toEqual(created);
    expect(countRows('reservations')).toBe(1);
    expect(countRows('payments')).toBe(1);
  });

  async function createPaidReservation(
    key: string,
    quantity = 1,
    startsAt = SLOT_10,
  ): Promise<PublicReservation> {
    const response = await viewerRequest(app)
      .post('/reservations')
      .set('Idempotency-Key', key)
      .send({ startsAt, quantity })
      .expect(201);

    return response.body as PublicReservation;
  }

  async function getRemainingCapacity(startsAt: string): Promise<number> {
    const response = await viewerRequest(app)
      .get('/reservations/slots')
      .expect(200);
    const slot = (response.body as PublicSlotAvailability[]).find(
      (item) => item.startsAt === startsAt,
    );
    if (slot === undefined) {
      throw new Error(`No slot was returned for ${startsAt}.`);
    }

    return slot.remainingCapacity;
  }

  async function getStoredStatus(id: number): Promise<string | undefined> {
    return database.get<{ status: string }>(
      'SELECT status FROM reservations WHERE id = ?',
      id,
    )?.status;
  }

  function countRows(table: 'reservations' | 'payments'): number {
    return (
      database.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
        ?.count ?? 0
    );
  }
});

async function sendDuplicateIdempotencyHeaders(
  app: INestApplication<App>,
  body: { startsAt: string; quantity: number },
): Promise<DuplicateHeaderResponse> {
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('The e2e HTTP server does not expose a TCP address.');
  }

  const bodyText = JSON.stringify(body);
  const token = getAuthTestContext().viewerAccessToken;

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: address.port });
    let responseText = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(
        [
          'POST /reservations HTTP/1.1',
          `Host: 127.0.0.1:${address.port}`,
          'Connection: close',
          `Authorization: Bearer ${token}`,
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(bodyText)}`,
          'Idempotency-Key: duplicate-first',
          'Idempotency-Key: duplicate-second',
          '',
          bodyText,
          '',
        ].join('\r\n'),
      );
    });
    socket.on('data', (chunk: string) => {
      responseText += chunk;
    });
    socket.on('end', () => {
      const separator = responseText.indexOf('\r\n\r\n');
      const headers = responseText.slice(0, separator);
      const bodyResponse = responseText.slice(separator + 4).trim();
      const statusText = /^HTTP\/1\.\d (\d{3})/m.exec(headers)?.[1];
      if (separator < 0 || statusText === undefined) {
        reject(new Error('The HTTP response could not be parsed.'));
        return;
      }

      try {
        resolve({
          status: Number(statusText),
          body: JSON.parse(bodyResponse) as unknown,
        });
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', reject);
  });
}
