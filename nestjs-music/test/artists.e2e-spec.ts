import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { authenticatedRequest, viewerRequest } from './helpers/auth-test-context.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AppModule } from '../src/app.module.js';

describe('ArtistsController (e2e)', () => {
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

  it('permite las consultas de viewer y rechaza sus escrituras sin mutar artistas', async () => {
    const database = app.get(DatabaseService);
    const created = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'TP2 T5 artista de permisos' })
      .expect(201);
    const artist = created.body as { ArtistId: number; Name: string };
    const countBeforeDeniedPost = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Artist',
    )?.count;

    await viewerRequest(app).get('/artists').expect(200);
    const before = await viewerRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);
    await viewerRequest(app)
      .post('/artists')
      .send({ Name: 'TP2 T5 artista no autorizado' })
      .expect(403);
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM Artist',
      )?.count,
    ).toBe(countBeforeDeniedPost);

    await viewerRequest(app)
      .patch(`/artists/${artist.ArtistId}`)
      .send({ Name: 'Cambio no autorizado' })
      .expect(403);
    const afterPatch = await viewerRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);
    expect(afterPatch.body).toEqual(before.body);

    await viewerRequest(app)
      .delete(`/artists/${artist.ArtistId}`)
      .expect(403);
    const afterDelete = await viewerRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);
    expect(afterDelete.body).toEqual(before.body);
  });

  it('lista artistas en orden ascendente y aplica paginación', async () => {
    const response = await authenticatedRequest(app)
      .get('/artists')
      .expect(200);
    const artists = response.body as Array<{
      ArtistId: number;
      Name: string;
    }>;

    expect(artists.length).toBeGreaterThan(3);
    expect(artists.map(({ ArtistId }) => ArtistId)).toEqual(
      [...artists].map(({ ArtistId }) => ArtistId).sort((left, right) => left - right),
    );

    const page = await authenticatedRequest(app)
      .get('/artists?skip=1&limit=2')
      .expect(200);

    expect(page.body).toEqual(artists.slice(1, 3));
  });

  it('devuelve el detalle de un artista existente', async () => {
    const response = await authenticatedRequest(app)
      .get('/artists/1')
      .expect(200);

    expect(response.body).toMatchObject({ ArtistId: 1, Name: expect.any(String) });
  });

  it('responde 404 para id cero, que es válido pero inexistente', async () => {
    const response = await authenticatedRequest(app)
      .get('/artists/0')
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      message: 'Artista no encontrado.',
    });
  });

  it.each(['texto', '1.5', '-1', '1e0', '1.0', '1e3', '0x1', '-0'])(
    'rechaza el id inválido %s con 400',
    async (id) => {
      await authenticatedRequest(app).get(`/artists/${id}`).expect(400);
    },
  );

  it('GET /artists/texto incluye el campo id en los errores de validación', async () => {
    const response = await authenticatedRequest(app)
      .get('/artists/texto')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 400,
      message: expect.any(String),
      errors: expect.arrayContaining([
        expect.objectContaining({
          field: 'id',
          message: expect.stringMatching(/\S/),
        }),
      ]),
    });
  });

  it('rechaza PATCH con id exponencial y conserva el artista', async () => {
    const created = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'Codex T10 PATCH lexical ID' })
      .expect(201);
    const artist = created.body as { ArtistId: number; Name: string };
    const before = await authenticatedRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);

    const patchResponse = await authenticatedRequest(app)
      .patch(`/artists/${artist.ArtistId}e0`)
      .send({ Name: 'No debe actualizarse' });
    const after = await authenticatedRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);

    expect({ status: patchResponse.status, artist: after.body }).toEqual({
      status: 400,
      artist: before.body,
    });
  });

  it('rechaza DELETE con id decimal y conserva el artista', async () => {
    const created = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'Codex T10 DELETE lexical ID' })
      .expect(201);
    const artist = created.body as { ArtistId: number; Name: string };
    const before = await authenticatedRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(200);

    const deleteResponse = await authenticatedRequest(app)
      .delete(`/artists/${artist.ArtistId}.0`)
    const after = await authenticatedRequest(app).get(
      `/artists/${artist.ArtistId}`,
    );

    expect({ status: deleteResponse.status, detail: after.status, artist: after.body }).toEqual({
      status: 400,
      detail: 200,
      artist: before.body,
    });
  });

  it('rechaza la creación sin credenciales y no persiste', async () => {
    const database = app.get(DatabaseService);
    const countBefore = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Artist',
    );

    const withoutCredentials = await request(app.getHttpServer())
      .post('/artists')
      .send({ Name: 'Artista sin credenciales' })
      .expect(401);
    expect(withoutCredentials.headers['www-authenticate']).toBe('Bearer');
    expect(withoutCredentials.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });

    const countAfter = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Artist',
    );
    expect(countAfter?.count).toBe(countBefore?.count);
  });

  it('rechaza la creación con credenciales inválidas', async () => {
    const invalidCredentials = await request(app.getHttpServer())
      .post('/artists')
      .set('Authorization', 'Bearer token-invalido')
      .send({ Name: 'Artista con token inválido' })
      .expect(401);
    expect(invalidCredentials.headers['www-authenticate']).toBe('Bearer');
    expect(invalidCredentials.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });
  });

  it('responde 400 si el DTO de creación es inválido', async () => {
    await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 42 })
      .expect(400);
  });

  it('crea, actualiza parcialmente y elimina un artista', async () => {
    const created = await authenticatedRequest(app)
      .post('/artists')
      .send({ Name: 'Codex T10 E2E Artist' })
      .expect(201);
    const artist = created.body as { ArtistId: number; Name: string };

    expect(artist).toMatchObject({ Name: 'Codex T10 E2E Artist' });
    expect(Number.isInteger(artist.ArtistId)).toBe(true);

    const updated = await authenticatedRequest(app)
      .patch(`/artists/${artist.ArtistId}`)
      .send({ Name: 'Codex T10 Artist Updated' })
      .expect(200);

    expect(updated.body).toEqual({
      ArtistId: artist.ArtistId,
      Name: 'Codex T10 Artist Updated',
    });

    const deleted = await authenticatedRequest(app)
      .delete(`/artists/${artist.ArtistId}`)
      .expect(204);

    expect(deleted.text).toBe('');
    await authenticatedRequest(app)
      .get(`/artists/${artist.ArtistId}`)
      .expect(404);
  });

  it('responde 409 y conserva el artista cuando tiene álbumes asociados', async () => {
    const database = app.get(DatabaseService);
    const artistWithAlbums = database.get<{ ArtistId: number }>(
      'SELECT Artist.ArtistId FROM Artist ' +
        'INNER JOIN Album ON Album.ArtistId = Artist.ArtistId LIMIT 1',
    );

    expect(artistWithAlbums).toBeDefined();
    const albumIdsBefore = database.all<{ AlbumId: number }>(
      'SELECT AlbumId FROM Album WHERE ArtistId = ? ORDER BY AlbumId',
      artistWithAlbums?.ArtistId,
    );
    expect(albumIdsBefore.length).toBeGreaterThan(0);

    await authenticatedRequest(app)
      .delete(`/artists/${artistWithAlbums?.ArtistId}`)
      .expect(409);

    const albumIdsAfter = database.all<{ AlbumId: number }>(
      'SELECT AlbumId FROM Album WHERE ArtistId = ? ORDER BY AlbumId',
      artistWithAlbums?.ArtistId,
    );

    await authenticatedRequest(app)
      .get(`/artists/${artistWithAlbums?.ArtistId}`)
      .expect(200);

    expect(albumIdsAfter).toEqual(albumIdsBefore);
  });
});
