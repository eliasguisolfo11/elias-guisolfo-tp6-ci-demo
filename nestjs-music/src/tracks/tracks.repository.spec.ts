import { ConfigService } from '@nestjs/config';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../../test/helpers/temp-database.js';
import { DatabaseService } from '../database/database.service.js';
import { TracksRepository } from './tracks.repository.js';

describe('TracksRepository', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: DatabaseService;
  let repository: TracksRepository;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new TracksRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('incluye Album, Genre y MediaType anidados en el listado', () => {
    const tracks = repository.page(0, 3);

    expect(tracks).toHaveLength(3);
    expect(tracks.map(({ TrackId }) => TrackId)).toEqual([1, 2, 3]);

    for (const track of tracks) {
      expect(track.Album).toEqual({
        AlbumId: track.AlbumId,
        Title: expect.any(String),
      });
      expect(track.Genre).toEqual({
        GenreId: track.GenreId,
        Name: expect.any(String),
      });
      expect(track.MediaType).toEqual({
        MediaTypeId: track.MediaTypeId,
        Name: expect.any(String),
      });
      expect(track).not.toHaveProperty('AlbumTitle');
      expect(track).not.toHaveProperty('GenreName');
      expect(track).not.toHaveProperty('MediaTypeName');
    }
  });

  it('incluye las relaciones anidadas en el detalle', () => {
    const track = repository.findById(1);

    expect(track).not.toBeNull();
    if (track === null) {
      throw new Error('Se esperaba encontrar la pista con id 1.');
    }

    expect(track).toMatchObject({
      TrackId: 1,
      Album: {
        AlbumId: track.AlbumId,
        Title: expect.any(String),
      },
      Genre: {
        GenreId: track.GenreId,
        Name: expect.any(String),
      },
      MediaType: {
        MediaTypeId: track.MediaTypeId,
        Name: expect.any(String),
      },
    });
  });

  it('devuelve Album y Genre null, conserva MediaType y normaliza UnitPrice', () => {
    const mediaType = database.get<{ MediaTypeId: number }>(
      'SELECT MediaTypeId FROM MediaType ORDER BY MediaTypeId ASC LIMIT 1',
    );
    if (mediaType === undefined) {
      throw new Error('La base temporal debe incluir un tipo de medio.');
    }

    const inserted = database.run(
      'INSERT INTO Track (Name, MediaTypeId, Milliseconds, UnitPrice) ' +
        'VALUES (?, ?, ?, ?)',
      'T16 pista con relaciones opcionales nulas',
      mediaType.MediaTypeId,
      1000,
      0.1 + 0.2,
    );

    const track = repository.findById(Number(inserted.lastInsertRowid));
    expect(track).not.toBeNull();
    if (track === null) {
      throw new Error('Se esperaba recuperar la pista recién insertada.');
    }

    expect(track.AlbumId).toBeNull();
    expect(track.Album).toBeNull();
    expect(track.GenreId).toBeNull();
    expect(track.Genre).toBeNull();
    expect(track.MediaType).toMatchObject({
      MediaTypeId: mediaType.MediaTypeId,
      Name: expect.any(String),
    });
    expect(track.UnitPrice).toBe(0.3);
  });

  it('respeta orden ascendente, paginación y límite máximo de 100', () => {
    const page = repository.page(2, 3);
    const cappedPage = repository.page(0, 500);

    expect(page.map(({ TrackId }) => TrackId)).toEqual([3, 4, 5]);
    expect(cappedPage).toHaveLength(100);
    expect(cappedPage.map(({ TrackId }) => TrackId)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });

  it('verifica la página custom con el criterio estructural RNF-5', () => {
    const query = vi.spyOn(database, 'all');

    const tracks = repository.page(10, 500);

    expect(tracks).toHaveLength(100);
    expect(tracks.map(({ TrackId }) => TrackId)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 11),
    );
    expect(query).toHaveBeenCalledTimes(1);

    const [sql, ...parameters] = query.mock.calls[0] ?? [];
    expect(sql).toMatch(
      /LEFT JOIN "Album" ON "Album"\."AlbumId" = "Track"\."AlbumId"/,
    );
    expect(sql).toMatch(
      /LEFT JOIN "Genre" ON "Genre"\."GenreId" = "Track"\."GenreId"/,
    );
    expect(sql).toMatch(
      /INNER JOIN "MediaType" ON "MediaType"\."MediaTypeId" = "Track"\."MediaTypeId"/,
    );
    expect(sql).toMatch(
      /ORDER BY "Track"\."TrackId" ASC LIMIT \? OFFSET \?$/,
    );
    expect(sql).not.toMatch(/\bCOUNT\s*\(/i);
    expect(parameters).toEqual([100, 10]);

    if (typeof sql !== 'string') {
      throw new Error('La consulta de paginación debe ser una cadena SQL.');
    }

    const queryPlan = database.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${sql}`,
      ...parameters,
    );
    const planDetails = queryPlan.map(({ detail }) => detail).join(' ');

    expect(planDetails).not.toMatch(/MATERIALIZE|USE TEMP B-TREE/i);
  });

  it('devuelve null cuando la pista no existe', () => {
    expect(repository.findById(99999)).toBeNull();
  });
  it('verifica existencia por tabla de Album, Genre y MediaType', () => {
    database.run(
      'INSERT INTO Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
      50001,
      'T17 álbum para comprobar referencia',
      1,
    );
    database.run(
      'INSERT INTO Genre (GenreId, Name) VALUES (?, ?)',
      50002,
      'T17 género para comprobar referencia',
    );
    database.run(
      'INSERT INTO MediaType (MediaTypeId, Name) VALUES (?, ?)',
      50003,
      'T17 tipo para comprobar referencia',
    );

    expect(repository.albumExists(50001)).toBe(true);
    expect(repository.genreExists(50002)).toBe(true);
    expect(repository.mediaTypeExists(50003)).toBe(true);
    expect(repository.albumExists(59999)).toBe(false);
    expect(repository.genreExists(59999)).toBe(false);
    expect(repository.mediaTypeExists(59999)).toBe(false);
  });
});
