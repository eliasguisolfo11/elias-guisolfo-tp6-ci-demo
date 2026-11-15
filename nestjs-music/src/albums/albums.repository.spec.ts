import { ConfigService } from '@nestjs/config';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../../test/helpers/temp-database.js';
import { DatabaseService } from '../database/database.service.js';
import { AlbumsRepository } from './albums.repository.js';

describe('AlbumsRepository', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: DatabaseService;
  let repository: AlbumsRepository;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new AlbumsRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('incluye el artista anidado en el listado sin duplicarlo como ArtistName', () => {
    const albums = repository.page(0, 3);

    expect(albums).toHaveLength(3);
    for (const album of albums) {
      expect(album.Artist).toEqual({
        ArtistId: album.ArtistId,
        Name: expect.any(String),
      });
      expect(album).not.toHaveProperty('ArtistName');
    }
  });

  it('acota la página custom a 100 filas y verifica el plan estructural RNF-5', () => {
    const query = vi.spyOn(database, 'all');

    const albums = repository.page(10, 500);

    expect(albums).toHaveLength(100);
    expect(albums.map(({ AlbumId }) => AlbumId)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 11),
    );
    expect(query).toHaveBeenCalledTimes(1);

    const [sql, ...parameters] = query.mock.calls[0] ?? [];
    expect(sql).toMatch(
      /FROM "Album" INNER JOIN "Artist" ON "Artist"\."ArtistId" = "Album"\."ArtistId" ORDER BY "Album"\."AlbumId" ASC LIMIT \? OFFSET \?/,
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

    expect(planDetails).not.toMatch(/COUNT\s*\(|MATERIALIZE|USE TEMP B-TREE/i);
  });

  it('incluye el artista anidado en el detalle', () => {
    const album = repository.findById(1);

    expect(album).not.toBeNull();
    if (album === null) {
      throw new Error('Se esperaba encontrar el álbum con id 1.');
    }

    expect(album.Artist).toEqual({
      ArtistId: album.ArtistId,
      Name: expect.any(String),
    });
    expect(album).not.toHaveProperty('ArtistName');
  });

  it('devuelve null cuando el álbum no existe', () => {
    expect(repository.findById(9999)).toBeNull();
  });
});
