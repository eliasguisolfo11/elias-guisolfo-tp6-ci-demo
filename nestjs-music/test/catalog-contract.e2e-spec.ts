import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { authenticatedRequest, viewerRequest } from './helpers/auth-test-context.js';
import { vi } from 'vitest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AppModule } from '../src/app.module.js';

const collectionPaths = ['/artists', '/albums', '/genres', '/tracks'] as const;

const catalogContractCases = [
  {
    path: '/artists',
    primaryKey: 'ArtistId',
    createBody: { Name: 'T2 contract Artist' },
    patchBody: { Name: 'T2 contract Artist updated' },
    invalidCreateBody: {},
    validationField: 'Name',
  },
  {
    path: '/albums',
    primaryKey: 'AlbumId',
    createBody: { Title: 'T2 contract Album', ArtistId: 1 },
    patchBody: { Title: 'T2 contract Album updated' },
    invalidCreateBody: { Title: 'T2 invalid Album', ArtistId: 999999999 },
  },
  {
    path: '/genres',
    primaryKey: 'GenreId',
    createBody: { Name: 'T2 contract Genre' },
    patchBody: { Name: 'T2 contract Genre updated' },
    invalidCreateBody: { Name: 42 },
    validationField: 'Name',
  },
  {
    path: '/tracks',
    primaryKey: 'TrackId',
    createBody: {
      Name: 'T2 contract Track',
      AlbumId: 1,
      GenreId: 1,
      MediaTypeId: 1,
      Milliseconds: 1200,
      UnitPrice: 0.99,
    },
    patchBody: { Name: 'T2 contract Track updated' },
    invalidCreateBody: {
      Name: 'T2 invalid Track',
      MediaTypeId: 999999999,
      Milliseconds: 1200,
      UnitPrice: 0.99,
    },
  },
] as const;

interface RecordValue {
  [key: string]: unknown;
}

interface AlbumResponse {
  AlbumId: number;
  Title: string;
  ArtistId: number;
  Artist: { ArtistId: number; Name: string };
}

interface ValidationResponse {
  code: number;
  message: string;
  errors: Array<{ field: string; message: string }>;
}

function collectPropertyNames(value: unknown, propertyNames: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPropertyNames(item, propertyNames);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [propertyName, nestedValue] of Object.entries(value)) {
      propertyNames.push(propertyName);
      collectPropertyNames(nestedValue, propertyNames);
    }
  }

  return propertyNames;
}

function asRecord(value: unknown): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Se esperaba un objeto relacionado en la respuesta.');
  }

  return value as RecordValue;
}

function asRecords(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) {
    throw new Error('Se esperaba una lista de recursos en la respuesta.');
  }

  return value.map(asRecord);
}

function expectErrorEnvelope(body: unknown, status: number): void {
  const error = asRecord(body);
  expect(error.code).toBe(status);
  expect(typeof error.message).toBe('string');
  expect(Object.keys(error).sort()).toEqual(['code', 'message']);
}

function expectValidationEnvelope(body: unknown, field: string): void {
  const error = asRecord(body);
  expect(error.code).toBe(400);
  expect(typeof error.message).toBe('string');
  expect(Object.keys(error).sort()).toEqual(['code', 'errors', 'message']);
  expect(error.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field, message: expect.any(String) }),
    ]),
  );
}

