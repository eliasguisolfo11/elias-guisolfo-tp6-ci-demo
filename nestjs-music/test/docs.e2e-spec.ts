import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { setupSwagger } from '../src/common/swagger/setup-swagger.js';
import { getAuthTestContext } from './helpers/auth-test-context.js';

const expectedOperations = [
  {
    path: '/artists',
    method: 'get',
    tag: 'Artists',
    summary: 'Listar artistas',
    description: 'Obtiene una página de artistas ordenada por identificador.',
    responses: {
      '200': 'Página de artistas.',
      '400': 'Los parámetros de paginación no son válidos.',
    },
    requiresBearer: true,
  },
  {
    path: '/artists',
    method: 'post',
    tag: 'Artists',
    summary: 'Crear artista',
    description: 'Crea un artista en el catálogo.',
    responses: {
      '201': 'Artista creado.',
      '400': 'Los datos del artista no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '409': 'Una restricción de integridad impide crear el artista.',
    },
    requiresBearer: true,
  },
  {
    path: '/artists/{id}',
    method: 'get',
    tag: 'Artists',
    summary: 'Obtener artista',
    description: 'Obtiene un artista por su identificador.',
    responses: {
      '200': 'Artista encontrado.',
      '400': 'El identificador no es válido.',
      '404': 'No se encontró el artista solicitado.',
    },
    requiresBearer: true,
  },
  {
    path: '/artists/{id}',
    method: 'patch',
    tag: 'Artists',
    summary: 'Actualizar artista',
    description: 'Actualiza parcialmente un artista existente.',
    responses: {
      '200': 'Artista actualizado.',
      '400': 'Los datos del artista no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró el artista solicitado.',
      '409': 'Una restricción de integridad impide actualizar el artista.',
    },
    requiresBearer: true,
  },
  {
    path: '/artists/{id}',
    method: 'delete',
    tag: 'Artists',
    summary: 'Eliminar artista',
    description: 'Elimina un artista que no tenga álbumes asociados.',
    responses: {
      '204': 'Artista eliminado sin contenido.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró el artista solicitado.',
      '409': 'El artista tiene álbumes asociados.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums',
    method: 'get',
    tag: 'Albums',
    summary: 'Listar álbumes',
    description: 'Obtiene una página de álbumes ordenada por identificador.',
    responses: {
      '200': 'Página de álbumes con su artista asociado.',
      '400': 'Los parámetros de paginación no son válidos.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums/search',
    method: 'get',
    tag: 'Albums',
    summary: 'Buscar álbumes',
    description:
      'Busca álbumes mediante filtros de título y artista y devuelve resultados paginados.',
    responses: {
      '200': 'Página de resultados de álbumes.',
      '400': 'Los parámetros de búsqueda no son válidos.',
      '401': 'Se requieren credenciales válidas.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums',
    method: 'post',
    tag: 'Albums',
    summary: 'Crear álbum',
    description: 'Crea un álbum asociado a un artista existente.',
    responses: {
      '201': 'Álbum creado.',
      '400': 'Los datos del álbum o su artista no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '409': 'Una restricción de integridad impide crear el álbum.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums/{id}',
    method: 'get',
    tag: 'Albums',
    summary: 'Obtener álbum',
    description: 'Obtiene un álbum y su artista por identificador.',
    responses: {
      '200': 'Álbum encontrado con su artista asociado.',
      '400': 'El identificador no es válido.',
      '404': 'No se encontró el álbum solicitado.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums/{id}',
    method: 'patch',
    tag: 'Albums',
    summary: 'Actualizar álbum',
    description: 'Actualiza parcialmente un álbum existente.',
    responses: {
      '200': 'Álbum actualizado.',
      '400':
        'Una referencia inexistente responde 400 cuando el álbum existe; los demás datos inválidos también responden 400.',
      '401': 'Se requieren credenciales válidas.',
      '404':
        'Si el álbum no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
      '409': 'Una restricción de integridad impide actualizar el álbum.',
    },
    requiresBearer: true,
  },
  {
    path: '/albums/{id}',
    method: 'delete',
    tag: 'Albums',
    summary: 'Eliminar álbum',
    description: 'Elimina un álbum que no tenga pistas asociadas.',
    responses: {
      '204': 'Álbum eliminado sin contenido.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró el álbum solicitado.',
      '409': 'El álbum tiene pistas asociadas.',
    },
    requiresBearer: true,
  },
  {
    path: '/genres',
    method: 'get',
    tag: 'Genres',
    summary: 'Listar géneros',
    description: 'Obtiene una página de géneros ordenada por identificador.',
    responses: {
      '200': 'Página de géneros.',
      '400': 'Los parámetros de paginación no son válidos.',
    },
    requiresBearer: true,
  },
  {
    path: '/genres',
    method: 'post',
    tag: 'Genres',
    summary: 'Crear género',
    description: 'Crea un género en el catálogo.',
    responses: {
      '201': 'Género creado.',
      '400': 'Los datos del género no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '409': 'Una restricción de integridad impide crear el género.',
    },
    requiresBearer: true,
  },
  {
    path: '/genres/{id}',
    method: 'get',
    tag: 'Genres',
    summary: 'Obtener género',
    description: 'Obtiene un género por su identificador.',
    responses: {
      '200': 'Género encontrado.',
      '400': 'El identificador no es válido.',
      '404': 'No se encontró el género solicitado.',
    },
    requiresBearer: true,
  },
  {
    path: '/genres/{id}',
    method: 'patch',
    tag: 'Genres',
    summary: 'Actualizar género',
    description: 'Actualiza parcialmente un género existente.',
    responses: {
      '200': 'Género actualizado.',
      '400': 'Los datos del género no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró el género solicitado.',
      '409': 'Una restricción de integridad impide actualizar el género.',
    },
    requiresBearer: true,
  },
  {
    path: '/genres/{id}',
    method: 'delete',
    tag: 'Genres',
    summary: 'Eliminar género',
    description: 'Elimina un género que no tenga pistas asociadas.',
    responses: {
      '204': 'Género eliminado sin contenido.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró el género solicitado.',
      '409': 'El género tiene pistas asociadas.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks',
    method: 'get',
    tag: 'Tracks',
    summary: 'Listar pistas',
    description: 'Obtiene una página de pistas ordenada por identificador.',
    responses: {
      '200': 'Página de pistas con sus relaciones.',
      '400': 'Los parámetros de paginación no son válidos.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks/search',
    method: 'get',
    tag: 'Tracks',
    summary: 'Buscar pistas',
    description:
      'Busca pistas mediante filtros combinables y devuelve resultados paginados.',
    responses: {
      '200': 'Página de resultados de pistas.',
      '400': 'Los parámetros de búsqueda no son válidos.',
      '401': 'Se requieren credenciales válidas.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks',
    method: 'post',
    tag: 'Tracks',
    summary: 'Crear pista',
    description: 'Crea una pista con sus relaciones del catálogo.',
    responses: {
      '201': 'Pista creada.',
      '400': 'Los datos de la pista o sus referencias no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '409': 'Una restricción de integridad impide crear la pista.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks/{id}',
    method: 'get',
    tag: 'Tracks',
    summary: 'Obtener pista',
    description: 'Obtiene una pista y sus relaciones por identificador.',
    responses: {
      '200': 'Pista encontrada con sus relaciones.',
      '400': 'El identificador no es válido.',
      '404': 'No se encontró la pista solicitada.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks/{id}',
    method: 'patch',
    tag: 'Tracks',
    summary: 'Actualizar pista',
    description: 'Actualiza parcialmente una pista existente.',
    responses: {
      '200': 'Pista actualizada.',
      '400':
        'Una referencia inexistente responde 400 cuando la pista existe; los demás datos inválidos también responden 400.',
      '401': 'Se requieren credenciales válidas.',
      '404':
        'Si la pista no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
      '409': 'Una restricción de integridad impide actualizar la pista.',
    },
    requiresBearer: true,
  },
  {
    path: '/tracks/{id}',
    method: 'delete',
    tag: 'Tracks',
    summary: 'Eliminar pista',
    description: 'Elimina una pista que no tenga facturas ni listas asociadas.',
    responses: {
      '204': 'Pista eliminada sin contenido.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '404': 'No se encontró la pista solicitada.',
      '409': 'La pista tiene facturas o listas asociadas.',
    },
    requiresBearer: true,
  },
  {
    path: '/reservations/slots',
    method: 'get',
    tag: 'Reservas',
    summary: 'Consultar turnos y cupo disponible.',
    description:
      'Disponible para los roles viewer y admin. El offset de startsAt se conserva y remainingCapacity se calcula desde el cupo fijo y las reservas PAGADA o COMPLETADA. Los turnos vencidos siguen visibles para consulta histórica.',
    responses: {
      '200':
        'Turnos configurados con fecha y hora con offset, capacidad fija y cupo disponible.',
      '401': 'Se requieren credenciales válidas.',
      '403': 'El usuario no tiene permisos para esta operación.',
    },
    requiresBearer: true,
  },
  {
    path: '/reservations',
    method: 'post',
    tag: 'Reservas',
    summary: 'Crear una reserva y confirmar su pago simulado.',
    description:
      'Disponible solo para el rol viewer. Requiere un Idempotency-Key no vacío enviado una sola vez; un replay idéntico devuelve la representación original con HTTP 201 y un contenido distinto responde HTTP 409. startsAt debe incluir offset explícito y quantity debe ser entero positivo. La reserva inicia como PENDIENTE solo dentro de la operación atómica; el pago simulado confirmado deja el estado público en PAGADA.',
    responses: {
      '201': 'Reserva pagada con el resultado del pago simulado.',
      '400':
        'La solicitud, el encabezado Idempotency-Key, la cantidad o el offset no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '403': 'El usuario no tiene permisos para esta operación.',
      '404': 'No existe un turno para esa fecha y hora.',
      '409':
        'La clave de idempotencia entra en conflicto o no hay cupo suficiente.',
      '502':
        'El pago simulado no pudo confirmarse; la reserva y el pago se revirtieron.',
    },
    requiresBearer: true,
  },
  {
    path: '/reservations/{id}',
    method: 'get',
    tag: 'Reservas',
    summary: 'Consultar una reserva propia o administrar cualquiera.',
    description:
      'Disponible para viewer sobre sus propias reservas y para admin sobre cualquier reserva. La respuesta solo expone los campos públicos de la reserva y del pago simulado.',
    responses: {
      '200': 'Reserva y pago asociados en su forma pública.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '403': 'El usuario no tiene permisos para esta operación.',
      '404': 'No existe una reserva visible para este usuario.',
    },
    requiresBearer: true,
  },
  {
    path: '/reservations/{id}/cancel',
    method: 'post',
    tag: 'Reservas',
    summary: 'Cancelar una reserva pagada de forma idempotente.',
    description:
      'Disponible para viewer sobre sus propias reservas y para admin sobre cualquier reserva pagada. PAGADA pasa a CANCELADA; repetir la cancelación devuelve la misma representación y no libera cupo otra vez.',
    responses: {
      '200':
        'Reserva cancelada o ya cancelada, sin liberar cupo más de una vez.',
      '400': 'El identificador no es válido.',
      '401': 'Se requieren credenciales válidas.',
      '403': 'El usuario no tiene permisos para esta operación.',
      '404': 'No existe una reserva visible para este usuario.',
      '409': 'Solo puede cancelarse una reserva PAGADA o CANCELADA.',
    },
    requiresBearer: true,
  },
  {
    path: '/reservations/{id}/transitions',
    method: 'post',
    tag: 'Reservas',
    summary: 'Solicitar una transición de estado permitida.',
    description:
      'Disponible para viewer propietario y admin sobre cualquier reserva al cancelar; solo admin puede completar desde el instante programado inclusive. Solo se permiten PAGADA → CANCELADA y PAGADA → COMPLETADA; PAGADA → PENDIENTE responde HTTP 409. No existen rutas PUT ni PATCH genéricas para modificar reservas.',
    responses: {
      '200': 'Transición aplicada; respuesta con la reserva y el pago.',
      '400': 'El identificador o el estado de destino no son válidos.',
      '401': 'Se requieren credenciales válidas.',
      '403': 'El usuario no tiene permisos para esta operación.',
      '404': 'No existe una reserva visible para este usuario.',
      '409':
        'El estado de origen, destino o instante programado impide la transición.',
    },
    requiresBearer: true,
  },
] as const;

const reservationSuccessStatuses: Record<string, string> = {
  'GET /reservations/slots': '200',
  'POST /reservations': '201',
  'GET /reservations/{id}': '200',
  'POST /reservations/{id}/cancel': '200',
  'POST /reservations/{id}/transitions': '200',
};

const reservationSuccessSchemas: Record<string, string> = {
  'GET /reservations/slots':
    '#/components/schemas/SlotAvailabilityResponseDto',
  'POST /reservations': '#/components/schemas/ReservationResponseDto',
  'GET /reservations/{id}': '#/components/schemas/ReservationResponseDto',
  'POST /reservations/{id}/cancel':
    '#/components/schemas/ReservationResponseDto',
  'POST /reservations/{id}/transitions':
    '#/components/schemas/ReservationResponseDto',
};

const resourceSchemas = [
  {
    path: '/artists',
    itemPath: '/artists/{id}',
    entity: 'Artist',
    createDto: 'CreateArtistDto',
    updateDto: 'UpdateArtistDto',
  },
  {
    path: '/albums',
    itemPath: '/albums/{id}',
    entity: 'Album',
    createDto: 'CreateAlbumDto',
    updateDto: 'UpdateAlbumDto',
  },
  {
    path: '/genres',
    itemPath: '/genres/{id}',
    entity: 'Genre',
    createDto: 'CreateGenreDto',
    updateDto: 'UpdateGenreDto',
  },
  {
    path: '/tracks',
    itemPath: '/tracks/{id}',
    entity: 'Track',
    createDto: 'CreateTrackDto',
    updateDto: 'UpdateTrackDto',
  },
] as const;

function propertyNames(
  schema: { properties?: Record<string, unknown> } | undefined,
): string[] {
  expect(schema).toBeDefined();
  return Object.keys(schema?.properties ?? {}).sort();
}

describe('API documentation (e2e)', () => {
  let app: INestApplication<App>;

  const openApiRequest = () =>
    request(app.getHttpServer())
      .get('/openapi.json')
      .set('Authorization', `Bearer ${getAuthTestContext().accessToken}`);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza la interfaz, sus recursos y el documento sin token o con token inválido', async () => {
    for (const path of ['/docs', '/docs/swagger-ui-init.js', '/openapi.json']) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    }
  });

  it('rechaza cuentas deshabilitadas y habilita la UI, sus recursos y el documento con cuenta válida', async () => {
    const disabledToken = getAuthTestContext().createDisabledUserToken();
    await request(app.getHttpServer())
      .get('/docs')
      .set('Authorization', `Bearer ${disabledToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/docs')
      .set('Authorization', `Bearer ${getAuthTestContext().accessToken}`)
      .expect(200)
      .expect('Content-Type', /text\/html/);

    await request(app.getHttpServer())
      .get('/docs/swagger-ui-init.js')
      .set('Authorization', `Bearer ${getAuthTestContext().accessToken}`)
      .expect(200)
      .expect('Content-Type', /javascript/);
  });

  it('publica el documento OpenAPI en /openapi.json', async () => {
    const response = await openApiRequest()
      .expect(200)
      .expect('Content-Type', /application\/json/);
    const openApiText = response.text;

    expect(response.body.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(openApiText).not.toContain('JWT_SECRET');
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      expect(openApiText).not.toContain(jwtSecret);
    }
  });

  it('documenta la precedencia de referencia y destino en PATCH de álbumes y pistas', async () => {
    const { body: document } = await openApiRequest().expect(200);

    expect(
      document.paths['/albums/{id}'].patch.responses['400'].description,
    ).toBe(
      'Una referencia inexistente responde 400 cuando el álbum existe; los demás datos inválidos también responden 400.',
    );
    expect(
      document.paths['/albums/{id}'].patch.responses['404'].description,
    ).toBe(
      'Si el álbum no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
    );
    expect(
      document.paths['/tracks/{id}'].patch.responses['400'].description,
    ).toBe(
      'Una referencia inexistente responde 400 cuando la pista existe; los demás datos inválidos también responden 400.',
    );
    expect(
      document.paths['/tracks/{id}'].patch.responses['404'].description,
    ).toBe(
      'Si la pista no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
    );
  });

  it('documenta las 27 operaciones y sus respuestas reales en español', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const routePaths = Object.keys(document.paths).filter((path) =>
      /^\/(artists|albums|genres|tracks|reservations)(\/|$)/.test(path),
    );
    const entityByPath: Record<string, string> = {
      '/artists': 'Artist',
      '/artists/{id}': 'Artist',
      '/albums': 'Album',
      '/albums/{id}': 'Album',
      '/genres': 'Genre',
      '/genres/{id}': 'Genre',
      '/tracks': 'Track',
      '/tracks/{id}': 'Track',
    };
    const documentedOperationCount = routePaths.reduce(
      (count, path) =>
        count +
        ['get', 'post', 'patch', 'delete'].filter(
          (method) => document.paths[path][method] !== undefined,
        ).length,
      0,
    );

    expect(documentedOperationCount).toBe(27);

    for (const expected of expectedOperations) {
      const operation = document.paths[expected.path]?.[expected.method];
      expect(operation).toBeDefined();
      if (!operation) {
        continue;
      }

      expect(operation.tags).toEqual([expected.tag]);
      expect(operation.summary).toBe(expected.summary);
      expect(operation.description).toBe(expected.description);
      const expectedResponses = {
        ...expected.responses,
        '401': 'Se requieren credenciales válidas.',
        ...(expected.method === 'get'
          ? {}
          : { '403': 'El usuario no tiene permisos para esta operación.' }),
      };
      expect(Object.keys(operation.responses).sort()).toEqual(
        Object.keys(expectedResponses).sort(),
      );
      for (const [status, description] of Object.entries(expectedResponses)) {
        expect(operation.responses[status].description).toBe(description);
      }

      if (expected.method !== 'delete') {
        const operationKey = `${expected.method.toUpperCase()} ${expected.path}`;
        const successStatus =
          reservationSuccessStatuses[operationKey] ??
          (expected.method === 'post' ? '201' : '200');
        const successSchema =
          operation.responses[successStatus].content['application/json'].schema;
        const reservationSchema = reservationSuccessSchemas[operationKey];
        const entityReference = `#/components/schemas/${entityByPath[expected.path]}`;

        if (reservationSchema !== undefined) {
          if (expected.path === '/reservations/slots') {
            expect(successSchema).toMatchObject({
              type: 'array',
              items: { $ref: reservationSchema },
            });
          } else {
            expect(successSchema).toMatchObject({ $ref: reservationSchema });
          }
        } else if (expected.path === '/tracks/search') {
          expect(successSchema).toMatchObject({
            $ref: '#/components/schemas/TrackSearchPageDto',
          });
        } else if (expected.path === '/albums/search') {
          expect(successSchema).toMatchObject({
            $ref: '#/components/schemas/AlbumSearchPageDto',
          });
        } else if (expected.method === 'get' && !expected.path.endsWith('{id}')) {
          expect(successSchema).toMatchObject({
            type: 'array',
            items: { $ref: entityReference },
          });
        } else {
          expect(successSchema).toMatchObject({ $ref: entityReference });
        }
      }

      if (expected.requiresBearer) {
        expect(operation.security).toEqual([{ bearer: [] }]);
      } else {
        expect(operation.security ?? []).toEqual([]);
      }
    }
  });

  it('publica las cinco rutas de reservas con métodos y acciones explícitas', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const reservationPaths = Object.keys(document.paths)
      .filter((path) => path.startsWith('/reservations'))
      .sort();

    expect(reservationPaths).toEqual([
      '/reservations',
      '/reservations/slots',
      '/reservations/{id}',
      '/reservations/{id}/cancel',
      '/reservations/{id}/transitions',
    ]);
    expect(document.paths['/reservations/{id}'].put).toBeUndefined();
    expect(document.paths['/reservations/{id}'].patch).toBeUndefined();

    const methodsByPath: Record<string, string[]> = {
      '/reservations': ['post'],
      '/reservations/slots': ['get'],
      '/reservations/{id}': ['get'],
      '/reservations/{id}/cancel': ['post'],
      '/reservations/{id}/transitions': ['post'],
    };

    for (const [path, expectedMethods] of Object.entries(methodsByPath)) {
      const methods = Object.keys(document.paths[path])
        .filter((method) =>
          ['get', 'post', 'put', 'patch', 'delete'].includes(method),
        )
        .sort();
      expect(methods).toEqual(expectedMethods);
    }
  });

  it('documenta DTOs, respuestas públicas, idempotencia y cupo restante', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const schemas = document.components.schemas;
    const createOperation = document.paths['/reservations'].post;
    const createHeader = createOperation.parameters.find(
      (parameter: { name: string; in: string }) =>
        parameter.name === 'Idempotency-Key' && parameter.in === 'header',
    );

    expect(createHeader).toMatchObject({ required: true, schema: { type: 'string' } });
    expect(createHeader.description).toContain('no vacía');
    expect(createHeader.description).toContain('una sola vez');
    expect(createOperation.requestBody.required).toBe(true);
    expect(
      createOperation.requestBody.content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/CreateReservationDto' });
    expect(propertyNames(schemas.CreateReservationDto)).toEqual([
      'quantity',
      'startsAt',
    ]);
    expect(schemas.CreateReservationDto.required.sort()).toEqual([
      'quantity',
      'startsAt',
    ]);
    expect(schemas.CreateReservationDto.properties.startsAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(
      schemas.CreateReservationDto.properties.startsAt.description,
    ).toContain('offset explícito');
    expect(schemas.CreateReservationDto.properties.quantity).toMatchObject({
      type: 'integer',
      minimum: 1,
    });

    const transitionOperation =
      document.paths['/reservations/{id}/transitions'].post;
    expect(
      transitionOperation.requestBody.content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ReservationTransitionDto' });
    expect(schemas.ReservationTransitionDto.properties.status.enum).toEqual([
      'PENDIENTE',
      'PAGADA',
      'CANCELADA',
      'COMPLETADA',
    ]);

    expect(propertyNames(schemas.SlotAvailabilityResponseDto)).toEqual([
      'capacity',
      'remainingCapacity',
      'startsAt',
    ]);
    expect(schemas.SlotAvailabilityResponseDto.properties.startsAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(
      schemas.SlotAvailabilityResponseDto.properties.startsAt.description,
    ).toContain('offset original');
    expect(
      schemas.SlotAvailabilityResponseDto.properties.remainingCapacity,
    ).toMatchObject({ type: 'integer' });
    expect(
      schemas.SlotAvailabilityResponseDto.properties.remainingCapacity.description,
    ).toContain('calculados');

    expect(propertyNames(schemas.ReservationResponseDto)).toEqual([
      'id',
      'payment',
      'quantity',
      'startsAt',
      'status',
    ]);
    expect(schemas.ReservationResponseDto.properties.status.enum).toEqual([
      'PAGADA',
      'CANCELADA',
      'COMPLETADA',
    ]);
    expect(schemas.ReservationResponseDto.properties.startsAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(
      schemas.ReservationResponseDto.properties.startsAt.description,
    ).toContain('offset configurado');
    expect(
      JSON.stringify(schemas.ReservationResponseDto.properties.payment),
    ).toContain('#/components/schemas/ReservationPaymentResponseDto');
    expect(propertyNames(schemas.ReservationPaymentResponseDto)).toEqual([
      'createdAt',
      'result',
    ]);
    expect(schemas.ReservationPaymentResponseDto.properties.result.enum).toEqual([
      'EXITOSO',
    ]);
    expect(
      schemas.ReservationPaymentResponseDto.properties.createdAt,
    ).toMatchObject({
      type: 'string',
      format: 'date-time',
    });

    expect(
      createOperation.responses['409'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ReservationConflictResponseDto' });
    const conflictSchema = schemas.ReservationConflictResponseDto;
    const conflictCapacityProperty =
      conflictSchema.properties?.remainingCapacity ??
      conflictSchema.allOf?.find(
        (schema: { properties?: Record<string, unknown> }) =>
          schema.properties?.remainingCapacity !== undefined,
      )?.properties?.remainingCapacity;
    expect(conflictCapacityProperty).toMatchObject({ type: 'integer' });
    expect(
      createOperation.responses['502'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ApiErrorResponse' });
    expect(
      document.paths['/reservations/{id}/transitions'].post.description,
    ).toContain('PAGADA → COMPLETADA');
    expect(
      document.paths['/reservations/{id}/transitions'].post.description,
    ).toContain('PAGADA → PENDIENTE responde HTTP 409');
    expect(
      document.paths['/reservations/{id}/cancel'].post.description,
    ).toContain('PAGADA pasa a CANCELADA');

    const openApiText = JSON.stringify(document);
    for (const internalField of [
      'userId',
      'slotId',
      'idempotencyKey',
      'requestPayload',
      'JWT_SECRET',
    ]) {
      expect(openApiText).not.toContain(internalField);
    }
  });

  it('documenta parámetros, whitelist, defaults, páginas y errores de las búsquedas', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const minPriceDescription =
      'Precio mínimo inclusivo. Si se envían ambos límites, minPrice y maxPrice se comparan entre sí como decimales originales antes de convertir; si minPrice supera maxPrice, responde HTTP 400. El filtro usa el Number finito de JavaScript y redondeo IEEE-754 en SQLite REAL; 0.99000000000000001 se filtra como 0.99. Si convierte a infinito, responde HTTP 400. No hay máximo decimal de aplicación.';
    const maxPriceDescription =
      'Precio máximo inclusivo. Si se envían ambos límites, minPrice y maxPrice se comparan entre sí como decimales originales antes de convertir; si minPrice supera maxPrice, responde HTTP 400. El filtro usa el Number finito de JavaScript y redondeo IEEE-754 en SQLite REAL; 0.99000000000000001 se filtra como 0.99. Si convierte a infinito, responde HTTP 400. No hay máximo decimal de aplicación.';
    const expectedSearches = [
      {
        path: '/tracks/search',
        pageSchema: 'TrackSearchPageDto',
        itemSchema: 'Track',
        parameters: [
          {
            name: 'skip',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
              default: 0,
            },
          },
          {
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          },
          {
            name: 'sort',
            schema: {
              type: 'string',
              enum: ['Name', 'UnitPrice', 'Milliseconds'],
              default: 'Name',
            },
          },
          {
            name: 'order',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          },
          { name: 'text', schema: { type: 'string' } },
          { name: 'genre', schema: { type: 'string' } },
          { name: 'artist', schema: { type: 'string' } },
          {
            name: 'minPrice',
            description: minPriceDescription,
            schema: { type: 'number', minimum: 0 },
          },
          {
            name: 'maxPrice',
            description: maxPriceDescription,
            schema: { type: 'number', minimum: 0 },
          },
          {
            name: 'minDuration',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
          {
            name: 'maxDuration',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
        ],
      },
      {
        path: '/albums/search',
        pageSchema: 'AlbumSearchPageDto',
        itemSchema: 'Album',
        parameters: [
          {
            name: 'skip',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
              default: 0,
            },
          },
          {
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          },
          {
            name: 'sort',
            schema: {
              type: 'string',
              enum: ['Title', 'ArtistName'],
              default: 'Title',
            },
          },
          {
            name: 'order',
            schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          },
          { name: 'text', schema: { type: 'string' } },
          { name: 'artist', schema: { type: 'string' } },
        ],
      },
    ] as const;

    for (const expected of expectedSearches) {
      const operation = document.paths[expected.path]?.get;
      expect(operation).toBeDefined();
      if (!operation) {
        continue;
      }

      expect(operation.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(operation.responses).sort()).toEqual([
        '200',
        '400',
        '401',
      ]);
      expect(operation.responses['400']).toMatchObject({
        description: 'Los parámetros de búsqueda no son válidos.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorResponse' },
          },
        },
      });
      expect(operation.responses['401']).toMatchObject({
        description: 'Se requieren credenciales válidas.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorResponse' },
          },
        },
      });

      const parameters = operation.parameters ?? [];
      expect(parameters.map((parameter: { name: string }) => parameter.name).sort()).toEqual(
        expected.parameters.map((parameter) => parameter.name).sort(),
      );
      const parametersByName = new Map(
        parameters.map((parameter: { name: string }) => [parameter.name, parameter]),
      );
      for (const parameter of expected.parameters) {
        const documentedParameter = parametersByName.get(parameter.name);
        expect(documentedParameter).toMatchObject({
          in: 'query',
          required: false,
          schema: parameter.schema,
        });
        if ('description' in parameter) {
          expect(documentedParameter.description).toBe(parameter.description);
          expect(documentedParameter.schema.maximum).toBeUndefined();
        }
      }

      const page = document.components.schemas[expected.pageSchema];
      expect(propertyNames(page)).toEqual([
        'hasMore',
        'items',
        'limit',
        'skip',
        'total',
      ]);
      expect(page.required.sort()).toEqual([
        'hasMore',
        'items',
        'limit',
        'skip',
        'total',
      ]);
      expect(page.properties.items).toMatchObject({
        type: 'array',
        items: { $ref: `#/components/schemas/${expected.itemSchema}` },
      });
      expect(page.properties.total).toMatchObject({ type: 'integer', minimum: 0 });
      expect(page.properties.skip).toMatchObject({ type: 'integer', minimum: 0 });
      expect(page.properties.limit).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 100,
      });
      expect(page.properties.hasMore).toMatchObject({ type: 'boolean' });
    }
  });

  it('documenta seguridad para todas las rutas salvo login y los errores de autenticación y rol', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const loginOperation = document.paths['/auth/login']?.post;
    const registerOperation = document.paths['/auth/register']?.post;

    expect(loginOperation?.security ?? []).toEqual([]);
    expect(registerOperation?.security).toEqual([{ bearer: [] }]);
    expect(registerOperation?.responses['401']).toMatchObject({
      description: 'Se requieren credenciales válidas.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorResponse' },
        },
      },
    });
    expect(registerOperation?.responses['403']).toMatchObject({
      description: 'El usuario no tiene permisos para esta operación.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorResponse' },
        },
      },
    });
  });

  it('documenta las relaciones anidadas de Album y Track', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const schemas = document.components.schemas;

    expect(propertyNames(schemas.Artist)).toEqual(['ArtistId', 'Name']);
    expect(propertyNames(schemas.Album)).toEqual([
      'AlbumId',
      'Artist',
      'ArtistId',
      'Title',
    ]);
    expect(propertyNames(schemas.Genre)).toEqual(['GenreId', 'Name']);
    expect(propertyNames(schemas.Track)).toEqual([
      'Album',
      'AlbumId',
      'Bytes',
      'Composer',
      'Genre',
      'GenreId',
      'MediaType',
      'MediaTypeId',
      'Milliseconds',
      'Name',
      'TrackId',
      'UnitPrice',
    ]);
    expect(schemas.Album.properties.Artist.allOf).toEqual([
      { $ref: '#/components/schemas/Artist' },
    ]);
    expect(schemas.Artist.properties).toMatchObject({
      ArtistId: { type: 'integer' },
      Name: { type: 'string' },
    });

    expect(JSON.stringify(schemas.Track.properties.Album)).toContain(
      '#/components/schemas/TrackAlbum',
    );
    expect(JSON.stringify(schemas.Track.properties.Genre)).toContain(
      '#/components/schemas/TrackGenre',
    );
    expect(JSON.stringify(schemas.Track.properties.MediaType)).toContain(
      '#/components/schemas/TrackMediaType',
    );
    expect(schemas.TrackAlbum.properties).toMatchObject({
      AlbumId: { type: 'integer' },
      Title: { type: 'string' },
    });
    expect(schemas.TrackGenre.properties).toMatchObject({
      GenreId: { type: 'integer' },
      Name: { type: 'string', nullable: true },
    });
    expect(schemas.TrackMediaType.properties).toMatchObject({
      MediaTypeId: { type: 'integer' },
      Name: { type: 'string' },
    });
  });

  it('documenta los campos enteros de las respuestas con tipo integer', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const schemas = document.components.schemas;
    const integerPropertiesBySchema: Record<string, string[]> = {
      Artist: ['ArtistId'],
      Album: ['AlbumId', 'ArtistId'],
      Genre: ['GenreId'],
      Track: [
        'TrackId',
        'AlbumId',
        'GenreId',
        'MediaTypeId',
        'Milliseconds',
        'Bytes',
      ],
      TrackAlbum: ['AlbumId'],
      TrackGenre: ['GenreId'],
      TrackMediaType: ['MediaTypeId'],
    };

    for (const [schemaName, propertyNames] of Object.entries(
      integerPropertiesBySchema,
    )) {
      for (const propertyName of propertyNames) {
        expect(schemas[schemaName].properties[propertyName].type).toBe(
          'integer',
        );
      }
    }

    expect(schemas.Track.properties.UnitPrice.type).toBe('number');
  });

  it('documenta null y required en las respuestas con relaciones opcionales', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const schemas = document.components.schemas;
    const nullableProperties = [
      { schema: 'Genre', property: 'Name' },
      { schema: 'Track', property: 'AlbumId' },
      { schema: 'Track', property: 'GenreId' },
      { schema: 'Track', property: 'Bytes' },
      { schema: 'Track', property: 'Composer' },
      { schema: 'Track', property: 'Album' },
      { schema: 'Track', property: 'Genre' },
    ] as const;

    for (const { schema: schemaName, property } of nullableProperties) {
      expect(schemas[schemaName].properties[property].nullable).toBe(true);
      expect(schemas[schemaName].required).toContain(property);
    }

    expect(schemas.Track.properties.Album).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/TrackAlbum' }],
      nullable: true,
    });
    expect(schemas.Track.properties.Genre).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/TrackGenre' }],
      nullable: true,
    });

    const nonNullableProperties = [
      { schema: 'Genre', property: 'GenreId' },
      { schema: 'Track', property: 'TrackId' },
      { schema: 'Track', property: 'Name' },
      { schema: 'Track', property: 'MediaTypeId' },
      { schema: 'Track', property: 'MediaType' },
      { schema: 'Track', property: 'Milliseconds' },
      { schema: 'Track', property: 'UnitPrice' },
    ] as const;

    for (const { schema: schemaName, property } of nonNullableProperties) {
      expect(
        schemas[schemaName].properties[property].nullable ?? false,
      ).toBe(false);
      expect(schemas[schemaName].required).toContain(property);
    }

    expect(schemas.Track.properties.UnitPrice.type).toBe('number');
  });

  it('documenta el schema JSON común de todas las respuestas de error', async () => {
    const { body: document } = await openApiRequest().expect(200);

    for (const expected of expectedOperations) {
      const operation = document.paths[expected.path][expected.method];
      for (const status of Object.keys(operation.responses).filter((value) =>
        ['400', '401', '403', '404', '409'].includes(value),
      )) {
        const schema =
          operation.responses[status]?.content?.['application/json']?.schema;
        if (expected.path === '/reservations' && status === '409') {
          expect(schema).toEqual({
            $ref: '#/components/schemas/ReservationConflictResponseDto',
          });
        } else {
          expect(schema).toEqual({ $ref: '#/components/schemas/ApiErrorResponse' });
        }
      }
    }
  });

  it('documenta los parámetros de ruta y paginación', async () => {
    const { body: document } = await openApiRequest().expect(200);

    for (const resource of resourceSchemas) {
      const listParameters = document.paths[resource.path].get.parameters;
      expect(listParameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'skip',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 },
          }),
          expect.objectContaining({
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 100 },
          }),
        ]),
      );
    }
  });

  it('documenta el parámetro id de las operaciones por recurso', async () => {
    const { body: document } = await openApiRequest().expect(200);

    for (const resource of resourceSchemas) {
      const itemOperations = document.paths[resource.itemPath];
      for (const method of ['get', 'patch', 'delete']) {
        expect(itemOperations[method].parameters).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 0 },
            }),
          ]),
        );
      }
    }
  });

  it('documenta los DTOs reales de alta y actualización', async () => {
    const { body: document } = await openApiRequest().expect(200);

    for (const resource of resourceSchemas) {
      const createRequestBody = document.paths[resource.path].post.requestBody;
      expect(createRequestBody.required).toBe(true);
      expect(createRequestBody.content['application/json'].schema).toEqual({
        $ref: `#/components/schemas/${resource.createDto}`,
      });

      const updateRequestBody =
        document.paths[resource.itemPath].patch.requestBody;
      expect(updateRequestBody.required).toBe(true);
      expect(updateRequestBody.content['application/json'].schema).toEqual({
        $ref: `#/components/schemas/${resource.updateDto}`,
      });
    }

    const schemas = document.components.schemas;
    expect(propertyNames(schemas.CreateArtistDto)).toEqual(['Name']);
    expect(propertyNames(schemas.UpdateArtistDto)).toEqual(['Name']);
    expect(propertyNames(schemas.CreateAlbumDto)).toEqual([
      'ArtistId',
      'Title',
    ]);
    expect(propertyNames(schemas.UpdateAlbumDto)).toEqual([
      'ArtistId',
      'Title',
    ]);
    expect(propertyNames(schemas.CreateGenreDto)).toEqual(['Name']);
    expect(propertyNames(schemas.UpdateGenreDto)).toEqual(['Name']);
    expect(propertyNames(schemas.CreateTrackDto)).toEqual([
      'AlbumId',
      'Bytes',
      'Composer',
      'GenreId',
      'MediaTypeId',
      'Milliseconds',
      'Name',
      'UnitPrice',
    ]);
    expect(propertyNames(schemas.UpdateTrackDto)).toEqual([
      'AlbumId',
      'Bytes',
      'Composer',
      'GenreId',
      'MediaTypeId',
      'Milliseconds',
      'Name',
      'UnitPrice',
    ]);

    const integerProperties = [
      {
        schema: 'CreateAlbumDto',
        property: 'ArtistId',
        required: true,
        nullable: false,
      },
      {
        schema: 'UpdateAlbumDto',
        property: 'ArtistId',
        required: false,
        nullable: false,
      },
      {
        schema: 'CreateTrackDto',
        property: 'AlbumId',
        required: false,
        nullable: true,
      },
      {
        schema: 'CreateTrackDto',
        property: 'GenreId',
        required: false,
        nullable: true,
      },
      {
        schema: 'CreateTrackDto',
        property: 'MediaTypeId',
        required: true,
        nullable: false,
      },
      {
        schema: 'CreateTrackDto',
        property: 'Milliseconds',
        required: true,
        nullable: false,
      },
      {
        schema: 'CreateTrackDto',
        property: 'Bytes',
        required: false,
        nullable: true,
      },
      {
        schema: 'UpdateTrackDto',
        property: 'AlbumId',
        required: false,
        nullable: true,
      },
      {
        schema: 'UpdateTrackDto',
        property: 'GenreId',
        required: false,
        nullable: true,
      },
      {
        schema: 'UpdateTrackDto',
        property: 'MediaTypeId',
        required: false,
        nullable: false,
      },
      {
        schema: 'UpdateTrackDto',
        property: 'Milliseconds',
        required: false,
        nullable: false,
      },
      {
        schema: 'UpdateTrackDto',
        property: 'Bytes',
        required: false,
        nullable: true,
      },
    ] as const;

    for (const expected of integerProperties) {
      const schema = schemas[expected.schema];
      const property = schema.properties[expected.property];
      expect(property.type).toBe('integer');
      expect(property.nullable ?? false).toBe(expected.nullable);
      expect(
        (schema.required ?? []).includes(expected.property),
      ).toBe(expected.required);
    }

    expect(schemas.CreateTrackDto.properties.UnitPrice.type).toBe('number');
    expect(schemas.UpdateTrackDto.properties.UnitPrice.type).toBe('number');
  });

  it('documenta el cuerpo uniforme de error y sus errores de validación', async () => {
    const { body: document } = await openApiRequest().expect(200);
    const schemas = document.components.schemas;
    const errorResponse = schemas.ApiErrorResponse;

    expect(propertyNames(errorResponse)).toEqual(['code', 'errors', 'message']);
    expect(errorResponse.properties.code).toMatchObject({ type: 'integer' });
    expect(errorResponse.properties.message).toMatchObject({ type: 'string' });
    expect(errorResponse.required.sort()).toEqual(['code', 'message']);
    expect(errorResponse.properties.errors.type).toBe('array');
    expect(JSON.stringify(errorResponse.properties.errors)).toContain(
      '#/components/schemas/ApiErrorDetail',
    );
    expect(propertyNames(schemas.ApiErrorDetail)).toEqual(['field', 'message']);
    expect(schemas.ApiErrorDetail.properties).toMatchObject({
      field: { type: 'string' },
      message: { type: 'string' },
    });
  });
});
