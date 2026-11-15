import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../../test/helpers/temp-database.js';
import { DatabaseService } from '../database/database.service.js';
import { SearchIndexService } from '../database/search-index.service.js';
import { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';
import { TracksRepository } from './tracks.repository.js';

interface SearchTrackFixture {
  id: number;
  name: string;
  albumId?: number | null;
  genreId?: number | null;
  price: number;
  milliseconds: number;
}

const expectedSeedHash =
  '9FBE219EE9E67D2EDCCD26271AF9AFDA37EC1C0D7E17F0DF3C02C705FF0DFA1D';

describe('TracksRepository.search', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: DatabaseService;
  let searchIndex: SearchIndexService;
  let repository: TracksRepository;
  let mediaTypeId: number;

  function makeQuery(
    overrides: Partial<SearchTracksQueryDto> = {},
  ): SearchTracksQueryDto {
    return Object.assign(new SearchTracksQueryDto(), overrides);
  }

  function insertTrack(track: SearchTrackFixture): void {
    database.run(
      `INSERT INTO Track (
         TrackId, Name, AlbumId, GenreId, MediaTypeId, Milliseconds,
         UnitPrice
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      track.id,
      track.name,
      track.albumId ?? null,
      track.genreId ?? null,
      mediaTypeId,
      track.milliseconds,
      track.price,
    );
  }

  function seedSearchFixtures(): void {
    database.run(
      'INSERT INTO Artist (ArtistId, Name) VALUES (?, ?)',
      92001,
      'Beyoncé T4 Artist %_',
    );
    database.run(
      'INSERT INTO Artist (ArtistId, Name) VALUES (?, ?)',
      92002,
      'Other T4 Artist',
    );
    database.run(
      'INSERT INTO Genre (GenreId, Name) VALUES (?, ?)',
      92001,
      'Jàzz T4 Genre %_',
    );
    database.run(
      'INSERT INTO Genre (GenreId, Name) VALUES (?, ?)',
      92002,
      'Rock T4 Genre',
    );
    database.run(
      'INSERT INTO Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
      92001,
      'T4 Search Album One',
      92001,
    );
    database.run(
      'INSERT INTO Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
      92002,
      'T4 Search Album Two',
      92002,
    );

    insertTrack({
      id: 92001,
      name: 'T4 Cañón_100% needle',
      albumId: 92001,
      genreId: 92001,
      price: 0.99,
      milliseconds: 1000,
    });
    insertTrack({
      id: 92002,
      name: 'T4 Cañon_200% needle',
      albumId: 92001,
      genreId: 92001,
      price: 1.99,
      milliseconds: 2000,
    });
    insertTrack({
      id: 92003,
      name: 'T4 Cañon_100% needle',
      albumId: 92002,
      genreId: 92001,
      price: 0.99,
      milliseconds: 1000,
    });
    insertTrack({
      id: 92004,
      name: 'T4 Cañon_100% needle',
      albumId: 92001,
      genreId: 92002,
      price: 0.99,
      milliseconds: 1000,
    });
    insertTrack({
      id: 92005,
      name: 'T4 Genreless Search',
      price: 0.49,
      milliseconds: 500,
    });

    insertTrack({
      id: 92101,
      name: 'T4 Lit % marker',
      price: 0.1,
      milliseconds: 100,
    });
    insertTrack({
      id: 92102,
      name: 'T4 Lit X marker',
      price: 0.2,
      milliseconds: 200,
    });
    insertTrack({
      id: 92103,
      name: 'T4 Lit _ marker',
      price: 0.3,
      milliseconds: 300,
    });
    insertTrack({
      id: 92104,
      name: 'T4 Quote "Needle" marker',
      price: 0.4,
      milliseconds: 400,
    });
    insertTrack({
      id: 92105,
      name: "T4 SQL ' OR 1=1 -- marker",
      price: 0.5,
      milliseconds: 500,
    });

    insertTrack({
      id: 92201,
      name: 'T4 Sort á',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92202,
      name: 'T4 Sort A',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92203,
      name: 'T4 Sort B',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92204,
      name: 'T4 Sort B',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92205,
      name: 'T4 Sort A B',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92206,
      name: 'T4 Sort A!B',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92207,
      name: 'T4 Sort A-B',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92208,
      name: 'T4 Sort A_B',
      price: 0.5,
      milliseconds: 50,
    });

    insertTrack({
      id: 92401,
      name: 'T4 NFD a\u0301c mark',
      price: 0.5,
      milliseconds: 50,
    });

    insertTrack({
      id: 92501,
      name: 'T4 Unicode αβς marker',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92502,
      name: 'T4 Unicode αβσ marker',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92503,
      name: 'T4 Unicode aſb marker',
      price: 0.5,
      milliseconds: 50,
    });
    insertTrack({
      id: 92504,
      name: 'T4 Unicode asb marker',
      price: 0.5,
      milliseconds: 50,
    });

    insertTrack({
      id: 92301,
      name: 'T4 Numeric One',
      price: 10,
      milliseconds: 100,
    });
    insertTrack({
      id: 92302,
      name: 'T4 Numeric Two',
      price: 2,
      milliseconds: 2,
    });
    insertTrack({
      id: 92303,
      name: 'T4 Numeric Three',
      price: 2,
      milliseconds: 10,
    });
  }

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );
    searchIndex = new SearchIndexService(database);
    searchIndex.onModuleInit();
    repository = new TracksRepository(database);

    const mediaType = database.get<{ MediaTypeId: number }>(
      'SELECT MediaTypeId FROM MediaType ORDER BY MediaTypeId ASC LIMIT 1',
    );
    if (mediaType === undefined) {
      throw new Error('La base temporal debe incluir un tipo de medio.');
    }
    mediaTypeId = mediaType.MediaTypeId;
    seedSearchFixtures();
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('combina los cinco filtros con AND y conserva total y página', () => {
    const result = repository.search(
      makeQuery({
        text: 'cAnOn',
        genre: 'jazz',
        artist: 'BEYONCE',
        minPrice: 0.99,
        maxPrice: 1.99,
        minDuration: 1000,
        maxDuration: 2000,
        skip: 0,
        limit: 1,
      }),
    );

    expect(result).toMatchObject({
      total: 2,
      skip: 0,
      limit: 1,
      hasMore: true,
    });
    expect(result.items.map(({ TrackId }) => TrackId)).toEqual([92001]);
    expect(result.items[0]).toMatchObject({
      Album: { AlbumId: 92001, Title: 'T4 Search Album One' },
      Genre: { GenreId: 92001, Name: 'Jàzz T4 Genre %_' },
      MediaType: { MediaTypeId: mediaTypeId, Name: expect.any(String) },
    });

    const secondPage = repository.search(
      makeQuery({
        text: 'canon',
        genre: 'jazz',
        artist: 'beyonce',
        minPrice: 0.99,
        maxPrice: 1.99,
        minDuration: 1000,
        maxDuration: 2000,
        skip: 1,
        limit: 1,
      }),
    );
    expect(secondPage).toMatchObject({
      total: 2,
      skip: 1,
      limit: 1,
      hasMore: false,
    });
    expect(secondPage.items.map(({ TrackId }) => TrackId)).toEqual([92002]);
  });

  it('compara acentos descompuestos igual que su clave normalizada corta en SQLite', () => {
    const plain = repository.search(
      makeQuery({ text: 'ac', sort: 'UnitPrice', limit: 100 }),
    );
    const decomposed = repository.search(
      makeQuery({ text: 'a\u0301c', sort: 'UnitPrice', limit: 100 }),
    );

    expect(plain.items.map(({ TrackId }) => TrackId)).toContain(92401);
    expect(decomposed.items.map(({ TrackId }) => TrackId)).toEqual(
      plain.items.map(({ TrackId }) => TrackId),
    );
  });

  it('no confunde sigma final con sigma normal al confirmar candidatos FTS5', () => {
    const finalSigmaIds = repository
      .search(makeQuery({ text: 'αβς' }))
      .items.map(({ TrackId }) => TrackId);
    expect(finalSigmaIds).toContain(92501);
    expect(finalSigmaIds).not.toContain(92502);

    const normalSigmaIds = repository
      .search(makeQuery({ text: 'αβσ' }))
      .items.map(({ TrackId }) => TrackId);
    expect(normalSigmaIds).toContain(92502);
    expect(normalSigmaIds).not.toContain(92501);
  });

  it('no confunde long s con s al confirmar candidatos FTS5', () => {
    const longSIds = repository
      .search(makeQuery({ text: 'aſb' }))
      .items.map(({ TrackId }) => TrackId);
    expect(longSIds).toContain(92503);
    expect(longSIds).not.toContain(92504);

    const normalSIds = repository
      .search(makeQuery({ text: 'asb' }))
      .items.map(({ TrackId }) => TrackId);
    expect(normalSIds).toContain(92504);
    expect(normalSIds).not.toContain(92503);
  });

  it('trata porcentaje, guion bajo, comillas y texto SQL-like como literales', () => {
    expect(
      repository
        .search(makeQuery({ text: 'T4 Lit %' }))
        .items.map(({ TrackId }) => TrackId),
    ).toEqual([92101]);
    expect(
      repository
        .search(makeQuery({ text: 'T4 Lit _ marker' }))
        .items.map(({ TrackId }) => TrackId),
    ).toEqual([92103]);
    expect(
      repository
        .search(makeQuery({ text: 'Quote "Needle"' }))
        .items.map(({ TrackId }) => TrackId),
    ).toEqual([92104]);
    expect(
      repository
        .search(makeQuery({ text: "' OR 1=1 --" }))
        .items.map(({ TrackId }) => TrackId),
    ).toEqual([92105]);
    expect(database.get<{ TrackId: number }>(
      'SELECT TrackId FROM Track WHERE TrackId = ?',
      92101,
    )).toEqual({ TrackId: 92101 });
  });

  it('mantiene Tracks sin Genre si el filtro genre no se envía', () => {
    const unfiltered = repository.search(
      makeQuery({ text: 'genreless' }),
    );
    expect(unfiltered.items.map(({ TrackId }) => TrackId)).toEqual([92005]);
    expect(unfiltered.items[0]?.Genre).toBeNull();

    const filtered = repository.search(
      makeQuery({ text: 'genreless', genre: 'jazz' }),
    );
    expect(filtered).toMatchObject({ total: 0, items: [], hasMore: false });
  });

  it('ordena texto por clave Unicode normalizada y desempata siempre por ID ascendente', () => {
    const ascending = repository.search(
      makeQuery({ text: 'T4 Sort', sort: 'Name', order: 'asc' }),
    );
    expect(ascending.items.map(({ TrackId }) => TrackId)).toEqual([
      92201, 92202, 92205, 92206, 92207, 92208, 92203, 92204,
    ]);

    const descending = repository.search(
      makeQuery({ text: 'T4 Sort', sort: 'Name', order: 'desc' }),
    );
    expect(descending.items.map(({ TrackId }) => TrackId)).toEqual([
      92203, 92204, 92208, 92207, 92206, 92205, 92201, 92202,
    ]);
  });

  it('ordena UnitPrice y Milliseconds por número y mantiene el ID como desempate', () => {
    const prices = repository.search(
      makeQuery({ text: 'T4 Numeric', sort: 'UnitPrice', order: 'asc' }),
    );
    expect(prices.items.map(({ TrackId }) => TrackId)).toEqual([
      92302, 92303, 92301,
    ]);

    const descendingPrices = repository.search(
      makeQuery({ text: 'T4 Numeric', sort: 'UnitPrice', order: 'desc' }),
    );
    expect(descendingPrices.items.map(({ TrackId }) => TrackId)).toEqual([
      92301, 92302, 92303,
    ]);

    const durations = repository.search(
      makeQuery({ text: 'T4 Numeric', sort: 'Milliseconds', order: 'asc' }),
    );
    expect(durations.items.map(({ TrackId }) => TrackId)).toEqual([
      92302, 92303, 92301,
    ]);

    const descendingDurations = repository.search(
      makeQuery({ text: 'T4 Numeric', sort: 'Milliseconds', order: 'desc' }),
    );
    expect(descendingDurations.items.map(({ TrackId }) => TrackId)).toEqual([
      92301, 92303, 92302,
    ]);
  });

  it('aplica en SQLite cada extremo abierto e inclusivo de precio y duración', () => {
    const cases: Array<{
      query: Partial<SearchTracksQueryDto>;
      expectedIds: number[];
    }> = [
      {
        query: { minPrice: 10, sort: 'UnitPrice' },
        expectedIds: [92301],
      },
      {
        query: { maxPrice: 2, sort: 'UnitPrice' },
        expectedIds: [92302, 92303],
      },
      {
        query: { minDuration: 10, sort: 'Milliseconds' },
        expectedIds: [92303, 92301],
      },
      {
        query: { maxDuration: 10, sort: 'Milliseconds' },
        expectedIds: [92302, 92303],
      },
    ];

    for (const { query, expectedIds } of cases) {
      const result = repository.search(makeQuery({ text: 'T4 Numeric', ...query }));
      expect(result.total).toBe(expectedIds.length);
      expect(result.items.map(({ TrackId }) => TrackId)).toEqual(expectedIds);
    }
  });

  it('selecciona en SQL solo las columnas de orden permitidas', () => {
    const allSpy = vi.spyOn(database, 'all');
    const allowedSorts = [
      ['Name', /ORDER BY "Search"\."NameKey" COLLATE BINARY ASC,/],
      ['UnitPrice', /ORDER BY "Search"\."UnitPrice" ASC,/],
      ['Milliseconds', /ORDER BY "Search"\."Milliseconds" ASC,/],
    ] as const;

    for (const [sort, expectedOrder] of allowedSorts) {
      repository.search(makeQuery({ sort, limit: 1 }));
      const pageCall = allSpy.mock.calls.at(-1);
      expect(pageCall?.[0]).toMatch(expectedOrder);
      expect(pageCall?.[0]).toMatch(
        /"Search"\."TrackId" ASC LIMIT \? OFFSET \?$/,
      );
    }
  });

  it('usa conteo, límites y offsets en SQL y conserva el total con skip fuera de rango', () => {
    const allSpy = vi.spyOn(database, 'all');
    const getSpy = vi.spyOn(database, 'get');
    const result = repository.search(
      makeQuery({ text: 'T4 Numeric', skip: 1, limit: 1 }),
    );
    const calls = allSpy.mock.calls;
    const countCall = getSpy.mock.calls.find(([sql]) => sql.includes('COUNT(*)'));
    const pageCall = calls.find(([sql]) => sql.includes('ORDER BY'));

    expect(result).toMatchObject({
      total: 3,
      skip: 1,
      limit: 1,
      hasMore: true,
    });
    expect(result.items.map(({ TrackId }) => TrackId)).toEqual([92303]);
    expect(countCall).toBeDefined();
    expect(pageCall?.[0]).toMatch(/LIMIT \? OFFSET \?$/);
    expect(pageCall?.slice(-2)).toEqual([1, 1]);

    const beyondEnd = repository.search(
      makeQuery({ text: 'T4 Numeric', skip: 10, limit: 2 }),
    );
    expect(beyondEnd).toMatchObject({
      total: 3,
      skip: 10,
      limit: 2,
      hasMore: false,
      items: [],
    });
  });

  it('pasa filtros como bindings y usa FTS5 trigram para términos elegibles', () => {
    const allSpy = vi.spyOn(database, 'all');
    const term = 'cAñOn';
    repository.search(makeQuery({ text: term, minPrice: 0.99 }));

    const pageCall = allSpy.mock.calls.find(([sql]) => sql.includes('ORDER BY'));
    if (pageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Tracks.');
    }
    const [sql, ...parameters] = pageCall;
    expect(sql).toContain('track_search_fts MATCH ?');
    expect(sql).toContain(
      'instr(search_key("Search"."NameKey"), search_key(?)) > 0',
    );
    expect(sql).not.toContain('cAñOn');
    expect(sql).not.toContain('0.99');
    expect(parameters).toContain('NameKey : "canon"');
    expect(parameters).toContain(term);
    expect(parameters).toContain(0.99);
    expect(parameters.slice(-2)).toEqual([100, 0]);

    const plan = searchIndex.explainQueryPlan(sql, ...parameters).join(' ');
    expect(plan).toMatch(/track_search_fts.*VIRTUAL TABLE INDEX/i);
  });

  it('usa el índice B-tree para rangos y el fallback instr parametrizado para texto corto o inseguro', () => {
    const allSpy = vi.spyOn(database, 'all');
    repository.search(makeQuery({ minPrice: 0.99 }));
    const pricePageCall = allSpy.mock.calls.at(-1);
    if (pricePageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Tracks.');
    }
    const [priceSql, ...priceParameters] = pricePageCall;
    const pricePlan = searchIndex
      .explainQueryPlan(priceSql, ...priceParameters)
      .join(' ');
    expect(pricePlan).toMatch(/track_search_unit_price_idx/i);

    allSpy.mockClear();
    repository.search(makeQuery({ text: 'ar' }));
    const shortPageCall = allSpy.mock.calls.at(-1);
    if (shortPageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Tracks.');
    }
    const [shortSql, ...shortParameters] = shortPageCall;
    expect(shortSql).toMatch(
      /instr\(search_key\("Search"\."NameKey"\), search_key\(\?\)\)/,
    );
    expect(shortParameters).toContain('ar');
    expect(shortSql).not.toContain('track_search_fts MATCH');
    const shortPlan = searchIndex
      .explainQueryPlan(shortSql, ...shortParameters)
      .join(' ');
    expect(shortPlan).not.toMatch(/track_search_fts/i);

    allSpy.mockClear();
    repository.search(makeQuery({ text: '"needle"' }));
    const unsafePageCall = allSpy.mock.calls.at(-1);
    if (unsafePageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Tracks.');
    }
    const [unsafeSql, ...unsafeParameters] = unsafePageCall;
    expect(unsafeSql).toMatch(/instr\(search_key\(/);
    expect(unsafeParameters).toContain('"needle"');
    expect(unsafeSql).not.toContain('"needle"');
  });

  it('no modifica el archivo seed durante la búsqueda', () => {
    const seedPath = resolve(process.cwd(), 'data', 'chinook.db');
    const getSeedHash = (): string =>
      createHash('sha256')
        .update(readFileSync(seedPath))
        .digest('hex')
        .toUpperCase();

    expect(getSeedHash()).toBe(expectedSeedHash);
    repository.search(makeQuery({ text: 'T4 Numeric' }));
    expect(getSeedHash()).toBe(expectedSeedHash);
  });
});
