import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { authenticatedRequest, viewerRequest } from './helpers/auth-test-context.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AppModule } from '../src/app.module.js';

interface TrackResponse {
  TrackId: number;
  Name: string;
  AlbumId: number | null;
  GenreId: number | null;
  MediaTypeId: number;
  Composer: string | null;
  Milliseconds: number;
  Bytes: number | null;
  UnitPrice: number;
  Album: { AlbumId: number; Title: string } | null;
  Genre: { GenreId: number; Name: string | null } | null;
  MediaType: { MediaTypeId: number; Name: string };
}

interface TrackPayload {
  Name: string;
  AlbumId?: number | null;
  MediaTypeId: number;
  GenreId?: number | null;
  Milliseconds: number;
  UnitPrice: number;
}

interface GenreResponse {
  GenreId: number;
  Name: string | null;
}

describe('TracksController (e2e)', () => {
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

  function trackCount(): number {
    const result = database().get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM "Track"',
    );
    return result?.count ?? 0;
  }

  async function createTrack(
    overrides: Partial<TrackPayload> = {},
  ): Promise<TrackResponse> {
    const payload: TrackPayload = {
      Name: 'Pista E4 de prueba',
      AlbumId: 1,
      MediaTypeId: 1,
      GenreId: 1,
      Milliseconds: 123456,
      UnitPrice: 0.99,
      ...overrides,
    };
    const response = await authenticatedRequest(app)
      .post('/tracks')
      .send(payload)
      .expect(201);

    return response.body as TrackResponse;
  }

  it('permite las consultas de viewer y rechaza sus escrituras sin mutar pistas', async () => {
    const track = await createTrack({
      Name: 'TP2 T5 pista de permisos',
      AlbumId: null,
      GenreId: null,
    });
    const countBeforeDeniedPost = trackCount();

    await viewerRequest(app).get('/tracks').expect(200);
    const before = await viewerRequest(app)
      .get(`/tracks/${track.TrackId}`)
      .expect(200);
    await viewerRequest(app)
      .post('/tracks')
      .send({
        Name: 'TP2 T5 pista no autorizada',
        MediaTypeId: 1,
        Milliseconds: 1000,
        UnitPrice: 0.99,
      })
      .expect(403);
    expect(trackCount()).toBe(countBeforeDeniedPost);

    await viewerRequest(app)
      .patch(`/tracks/${track.TrackId}`)
      .send({ Name: 'Cambio no autorizado' })
      .expect(403);
    const afterPatch = await viewerRequest(app)
      .get(`/tracks/${track.TrackId}`)
      .expect(200);
    expect(afterPatch.body).toEqual(before.body);

    await viewerRequest(app)
      .delete(`/tracks/${track.TrackId}`)
      .expect(403);
    const afterDelete = await viewerRequest(app)
      .get(`/tracks/${track.TrackId}`)
      .expect(200);
    expect(afterDelete.body).toEqual(before.body);
  });

  it('incluye las relaciones anidadas en listado y detalle', async () => {
    const list = await authenticatedRequest(app)
      .get('/tracks?skip=0&limit=1')
      .expect(200);

    expect(list.body[0]).toMatchObject({
      TrackId: 1,
      Album: { AlbumId: 1, Title: expect.any(String) },
      Genre: { GenreId: 1, Name: 'Rock' },
      MediaType: { MediaTypeId: 1, Name: expect.any(String) },
    });

    const detail = await authenticatedRequest(app)
      .get('/tracks/1')
      .expect(200);

    expect(detail.body).toEqual(list.body[0]);
  });

  it('crea con relaciones anidadas y las conserva en un PATCH parcial', async () => {
    const created = await createTrack({ Name: 'Pista antes del PATCH' });
    expect(created).toMatchObject({
      Name: 'Pista antes del PATCH',
      Album: { AlbumId: 1, Title: expect.any(String) },
      Genre: { GenreId: 1, Name: 'Rock' },
      MediaType: { MediaTypeId: 1, Name: expect.any(String) },
    });

    const updated = await authenticatedRequest(app)
      .patch(`/tracks/${created.TrackId}`)
      .send({ Name: 'Pista después del PATCH' })
      .expect(200);

    expect(updated.body).toEqual({
      ...created,
      Name: 'Pista después del PATCH',
    });
  });

  it('representa Album y Genre nulos cuando la pista no tiene esas referencias', async () => {
    const created = await createTrack({ AlbumId: null, GenreId: null });

    expect(created.AlbumId).toBeNull();
    expect(created.GenreId).toBeNull();
    expect(created.Album).toBeNull();
    expect(created.Genre).toBeNull();
    expect(created.MediaType).toMatchObject({ MediaTypeId: 1 });
  });

  it('conserva anidado un Genre asociado cuyo Name es null', async () => {
    const createdGenre = await authenticatedRequest(app)
      .post('/genres')
      .send({ Name: null })
      .expect(201);
    const genre = createdGenre.body as GenreResponse;
    expect(genre.Name).toBeNull();

    const createdTrack = await createTrack({ GenreId: genre.GenreId });

    expect(createdTrack.Genre).toEqual({
      GenreId: genre.GenreId,
      Name: null,
    });
  });

  it.each(['Name', 'MediaTypeId', 'Milliseconds', 'UnitPrice'])(
    'rechaza la creación sin el campo obligatorio %s y no persiste',
    async (field) => {
      const before = trackCount();
      const payload: Record<string, unknown> = {
        Name: 'Pista incompleta',
        AlbumId: 1,
        MediaTypeId: 1,
        GenreId: 1,
        Milliseconds: 123456,
        UnitPrice: 0.99,
      };
      delete payload[field];

      await authenticatedRequest(app)
        .post('/tracks')
        .send(payload)
        .expect(400);

      expect(trackCount()).toBe(before);
    },
  );

  it.each(['AlbumId', 'GenreId', 'MediaTypeId'])(
    'rechaza la referencia inexistente %s y no persiste',
    async (field) => {
      const before = trackCount();
      const payload: Record<string, unknown> = {
        Name: 'Pista con referencia inexistente',
        AlbumId: 1,
        MediaTypeId: 1,
        GenreId: 1,
        Milliseconds: 123456,
        UnitPrice: 0.99,
      };
      payload[field] = 0;

      await authenticatedRequest(app)
        .post('/tracks')
        .send(payload)
        .expect(400);

      expect(trackCount()).toBe(before);
    },
  );

  it.each(['AlbumId', 'GenreId', 'MediaTypeId'])(
    'rechaza PATCH con referencia inexistente %s y conserva la pista',
    async (field) => {
      const created = await createTrack();
      const before = await authenticatedRequest(app)
        .get(`/tracks/${created.TrackId}`)
        .expect(200);
      const patch: Record<string, unknown> = { [field]: 0 };

      await authenticatedRequest(app)
        .patch(`/tracks/${created.TrackId}`)
        .send(patch)
        .expect(400);

      const after = await authenticatedRequest(app)
        .get(`/tracks/${created.TrackId}`)
        .expect(200);
      expect(after.body).toEqual(before.body);
    },
  );

  it('rechaza id cero como inexistente y formatos inválidos como 400', async () => {
    await authenticatedRequest(app).get('/tracks/0').expect(404);

    for (const id of ['texto', '1.5', '-1', '1e0', '1.0', '1e3', '0x1', '-0']) {
      await authenticatedRequest(app).get(`/tracks/${id}`).expect(400);
    }
  });

  it('elimina con 204 sin cuerpo y el detalle posterior responde 404', async () => {
    const created = await createTrack({ AlbumId: null, GenreId: null });

    const deleted = await authenticatedRequest(app)
      .delete(`/tracks/${created.TrackId}`)
      .expect(204);

    expect(deleted.text).toBe('');
    await authenticatedRequest(app)
      .get(`/tracks/${created.TrackId}`)
      .expect(404);
  });

  it('responde 409 y conserva una pista referenciada solo por PlaylistTrack', async () => {
    const playlistReference = database().get<{ TrackId: number }>(
      'SELECT "PlaylistTrack"."TrackId" FROM "PlaylistTrack" ' +
        'WHERE NOT EXISTS (' +
        'SELECT 1 FROM "InvoiceLine" ' +
        'WHERE "InvoiceLine"."TrackId" = "PlaylistTrack"."TrackId") ' +
        'ORDER BY "PlaylistTrack"."TrackId" LIMIT 1',
    );
    expect(playlistReference).toBeDefined();
    if (playlistReference === undefined) {
      throw new Error('Se esperaba una pista referenciada solo por PlaylistTrack.');
    }
    expect(
      database().get<{ TrackId: number }>(
        'SELECT "TrackId" FROM "InvoiceLine" WHERE "TrackId" = ?',
        playlistReference.TrackId,
      ),
    ).toBeUndefined();
    expect(
      database().get<{ TrackId: number }>(
        'SELECT "TrackId" FROM "PlaylistTrack" WHERE "TrackId" = ?',
        playlistReference.TrackId,
      ),
    ).toBeDefined();
    const playlistRowsBefore = database().all<{
      PlaylistId: number;
      TrackId: number;
    }>(
      'SELECT "PlaylistId", "TrackId" FROM "PlaylistTrack" ' +
        'WHERE "TrackId" = ? ORDER BY "PlaylistId"',
      playlistReference.TrackId,
    );
    expect(playlistRowsBefore.length).toBeGreaterThan(0);

    await authenticatedRequest(app)
      .delete(`/tracks/${playlistReference.TrackId}`)
      .expect(409);

    const playlistRowsAfter = database().all<{
      PlaylistId: number;
      TrackId: number;
    }>(
      'SELECT "PlaylistId", "TrackId" FROM "PlaylistTrack" ' +
        'WHERE "TrackId" = ? ORDER BY "PlaylistId"',
      playlistReference.TrackId,
    );
    expect(playlistRowsAfter).toEqual(playlistRowsBefore);

    await authenticatedRequest(app)
      .get(`/tracks/${playlistReference.TrackId}`)
      .expect(200);
  });

  it('responde 409 y conserva una pista referenciada solo por InvoiceLine', async () => {
    const created = await createTrack({ Name: 'Pista vinculada a factura' });
    expect(
      database().get<{ TrackId: number }>(
        'SELECT "TrackId" FROM "PlaylistTrack" WHERE "TrackId" = ?',
        created.TrackId,
      ),
    ).toBeUndefined();

    const invoice = database().get<{ InvoiceId: number }>(
      'SELECT "InvoiceId" FROM "Invoice" ORDER BY "InvoiceId" LIMIT 1',
    );
    expect(invoice).toBeDefined();
    if (invoice === undefined) {
      throw new Error('Se esperaba una factura en la DB temporal.');
    }

    database().run(
      'INSERT INTO "InvoiceLine" ' +
        '("InvoiceId", "TrackId", "UnitPrice", "Quantity") ' +
        'VALUES (?, ?, ?, ?)',
      invoice.InvoiceId,
      created.TrackId,
      created.UnitPrice,
      1,
    );
    expect(
      database().get<{ TrackId: number }>(
        'SELECT "TrackId" FROM "InvoiceLine" WHERE "TrackId" = ?',
        created.TrackId,
      ),
    ).toBeDefined();
    expect(
      database().get<{ TrackId: number }>(
        'SELECT "TrackId" FROM "PlaylistTrack" WHERE "TrackId" = ?',
        created.TrackId,
      ),
    ).toBeUndefined();
    const invoiceRowsBefore = database().all<{ InvoiceLineId: number }>(
      'SELECT "InvoiceLineId" FROM "InvoiceLine" ' +
        'WHERE "TrackId" = ? ORDER BY "InvoiceLineId"',
      created.TrackId,
    );
    expect(invoiceRowsBefore.length).toBeGreaterThan(0);

    await authenticatedRequest(app)
      .delete(`/tracks/${created.TrackId}`)
      .expect(409);

    const invoiceRowsAfter = database().all<{ InvoiceLineId: number }>(
      'SELECT "InvoiceLineId" FROM "InvoiceLine" ' +
        'WHERE "TrackId" = ? ORDER BY "InvoiceLineId"',
      created.TrackId,
    );
    expect(invoiceRowsAfter).toEqual(invoiceRowsBefore);

    await authenticatedRequest(app)
      .get(`/tracks/${created.TrackId}`)
      .expect(200);
  });
});
