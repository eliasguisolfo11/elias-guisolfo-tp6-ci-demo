import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { authenticatedRequest, viewerRequest } from './helpers/auth-test-context.js';
import { AppModule } from '../src/app.module.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';

interface AlbumResponse {
  AlbumId: number;
  Title: string;
  ArtistId: number;
  Artist: {
    ArtistId: number;
    Name: string;
  };
}

describe('AlbumsController (e2e)', () => {
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

  it('permite las consultas de viewer y rechaza sus escrituras sin mutar álbumes', async () => {
    const database = app.get(DatabaseService);
    const artist = database.get<{ ArtistId: number }>(
      'SELECT ArtistId FROM Artist ORDER BY ArtistId ASC LIMIT 1',
    );
    if (!artist) {
      throw new Error('Debe existir un artista para probar los permisos de álbum.');
    }

    const created = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'TP2 T5 álbum de permisos', ArtistId: artist.ArtistId })
      .expect(201);
    const album = created.body as AlbumResponse;
    const countBeforeDeniedPost = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Album',
    )?.count;

    await viewerRequest(app).get('/albums').expect(200);
    const before = await viewerRequest(app)
      .get(`/albums/${album.AlbumId}`)
      .expect(200);
    await viewerRequest(app)
      .post('/albums')
      .send({ Title: 'TP2 T5 álbum no autorizado', ArtistId: artist.ArtistId })
      .expect(403);
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM Album',
      )?.count,
    ).toBe(countBeforeDeniedPost);

    await viewerRequest(app)
      .patch(`/albums/${album.AlbumId}`)
      .send({ Title: 'Cambio no autorizado' })
      .expect(403);
    const afterPatch = await viewerRequest(app)
      .get(`/albums/${album.AlbumId}`)
      .expect(200);
    expect(afterPatch.body).toEqual(before.body);

    await viewerRequest(app)
      .delete(`/albums/${album.AlbumId}`)
      .expect(403);
    const afterDelete = await viewerRequest(app)
      .get(`/albums/${album.AlbumId}`)
      .expect(200);
    expect(afterDelete.body).toEqual(before.body);
  });

  it('lista álbumes e incluye Artist anidado', async () => {
    const response = await authenticatedRequest(app)
      .get('/albums')
      .expect(200);
    const albums = response.body as AlbumResponse[];

    expect(albums.length).toBeGreaterThan(0);
    expect(albums[0]).toMatchObject({
      AlbumId: expect.any(Number),
      Title: expect.any(String),
      ArtistId: expect.any(Number),
      Artist: {
        ArtistId: expect.any(Number),
        Name: expect.any(String),
      },
    });
    expect(albums[0]?.Artist.ArtistId).toBe(albums[0]?.ArtistId);
    expect(albums[0]).not.toHaveProperty('ArtistName');
  });

  it('devuelve el detalle del álbum con Artist anidado', async () => {
    const response = await authenticatedRequest(app)
      .get('/albums/1')
      .expect(200);
    const album = response.body as AlbumResponse;

    expect(album).toMatchObject({
      AlbumId: 1,
      Title: expect.any(String),
      ArtistId: expect.any(Number),
      Artist: {
        ArtistId: expect.any(Number),
        Name: expect.any(String),
      },
    });
    expect(album.Artist.ArtistId).toBe(album.ArtistId);
    expect(album).not.toHaveProperty('ArtistName');
  });

  it('responde 404 para id cero, válido pero inexistente', async () => {
    const response = await authenticatedRequest(app)
      .get('/albums/0')
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      message: 'Álbum no encontrado.',
    });
  });

  it.each(['texto', '1.5', '-1', '1e0', '1.0', '1e3', '0x1', '-0'])(
    'rechaza el id inválido %s con 400',
    async (id) => {
      await authenticatedRequest(app).get(`/albums/${id}`).expect(400);
    },
  );

  it('crea un álbum con Artist existente y devuelve 201', async () => {
    const artist = app
      .get(DatabaseService)
      .get<{ ArtistId: number }>(
        'SELECT ArtistId FROM Artist ORDER BY ArtistId ASC LIMIT 1',
      );
    expect(artist).toBeDefined();

    const response = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'Codex T13 E2E Album Create', ArtistId: artist?.ArtistId })
      .expect(201);
    const album = response.body as AlbumResponse;

    expect(album).toMatchObject({
      AlbumId: expect.any(Number),
      Title: 'Codex T13 E2E Album Create',
      ArtistId: artist?.ArtistId,
      Artist: {
        ArtistId: artist?.ArtistId,
        Name: expect.any(String),
      },
    });

    const persisted = await authenticatedRequest(app)
      .get(`/albums/${album.AlbumId}`)
      .expect(200);
    expect(persisted.body).toEqual(album);
  });

  it('actualiza un álbum y devuelve la representación completa con Artist anidado', async () => {
    const artist = app
      .get(DatabaseService)
      .get<{ ArtistId: number; Name: string }>(
        'SELECT ArtistId, Name FROM Artist ORDER BY ArtistId ASC LIMIT 1',
      );
    if (!artist) {
      throw new Error('Debe existir un artista para probar el PATCH de álbum.');
    }

    const created = await authenticatedRequest(app)
      .post('/albums')
      .send({
        Title: 'Codex T13 E2E Album Patch Original',
        ArtistId: artist.ArtistId,
      })
      .expect(201);
    const album = created.body as AlbumResponse;

    const updated = await authenticatedRequest(app)
      .patch(`/albums/${album.AlbumId}`)
      .send({ Title: 'Codex T13 E2E Album Patch Updated' })
      .expect(200);

    expect(updated.body).toEqual({
      AlbumId: album.AlbumId,
      Title: 'Codex T13 E2E Album Patch Updated',
      ArtistId: artist.ArtistId,
      Artist: {
        ArtistId: artist.ArtistId,
        Name: artist.Name,
      },
    });
  });

  it('rechaza ArtistId inexistente y no persiste el álbum', async () => {
    const database = app.get(DatabaseService);
    const countBefore = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Album',
    );

    const response = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'Codex T13 Invalid ArtistId', ArtistId: 0 })
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El artista indicado no existe.',
    });
    const countAfter = database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM Album',
    );
    expect(countAfter?.count).toBe(countBefore?.count);
  });

  it('responde 404 al actualizar o eliminar un álbum inexistente', async () => {
    await authenticatedRequest(app)
      .patch('/albums/0')
      .send({ Title: 'No debe actualizarse' })
      .expect(404);

    await authenticatedRequest(app)
      .delete('/albums/0')
      .expect(404);
  });

  it('responde 409 y conserva un álbum que tiene pistas asociadas', async () => {
    const database = app.get(DatabaseService);
    const albumWithTracks = database.get<{ AlbumId: number }>(
      'SELECT Album.AlbumId FROM Album ' +
        'INNER JOIN Track ON Track.AlbumId = Album.AlbumId ' +
        'ORDER BY Album.AlbumId ASC LIMIT 1',
    );
    expect(albumWithTracks).toBeDefined();
    const trackIdsBefore = database.all<{ TrackId: number }>(
      'SELECT TrackId FROM Track WHERE AlbumId = ? ORDER BY TrackId ASC',
      albumWithTracks?.AlbumId,
    );
    expect(trackIdsBefore.length).toBeGreaterThan(0);

    await authenticatedRequest(app)
      .delete(`/albums/${albumWithTracks?.AlbumId}`)
      .expect(409);

    const trackIdsAfter = database.all<{ TrackId: number }>(
      'SELECT TrackId FROM Track WHERE AlbumId = ? ORDER BY TrackId ASC',
      albumWithTracks?.AlbumId,
    );
    expect(trackIdsAfter).toEqual(trackIdsBefore);

    const albumAfter = await authenticatedRequest(app)
      .get(`/albums/${albumWithTracks?.AlbumId}`)
      .expect(200);
    expect((albumAfter.body as AlbumResponse).AlbumId).toBe(
      albumWithTracks?.AlbumId,
    );
  });

  it('elimina con 204 sin cuerpo y el detalle posterior devuelve 404', async () => {
    const artist = app
      .get(DatabaseService)
      .get<{ ArtistId: number }>(
        'SELECT ArtistId FROM Artist ORDER BY ArtistId ASC LIMIT 1',
      );
    expect(artist).toBeDefined();

    const created = await authenticatedRequest(app)
      .post('/albums')
      .send({ Title: 'Codex T13 E2E Album Delete', ArtistId: artist?.ArtistId })
      .expect(201);
    const album = created.body as AlbumResponse;

    const deleted = await authenticatedRequest(app)
      .delete(`/albums/${album.AlbumId}`)
      .expect(204);

    expect(deleted.text).toBe('');
    const detail = await authenticatedRequest(app)
      .get(`/albums/${album.AlbumId}`)
      .expect(404);
    expect(detail.body).toEqual({
      code: 404,
      message: 'Álbum no encontrado.',
    });
  });
});
