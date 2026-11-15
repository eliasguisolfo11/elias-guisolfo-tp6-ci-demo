import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { authenticatedRequest, viewerRequest } from './helpers/auth-test-context.js';
import { AppModule } from '../src/app.module.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';

interface GenreResponse {
  GenreId: number;
  Name: string | null;
}

describe('GenresController (e2e)', () => {
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

  it('permite las consultas de viewer y rechaza sus escrituras sin mutar géneros', async () => {
    const database = app.get(DatabaseService);
    const created = await authenticatedRequest(app)
      .post('/genres')
      .send({ Name: 'TP2 T5 género de permisos' })
      .expect(201);
    const genre = created.body as GenreResponse;
    const countBeforeDeniedPost = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Genre',
    )?.count;

    await viewerRequest(app).get('/genres').expect(200);
    const before = await viewerRequest(app)
      .get(`/genres/${genre.GenreId}`)
      .expect(200);
    await viewerRequest(app)
      .post('/genres')
      .send({ Name: 'TP2 T5 género no autorizado' })
      .expect(403);
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM Genre',
      )?.count,
    ).toBe(countBeforeDeniedPost);

    await viewerRequest(app)
      .patch(`/genres/${genre.GenreId}`)
      .send({ Name: 'Cambio no autorizado' })
      .expect(403);
    const afterPatch = await viewerRequest(app)
      .get(`/genres/${genre.GenreId}`)
      .expect(200);
    expect(afterPatch.body).toEqual(before.body);

    await viewerRequest(app)
      .delete(`/genres/${genre.GenreId}`)
      .expect(403);
    const afterDelete = await viewerRequest(app)
      .get(`/genres/${genre.GenreId}`)
      .expect(200);
    expect(afterDelete.body).toEqual(before.body);

    await authenticatedRequest(app)
      .patch(`/genres/${genre.GenreId}`)
      .send({ Name: 'TP2 T5 género actualizado por admin' })
      .expect(200);
  });

  it('crea Name null, lista géneros con paginación y devuelve el detalle', async () => {
    const created = await authenticatedRequest(app)
      .post('/genres')
      .send({ Name: null })
      .expect(201);
    const genre = created.body as GenreResponse;

    expect(genre).toMatchObject({ GenreId: expect.any(Number), Name: null });

    const listed = await authenticatedRequest(app)
      .get('/genres')
      .expect(200);
    const genres = listed.body as GenreResponse[];

    expect(genres).toContainEqual(genre);
    expect(genres.length).toBeGreaterThan(2);

    const page = await authenticatedRequest(app)
      .get('/genres?skip=1&limit=2')
      .expect(200);
    expect(page.body).toEqual(genres.slice(1, 3));

    const detail = await authenticatedRequest(app)
      .get(`/genres/${genre.GenreId}`)
      .expect(200);
    expect(detail.body).toEqual(genre);
  });

  it('elimina un género con 204 y luego responde 404 al consultar su detalle', async () => {
    const created = await authenticatedRequest(app)
      .post('/genres')
      .send({ Name: 'Género T15 eliminable' })
      .expect(201);
    const genre = created.body as GenreResponse;

    const deleted = await authenticatedRequest(app)
      .delete(`/genres/${genre.GenreId}`)
      .expect(204);

    expect(deleted.text).toBe('');

    const missing = await authenticatedRequest(app)
      .get(`/genres/${genre.GenreId}`)
      .expect(404);
    expect(missing.body).toEqual({
      code: 404,
      message: 'Género no encontrado.',
    });
  });

  it('responde 409 y conserva un género que tiene pistas asociadas', async () => {
    const database = app.get(DatabaseService);
    const genreWithTracks = database.get<{ GenreId: number }>(
      'SELECT Genre.GenreId FROM Genre ' +
        'INNER JOIN Track ON Track.GenreId = Genre.GenreId LIMIT 1',
    );

    if (genreWithTracks === undefined) {
      throw new Error('La base temporal debe incluir un género con pistas.');
    }

    const trackIdsBeforeDelete = database
      .all<{ TrackId: number }>(
        'SELECT TrackId FROM Track WHERE GenreId = ? ORDER BY TrackId ASC',
        genreWithTracks.GenreId,
      )
      .map((track) => track.TrackId);

    expect(trackIdsBeforeDelete.length).toBeGreaterThan(0);

    await authenticatedRequest(app)
      .delete(`/genres/${genreWithTracks.GenreId}`)
      .expect(409);

    const trackIdsAfterDelete = database
      .all<{ TrackId: number }>(
        'SELECT TrackId FROM Track WHERE GenreId = ? ORDER BY TrackId ASC',
        genreWithTracks.GenreId,
      )
      .map((track) => track.TrackId);

    expect(trackIdsAfterDelete).toEqual(trackIdsBeforeDelete);

    await authenticatedRequest(app)
      .get(`/genres/${genreWithTracks.GenreId}`)
      .expect(200);
  });

  it('responde 404 para id cero válido pero inexistente', async () => {
    const response = await authenticatedRequest(app)
      .get('/genres/0')
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      message: 'Género no encontrado.',
    });

    await authenticatedRequest(app)
      .patch('/genres/0')
      .send({ Name: 'No debe crearse' })
      .expect(404);

    await authenticatedRequest(app)
      .delete('/genres/0')
      .expect(404);
  });

  it.each(['texto', '1.5', '-1', '1e0', '1.0', '1e3', '0x1', '-0'])(
    'rechaza el id inválido %s con 400 al consultar',
    async (id) => {
      await authenticatedRequest(app).get(`/genres/${id}`).expect(400);
    },
  );

  it('rechaza ids inválidos en PATCH y DELETE antes de modificar la base', async () => {
    await authenticatedRequest(app)
      .patch('/genres/1e0')
      .send({ Name: 'No debe actualizarse' })
      .expect(400);

    await authenticatedRequest(app)
      .delete('/genres/1.0')
      .expect(400);
  });
});