describe('Catalog contract (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  });

  afterAll(async () => {
    await app.close();
  });

  function database(): DatabaseService {
    return app.get(DatabaseService);
  }

  function catalogCounts(): number[] {
    return [
      database().get<{ count: number }>('SELECT COUNT(*) AS count FROM "Artist"')?.count ?? 0,
      database().get<{ count: number }>('SELECT COUNT(*) AS count FROM "Album"')?.count ?? 0,
      database().get<{ count: number }>('SELECT COUNT(*) AS count FROM "Genre"')?.count ?? 0,
      database().get<{ count: number }>('SELECT COUNT(*) AS count FROM "Track"')?.count ?? 0,
    ];
  }

  function recordId(value: unknown, primaryKey: string): number {
    const record = asRecord(value);
    const id = record[primaryKey];
    if (typeof id !== 'number') {
      throw new Error(`Se esperaba una clave primaria numérica ${primaryKey}.`);
    }

    return id;
  }

  async function resourceSnapshots(): Promise<Array<{ path: string; body: unknown }>> {
    const snapshots: Array<{ path: string; body: unknown }> = [];
    for (const path of ['/artists/1', '/albums/1', '/genres/1', '/tracks/1']) {
      const response = await authenticatedRequest(app).get(path).expect(200);
      snapshots.push({ path, body: response.body });
    }

    return snapshots;
  }

  it('devuelve la raíz exacta y separa el 404 de una ruta desconocida', async () => {
    const root = await authenticatedRequest(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', /json/);
    expect(root.body).toEqual({ message: 'API del catálogo Chinook' });

    const unknownRoute = await request(app.getHttpServer())
      .get('/catalog-contract/unknown-route')
      .expect(404)
      .expect('Content-Type', /json/);
    expectErrorEnvelope(unknownRoute.body, 404);
  });

  it.each([
    { path: '/artists', primaryKey: 'ArtistId', invalidQuery: 'skip=-1', field: 'skip' },
    { path: '/albums', primaryKey: 'AlbumId', invalidQuery: 'limit=0', field: 'limit' },
    { path: '/genres', primaryKey: 'GenreId', invalidQuery: 'skip=texto', field: 'skip' },
    { path: '/tracks', primaryKey: 'TrackId', invalidQuery: 'skip=-1', field: 'skip' },
  ])(
    'GET $path lista recursos ordenados y devuelve detalle y error con el contrato aprobado',
    async ({ path, primaryKey, invalidQuery, field }) => {
      const list = await authenticatedRequest(app)
        .get(`${path}?limit=3`)
        .expect(200)
        .expect('Content-Type', /json/);
      const records = asRecords(list.body);
      expect(records.length).toBeGreaterThan(0);
      expect(records.length).toBeLessThanOrEqual(3);
      const ids = records.map((record) => recordId(record, primaryKey));
      expect(ids).toEqual([...ids].sort((left, right) => left - right));
      const id = recordId(records[0], primaryKey);

      const detail = await authenticatedRequest(app)
        .get(`${path}/${id}`)
        .expect(200)
        .expect('Content-Type', /json/);
      expect(detail.body).toEqual(records[0]);

      const missing = await authenticatedRequest(app)
        .get(`${path}/999999999`)
        .expect(404);
      expectErrorEnvelope(missing.body, 404);

      const invalidList = await authenticatedRequest(app)
        .get(`${path}?${invalidQuery}`)
        .expect(400);
      expectValidationEnvelope(invalidList.body, field);
    },
  );

  it.each(catalogContractCases)(
    'POST $path crea el recurso y lo representa en el detalle',
    async ({ path, primaryKey, createBody }) => {
      const created = await authenticatedRequest(app)
        .post(path)
        .send(createBody)
        .expect(201)
        .expect('Content-Type', /json/);
      const id = recordId(created.body, primaryKey);

      expect(created.body).toMatchObject(createBody);
      if (path === '/albums') {
        expect(created.body).toMatchObject({
          Artist: { ArtistId: 1, Name: expect.any(String) },
        });
      }
      if (path === '/tracks') {
        expect(created.body).toMatchObject({
          Album: { AlbumId: 1, Title: expect.any(String) },
          Genre: { GenreId: 1, Name: expect.any(String) },
          MediaType: { MediaTypeId: 1, Name: expect.any(String) },
        });
      }

      const detail = await authenticatedRequest(app)
        .get(`${path}/${id}`)
        .expect(200);
      expect(detail.body).toEqual(created.body);
    },
  );

  it.each(catalogContractCases)(
    'POST $path devuelve el error de la matriz y no persiste una entrada inválida',
    async ({ path, invalidCreateBody, validationField }) => {
      const before = catalogCounts();
      const response = await authenticatedRequest(app)
        .post(path)
        .send(invalidCreateBody)
        .expect(400);

      if (validationField !== undefined) {
        expectValidationEnvelope(response.body, validationField);
      } else {
        expectErrorEnvelope(response.body, 400);
      }
      expect(catalogCounts()).toEqual(before);
    },
  );

  it('POST /genres sin Name devuelve el error de validación y no persiste', async () => {
    const beforeCount = database().get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM "Genre"',
    )?.count;
    const beforeRows = database().all<{ GenreId: number; Name: string | null }>(
      'SELECT "GenreId", "Name" FROM "Genre" ORDER BY "GenreId" ASC',
    );

    const response = await authenticatedRequest(app)
      .post('/genres')
      .send({})
      .expect(400);
    const body = response.body as ValidationResponse;

    expect(body.code).toBe(400);
    expect(Object.keys(body).sort()).toEqual(['code', 'errors', 'message']);
    expect(body.errors).toContainEqual(
      expect.objectContaining({
        field: 'Name',
        message: expect.stringMatching(/\S/),
      }),
    );
    expect(
      database().get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM "Genre"',
      )?.count,
    ).toBe(beforeCount);
    expect(
      database().all<{ GenreId: number; Name: string | null }>(
        'SELECT "GenreId", "Name" FROM "Genre" ORDER BY "GenreId" ASC',
      ),
    ).toEqual(beforeRows);
  });

  it.each(catalogContractCases)(
    'PATCH $path/:id cambia solo los campos enviados y responde 404 para un id inexistente',
    async ({ path, primaryKey, createBody, patchBody }) => {
      const created = await authenticatedRequest(app)
        .post(path)
        .send(createBody)
        .expect(201);
      const original = asRecord(created.body);
      const id = recordId(created.body, primaryKey);

      const updated = await authenticatedRequest(app)
        .patch(`${path}/${id}`)
        .send(patchBody)
        .expect(200)
        .expect('Content-Type', /json/);
      expect(updated.body).toMatchObject(patchBody);
      expect(recordId(updated.body, primaryKey)).toBe(id);
      for (const [field, value] of Object.entries(original)) {
        if (!(field in patchBody)) {
          expect(asRecord(updated.body)[field]).toEqual(value);
        }
      }
      if (path === '/albums') {
        expect(asRecord(updated.body).Artist).toEqual(original.Artist);
      }
      if (path === '/tracks') {
        expect(asRecord(updated.body).Album).toEqual(original.Album);
        expect(asRecord(updated.body).Genre).toEqual(original.Genre);
        expect(asRecord(updated.body).MediaType).toEqual(original.MediaType);
      }

      const detail = await authenticatedRequest(app)
        .get(`${path}/${id}`)
        .expect(200);
      expect(detail.body).toEqual(updated.body);

      const missing = await authenticatedRequest(app)
        .patch(`${path}/999999999`)
        .send(patchBody)
        .expect(404);
      expectErrorEnvelope(missing.body, 404);
    },
  );

  it('PATCH prioriza el 404 del destino sobre una FK inexistente y conserva la base', async () => {
    const testDatabase = database();
    const countsBefore = catalogCounts();
    const albumsBefore = testDatabase.all<Record<string, unknown>>(
      'SELECT * FROM "Album" ORDER BY "AlbumId" ASC',
    );
    const tracksBefore = testDatabase.all<Record<string, unknown>>(
      'SELECT * FROM "Track" ORDER BY "TrackId" ASC',
    );

    const missingAlbum = await authenticatedRequest(app)
      .patch('/albums/999999999')
      .send({ Title: 'T4 álbum inexistente', ArtistId: 999999999 });

    const missingAlbumWithoutForeignKey = await authenticatedRequest(app)
      .patch('/albums/999999999')
      .send({ Title: 'T4 álbum inexistente sin FK' });

    const existingAlbumWithMissingArtist = await authenticatedRequest(app)
      .patch('/albums/1')
      .send({ ArtistId: 999999999 });

    const missingTrack = await authenticatedRequest(app)
      .patch('/tracks/999999999')
      .send({ Name: 'T4 pista inexistente', AlbumId: 999999999 });

    const missingTrackWithoutForeignKey = await authenticatedRequest(app)
      .patch('/tracks/999999999')
      .send({ Name: 'T4 pista inexistente sin FK' });

    const existingTrackWithMissingAlbum = await authenticatedRequest(app)
      .patch('/tracks/1')
      .send({ AlbumId: 999999999 });

    expect(catalogCounts()).toEqual(countsBefore);
    expect(
      testDatabase.all<Record<string, unknown>>(
        'SELECT * FROM "Album" ORDER BY "AlbumId" ASC',
      ),
    ).toEqual(albumsBefore);
    expect(
      testDatabase.all<Record<string, unknown>>(
        'SELECT * FROM "Track" ORDER BY "TrackId" ASC',
      ),
    ).toEqual(tracksBefore);

    expect([
      missingAlbum.status,
      missingAlbumWithoutForeignKey.status,
      existingAlbumWithMissingArtist.status,
      missingTrack.status,
      missingTrackWithoutForeignKey.status,
      existingTrackWithMissingAlbum.status,
    ]).toEqual([404, 404, 400, 404, 404, 400]);
    expectErrorEnvelope(missingAlbum.body, 404);
    expectErrorEnvelope(missingAlbumWithoutForeignKey.body, 404);
    expectErrorEnvelope(existingAlbumWithMissingArtist.body, 400);
    expectErrorEnvelope(missingTrack.body, 404);
    expectErrorEnvelope(missingTrackWithoutForeignKey.body, 404);
    expectErrorEnvelope(existingTrackWithMissingAlbum.body, 400);
  });

  it('PATCH devuelve 400 con el campo inválido y deja intacto el recurso', async () => {
    const created = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'T2 invalid PATCH sentinel' })
      .expect(201);
    const id = recordId(created.body, 'ArtistId');

    const invalid = await authenticatedRequest(app)
      .patch(`/artists/${id}`)
      .send({ Name: 42 })
      .expect(400);
    expectValidationEnvelope(invalid.body, 'Name');

    const detail = await authenticatedRequest(app)
      .get(`/artists/${id}`)
      .expect(200);
    expect(detail.body).toEqual(created.body);
  });

  it('DELETE elimina los cuatro tipos sin cuerpo y los detalles posteriores responden 404', async () => {
    const artist = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'T2 deletable Artist' })
      .expect(201);
    const album = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'T2 deletable Album', ArtistId: 1 })
      .expect(201);
    const genre = await authenticatedRequest(app)
      .post('/genres')
      .send({ Name: 'T2 deletable Genre' })
      .expect(201);
    const track = await authenticatedRequest(app)
      .post('/tracks')
      .send({
        Name: 'T2 deletable Track',
        MediaTypeId: 1,
        Milliseconds: 1200,
        UnitPrice: 0.99,
      })
      .expect(201);

    const deletions = [
      { path: '/tracks', primaryKey: 'TrackId', body: track.body },
      { path: '/genres', primaryKey: 'GenreId', body: genre.body },
      { path: '/albums', primaryKey: 'AlbumId', body: album.body },
      { path: '/artists', primaryKey: 'ArtistId', body: artist.body },
    ] as const;

    for (const { path, primaryKey, body } of deletions) {
      const id = recordId(body, primaryKey);
      const deleted = await authenticatedRequest(app)
        .delete(`${path}/${id}`)
        .expect(204);
      expect(deleted.text).toBe('');

      const detail = await authenticatedRequest(app)
        .get(`${path}/${id}`)
        .expect(404);
      expectErrorEnvelope(detail.body, 404);

      const repeatedDelete = await authenticatedRequest(app)
        .delete(`${path}/${id}`)
        .expect(404);
      expectErrorEnvelope(repeatedDelete.body, 404);
    }
  });

  it('DELETE responde 409 para recursos referenciados y conserva cada registro', async () => {
    const references = [
      {
        path: '/artists',
        primaryKey: 'ArtistId',
        query:
          'SELECT "ArtistId" AS id FROM "Album" ORDER BY "AlbumId" LIMIT 1',
      },
      {
        path: '/albums',
        primaryKey: 'AlbumId',
        query:
          'SELECT "AlbumId" AS id FROM "Track" WHERE "AlbumId" IS NOT NULL ORDER BY "TrackId" LIMIT 1',
      },
      {
        path: '/genres',
        primaryKey: 'GenreId',
        query:
          'SELECT "GenreId" AS id FROM "Track" WHERE "GenreId" IS NOT NULL ORDER BY "TrackId" LIMIT 1',
      },
      {
        path: '/tracks',
        primaryKey: 'TrackId',
        query:
          'SELECT "TrackId" AS id FROM "InvoiceLine" UNION SELECT "TrackId" AS id FROM "PlaylistTrack" ORDER BY id LIMIT 1',
      },
    ] as const;

    for (const { path, query } of references) {
      const reference = database().get<{ id: number }>(query);
      if (reference === undefined) {
        throw new Error(`Se esperaba una referencia existente para ${path}.`);
      }
      const detailPath = `${path}/${reference.id}`;
      const before = await authenticatedRequest(app)
        .get(detailPath)
        .expect(200);

      const conflict = await authenticatedRequest(app)
        .delete(detailPath)
        .expect(409);
      expectErrorEnvelope(conflict.body, 409);

      const after = await authenticatedRequest(app)
        .get(detailPath)
        .expect(200);
      expect(after.body).toEqual(before.body);
    }
  });

  it.each(collectionPaths)('devuelve 200 [] si %s no tiene resultados', async (path) => {
    const response = await authenticatedRequest(app)
      .get(`${path}?skip=999999`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('permite a viewer consultar listas y detalles de todo el catálogo', async () => {
    for (const path of collectionPaths) {
      await viewerRequest(app).get(path).expect(200);
    }

    for (const path of ['/artists/1', '/albums/1', '/genres/1', '/tracks/1']) {
      await viewerRequest(app).get(path).expect(200);
    }
  });

  it.each(collectionPaths)(
    'normaliza un skip fuera del rango de SQLite en %s a una página vacía',
    async (path) => {
      const response = await authenticatedRequest(app)
        .get(`${path}?skip=9223372036854775808`)
        .expect(200);

      expect(response.body).toEqual([]);
    },
  );

  it.each([
    ['/artists?skip=texto', 'skip no numérico'],
    ['/albums?skip=-1', 'skip negativo'],
    ['/genres?limit=0', 'limit cero'],
    ['/tracks?limit=texto', 'limit no numérico'],
    ['/artists?limit=-1', 'limit negativo'],
  ])('rechaza %s (%s) con 400', async (path) => {
    await authenticatedRequest(app).get(path).expect(400);
  });

  it.each(collectionPaths)('no supera 100 elementos con limit=500 en %s', async (path) => {
    const response = await authenticatedRequest(app)
      .get(`${path}?limit=500`)
      .expect(200);

    expect(response.body.length).toBeLessThanOrEqual(100);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('pagina álbumes en orden y mantiene Artist anidado con el JOIN', async () => {
    const firstPage = await authenticatedRequest(app)
      .get('/albums?skip=0&limit=3')
      .expect(200);
    const firstThree = firstPage.body as AlbumResponse[];

    const response = await authenticatedRequest(app)
      .get('/albums?skip=1&limit=2')
      .expect(200);
    const page = response.body as AlbumResponse[];

    expect(page).toEqual(firstThree.slice(1, 3));
    expect(page.map(({ AlbumId }) => AlbumId)).toEqual(
      [...page].map(({ AlbumId }) => AlbumId).sort((left, right) => left - right),
    );
    for (const album of page) {
      expect(album.Artist).toMatchObject({
        ArtistId: album.ArtistId,
        Name: expect.any(String),
      });
      expect(album).not.toHaveProperty('ArtistName');
    }
  });

  it('normaliza JSON malformado a un error 400 seguro', async () => {
    const malformedBody = '{"Name":';
    const response = await authenticatedRequest(app)
      .post('/artists')
      .set('Content-Type', 'application/json')
      .send(malformedBody)
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El cuerpo de la solicitud no es un JSON válido.',
    });
    expect(response.text).not.toContain('Unexpected');
    expect(response.text).not.toContain(malformedBody);
  });

  it('usa errores { code, message } y agrega errors en validación', async () => {
    const notFound = await authenticatedRequest(app)
      .get('/artists/0')
      .expect(404);
    expect(notFound.body).toEqual({
      code: 404,
      message: 'Artista no encontrado.',
    });

    const invalidArtist = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 42 })
      .expect(400);
    const validation = invalidArtist.body as ValidationResponse;

    expect(validation.code).toBe(400);
    expect(validation.message).toBe('Los datos enviados no son válidos.');
    expect(validation.errors).toContainEqual({
      field: 'Name',
      message: 'El campo Name debe ser una cadena de texto.',
    });
    expect(Object.keys(validation).sort()).toEqual(['code', 'errors', 'message']);
  });

  it('expone solo campos públicos de los cuatro recursos y sus relaciones', async () => {
    const expectedFields = [
      ['/artists', ['ArtistId', 'Name']],
      ['/albums', ['AlbumId', 'Artist', 'ArtistId', 'Title']],
      ['/genres', ['GenreId', 'Name']],
      [
        '/tracks',
        [
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
        ],
      ],
    ] as const;

    for (const [path, fields] of expectedFields) {
      const response = await authenticatedRequest(app)
        .get(`${path}?limit=1`)
        .expect(200);
      const records = response.body as RecordValue[];

      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record).toBeDefined();
      if (record === undefined) {
        throw new Error('Se esperaba una fila pública del catálogo.');
      }
      expect(Object.keys(record).sort()).toEqual([...fields].sort());

      if (path === '/albums') {
        expect(Object.keys(asRecord(record.Artist)).sort()).toEqual([
          'ArtistId',
          'Name',
        ]);
      }
      if (path === '/tracks') {
        expect(Object.keys(asRecord(record.Album)).sort()).toEqual([
          'AlbumId',
          'Title',
        ]);
        expect(Object.keys(asRecord(record.Genre)).sort()).toEqual([
          'GenreId',
          'Name',
        ]);
        expect(Object.keys(asRecord(record.MediaType)).sort()).toEqual([
          'MediaTypeId',
          'Name',
        ]);
      }

      const propertyNames = collectPropertyNames(records).map((name) =>
        name.toLowerCase(),
      );
      expect(propertyNames).not.toContain('password');
      expect(propertyNames).not.toContain('token');
      expect(propertyNames).not.toContain('jwt_secret');
      expect(propertyNames).not.toContain('hash');
      expect(propertyNames).not.toContain('createdat');
      expect(propertyNames).not.toContain('updatedat');
    }
  });

  it('protege las 12 rutas de escritura con WWW-Authenticate: Bearer', async () => {
    const before = catalogCounts();
    const snapshotsBefore = await resourceSnapshots();
    const unauthorizedRequests = [
      () => request(app.getHttpServer()).post('/artists').send({ Name: 'No autorizado' }),
      () => request(app.getHttpServer()).post('/albums').send({ Title: 'No autorizado', ArtistId: 1 }),
      () => request(app.getHttpServer()).post('/genres').send({ Name: 'No autorizado' }),
      () => request(app.getHttpServer()).post('/tracks').send({
        Name: 'No autorizado',
        MediaTypeId: 1,
        Milliseconds: 1000,
        UnitPrice: 0.99,
      }),
      () => request(app.getHttpServer()).patch('/artists/1').send({ Name: 'No autorizado' }),
      () => request(app.getHttpServer()).patch('/albums/1').send({ Title: 'No autorizado' }),
      () => request(app.getHttpServer()).patch('/genres/1').send({ Name: 'No autorizado' }),
      () => request(app.getHttpServer()).patch('/tracks/1').send({ Name: 'No autorizado' }),
      () => request(app.getHttpServer()).delete('/artists/1'),
      () => request(app.getHttpServer()).delete('/albums/1'),
      () => request(app.getHttpServer()).delete('/genres/1'),
      () => request(app.getHttpServer()).delete('/tracks/1'),
    ];

    for (const makeRequest of unauthorizedRequests) {
      const response = await makeRequest();
      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body).toEqual({
        code: 401,
        message: 'Se requieren credenciales válidas.',
      });
    }
    expect(catalogCounts()).toEqual(before);
    expect(await resourceSnapshots()).toEqual(snapshotsBefore);
  });

  it('permite títulos duplicados y confirma completas dos altas concurrentes', async () => {
    const title = 'T19 álbum duplicado concurrente';
    const createAlbum = () =>
      authenticatedRequest(app)
        .post('/albums')
        .send({ Title: title, ArtistId: 1 });

    const [firstResponse, secondResponse] = await Promise.all([
      createAlbum(),
      createAlbum(),
    ]);
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);

    const first = firstResponse.body as AlbumResponse;
    const second = secondResponse.body as AlbumResponse;
    expect(first.AlbumId).not.toBe(second.AlbumId);
    expect(first.Title).toBe(title);
    expect(second.Title).toBe(title);
    expect(first.Artist).toEqual({ ArtistId: 1, Name: expect.any(String) });
    expect(second.Artist).toEqual({ ArtistId: 1, Name: expect.any(String) });

    const stored = database().get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM "Album" WHERE "Title" = ?',
      title,
    );
    expect(stored?.count).toBe(2);

    const [firstDetail, secondDetail] = await Promise.all([
      authenticatedRequest(app).get(`/albums/${first.AlbumId}`),
      authenticatedRequest(app).get(`/albums/${second.AlbumId}`),
    ]);
    expect(firstDetail.status).toBe(200);
    expect(secondDetail.status).toBe(200);
    expect(firstDetail.body).toMatchObject({ AlbumId: first.AlbumId, Title: title });
    expect(secondDetail.body).toMatchObject({ AlbumId: second.AlbumId, Title: title });
  });

  it('permite actualizar un álbum al título ya usado por otro álbum', async () => {
    const duplicateTitle = 'T19 título compartido por PATCH';
    const sourceResponse = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: duplicateTitle, ArtistId: 1 })
      .expect(201);
    const source = sourceResponse.body as AlbumResponse;
    const targetResponse = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'T19 título inicial de PATCH', ArtistId: 1 })
      .expect(201);
    const target = targetResponse.body as AlbumResponse;

    const patchedResponse = await authenticatedRequest(app)
      .patch(`/albums/${target.AlbumId}`)
      .send({ Title: duplicateTitle })
      .expect(200);
    expect(patchedResponse.body).toMatchObject({
      AlbumId: target.AlbumId,
      Title: duplicateTitle,
      Artist: { ArtistId: 1, Name: expect.any(String) },
    });

    const [sourceDetail, targetDetail] = await Promise.all([
      authenticatedRequest(app).get(`/albums/${source.AlbumId}`).expect(200),
      authenticatedRequest(app).get(`/albums/${target.AlbumId}`).expect(200),
    ]);
    expect(sourceDetail.body).toMatchObject({
      AlbumId: source.AlbumId,
      Title: duplicateTitle,
    });
    expect(targetDetail.body).toMatchObject({
      AlbumId: target.AlbumId,
      Title: duplicateTitle,
    });
    expect(source.AlbumId).not.toBe(target.AlbumId);
  });

  it('responde 409 y no persiste POST ni PATCH que infringen una restricción de prueba', async () => {
    const testDatabase = database();
    const sentinelName = 'T19 constraint sentinel';
    const sentinelCount = () =>
      testDatabase.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM "Artist" WHERE "Name" = ?',
        sentinelName,
      )?.count ?? 0;

    expect(sentinelCount()).toBe(0);
    testDatabase.run(
      `CREATE UNIQUE INDEX "T19_UniqueArtistSentinel" ON "Artist" ("Name") ` +
        `WHERE "Name" = '${sentinelName}'`,
    );

    try {
      const created = await authenticatedRequest(app)
        .post('/artists')
        .send({ Name: sentinelName });
      expect(created.status).toBe(201);
      expect(sentinelCount()).toBe(1);

      const duplicatePost = await authenticatedRequest(app)
        .post('/artists')
        .send({ Name: sentinelName });
      expect(duplicatePost.status).toBe(409);
      expectErrorEnvelope(duplicatePost.body, 409);
      expect(sentinelCount()).toBe(1);

      const artistBeforePatch = testDatabase.get<{ Name: string }>(
        'SELECT "Name" FROM "Artist" WHERE "ArtistId" = ?',
        1,
      );
      expect(artistBeforePatch).toBeDefined();

      const duplicatePatch = await authenticatedRequest(app)
        .patch('/artists/1')
        .send({ Name: sentinelName });
      expect(duplicatePatch.status).toBe(409);
      expectErrorEnvelope(duplicatePatch.body, 409);
      expect(
        testDatabase.get<{ Name: string }>(
          'SELECT "Name" FROM "Artist" WHERE "ArtistId" = ?',
          1,
        ),
      ).toEqual(artistBeforePatch);
      expect(sentinelCount()).toBe(1);
    } finally {
      testDatabase.run('DROP INDEX IF EXISTS "T19_UniqueArtistSentinel"');
      testDatabase.run('DELETE FROM "Artist" WHERE "Name" = ?', sentinelName);
    }
  });

  it('registra los dos PATCH concurrentes y refleja el commit con mayor Sequence', async () => {
    const testDatabase = database();
    const artistId = 1;
    const originalArtist = testDatabase.get<{ Name: string }>(
      'SELECT "Name" FROM "Artist" WHERE "ArtistId" = ?',
      artistId,
    );
    if (originalArtist === undefined) {
      throw new Error('Se esperaba encontrar el artista de prueba.');
    }

    const firstName = 'T19 concurrent patch A';
    const secondName = 'T19 concurrent patch B';

    try {
      testDatabase.run(
        'CREATE TABLE "PatchCommitLog" (' +
          '"Sequence" INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          '"ArtistId" INTEGER NOT NULL, "Name" TEXT NOT NULL)',
      );
      testDatabase.run(
        'CREATE TRIGGER "T19_LogArtistNamePatch" ' +
          'AFTER UPDATE OF "Name" ON "Artist" ' +
          'WHEN NEW."ArtistId" = 1 BEGIN ' +
          'INSERT INTO "PatchCommitLog" ("ArtistId", "Name") ' +
          'VALUES (NEW."ArtistId", NEW."Name"); END',
      );

      const responses = await Promise.all([
        authenticatedRequest(app)
          .patch(`/artists/${artistId}`)
          .send({ Name: firstName }),
        authenticatedRequest(app)
          .patch(`/artists/${artistId}`)
          .send({ Name: secondName }),
      ]);
      expect(responses.map(({ status }) => status)).toEqual([200, 200]);

      const commits = testDatabase.all<{ Sequence: number; Name: string }>(
        'SELECT "Sequence", "Name" FROM "PatchCommitLog" ' +
          'WHERE "ArtistId" = ? ORDER BY "Sequence" ASC',
        artistId,
      );
      expect(commits).toHaveLength(2);
      expect(new Set(commits.map(({ Name }) => Name))).toEqual(
        new Set([firstName, secondName]),
      );

      const latestCommit = testDatabase.get<{ Sequence: number; Name: string }>(
        'SELECT "Sequence", "Name" FROM "PatchCommitLog" ' +
          'WHERE "ArtistId" = ? ORDER BY "Sequence" DESC LIMIT 1',
        artistId,
      );
      expect(latestCommit).toBeDefined();
      if (latestCommit === undefined) {
        throw new Error('Se esperaba recuperar el último commit registrado.');
      }
      expect(latestCommit.Sequence).toBe(
        Math.max(...commits.map(({ Sequence }) => Sequence)),
      );

      const finalArtist = await authenticatedRequest(app)
        .get(`/artists/${artistId}`)
        .expect(200);
      expect(finalArtist.body).toMatchObject({
        ArtistId: artistId,
        Name: latestCommit.Name,
      });
    } finally {
      testDatabase.run('DROP TRIGGER IF EXISTS "T19_LogArtistNamePatch"');
      testDatabase.run(
        'UPDATE "Artist" SET "Name" = ? WHERE "ArtistId" = ?',
        originalArtist.Name,
        artistId,
      );
      testDatabase.run('DROP TABLE IF EXISTS "PatchCommitLog"');
    }
  });

  it.each([
    {
      path: '/artists',
      primaryKey: 'ArtistId',
      order: /ORDER BY "ArtistId" ASC LIMIT \? OFFSET \?$/,
      joins: [],
    },
    {
      path: '/genres',
      primaryKey: 'GenreId',
      order: /ORDER BY "GenreId" ASC LIMIT \? OFFSET \?$/,
      joins: [],
    },
    {
      path: '/albums',
      primaryKey: 'AlbumId',
      order: /ORDER BY "Album"\."AlbumId" ASC LIMIT \? OFFSET \?$/,
      joins: [/INNER JOIN "Artist" ON "Artist"\."ArtistId" = "Album"\."ArtistId"/],
    },
    {
      path: '/tracks',
      primaryKey: 'TrackId',
      order: /ORDER BY "Track"\."TrackId" ASC LIMIT \? OFFSET \?$/,
      joins: [
        /LEFT JOIN "Album" ON "Album"\."AlbumId" = "Track"\."AlbumId"/,
        /LEFT JOIN "Genre" ON "Genre"\."GenreId" = "Track"\."GenreId"/,
        /INNER JOIN "MediaType" ON "MediaType"\."MediaTypeId" = "Track"\."MediaTypeId"/,
      ],
    },
  ])('verifica RNF-5 en $path mediante su consulta HTTP', async ({
    path,
    primaryKey,
    order,
    joins,
  }) => {
    const testDatabase = database();
    const query = vi.spyOn(testDatabase, 'all');

    try {
      const response = await authenticatedRequest(app)
        .get(`${path}?skip=10&limit=500`)
        .expect(200);
      const records = asRecords(response.body);

      expect(records.length).toBeGreaterThan(0);
      expect(records.length).toBeLessThanOrEqual(100);
      const ids = records.map((record) => {
        const id = record[primaryKey];
        if (typeof id !== 'number') {
          throw new Error(`Se esperaba una clave primaria numérica ${primaryKey}.`);
        }
        return id;
      });
      expect(ids).toEqual([...ids].sort((left, right) => left - right));
      expect(query).toHaveBeenCalledTimes(1);

      const [sql, ...parameters] = query.mock.calls[0] ?? [];
      if (typeof sql !== 'string') {
        throw new Error('La consulta HTTP de paginación debe ser SQL.');
      }
      expect(sql).toMatch(order);
      expect(sql).toMatch(/LIMIT \? OFFSET \?$/);
      expect(sql).not.toMatch(/\bCOUNT\s*\(/i);
      expect(parameters).toEqual([100, 10]);
      for (const join of joins) {
        expect(sql).toMatch(join);
      }

      query.mockRestore();
      const queryPlan = testDatabase.all<{ detail: string }>(
        `EXPLAIN QUERY PLAN ${sql}`,
        ...parameters,
      );
      const planDetails = queryPlan.map(({ detail }) => detail).join(' ');
      expect(planDetails).not.toMatch(/MATERIALIZE|USE TEMP B-TREE/i);
    } finally {
      query.mockRestore();
    }
  });

  it('devuelve 200 [] cuando la tabla Genre está realmente vacía', async () => {
    const detachedTracks = database().run('UPDATE "Track" SET "GenreId" = NULL');
    expect(detachedTracks.changes).toBeGreaterThan(0);

    const deletedGenres = database().run('DELETE FROM "Genre"');
    expect(deletedGenres.changes).toBeGreaterThan(0);

    const response = await authenticatedRequest(app).get('/genres').expect(200);
    expect(response.body).toEqual([]);
  });

  it('no confunde un id entero grande con otro artista existente', async () => {
    const testDatabase = database();
    const existingId = '9007199254740992';
    const missingId = '9007199254740993';

    expect(
      testDatabase.get(
        `SELECT "ArtistId" FROM "Artist" WHERE "ArtistId" = ${missingId}`,
      ),
    ).toBeUndefined();
    testDatabase.run(
      `INSERT INTO "Artist" ("ArtistId", "Name") VALUES (${existingId}, 'T7 large id fixture')`,
    );

    try {
      const existing = testDatabase.get<{ Name: string }>(
        `SELECT "Name" FROM "Artist" WHERE "ArtistId" = ${existingId}`,
      );
      expect(existing?.Name).toBe('T7 large id fixture');
      expect(
        testDatabase.get(
          `SELECT "ArtistId" FROM "Artist" WHERE "ArtistId" = ${missingId}`,
        ),
      ).toBeUndefined();

      const existingResponse = await viewerRequest(app).get(
        `/artists/${existingId}`,
      );
      expect(existingResponse.status).toBe(200);
      expect(existingResponse.body.Name).toBe('T7 large id fixture');

      const missingResponse = await viewerRequest(app).get(
        `/artists/${missingId}`,
      );
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.body).toMatchObject({
        code: 404,
        message: expect.any(String),
      });
    } finally {
      testDatabase.run(
        `DELETE FROM "Artist" WHERE "ArtistId" = ${existingId}`,
      );
    }
  });
});
