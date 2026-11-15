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
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';
import { AlbumsRepository } from './albums.repository.js';

const expectedSeedHash =
  '9FBE219EE9E67D2EDCCD26271AF9AFDA37EC1C0D7E17F0DF3C02C705FF0DFA1D';

describe('AlbumsRepository.search', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: DatabaseService;
  let searchIndex: SearchIndexService;
  let repository: AlbumsRepository;

  function makeQuery(
    overrides: Partial<SearchAlbumsQueryDto> = {},
  ): SearchAlbumsQueryDto {
    return Object.assign(new SearchAlbumsQueryDto(), overrides);
  }

  function insertAlbum(id: number, title: string, artistId: number): void {
    database.run(
      'INSERT INTO Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
      id,
      title,
      artistId,
    );
  }

  function seedSearchFixtures(): void {
    const artists = [
      [93001, 'Beyoncé T5 Artist %_'],
      [93002, 'Other T5 Artist'],
      [93003, 'Álpha T5 Artist'],
      [93004, 'Alpha T5 Artist'],
      [93005, 'Zeta T5 Artist'],
      [93006, 'T5 Search Artist'],
      [93007, 'T5 ac Related Artist'],
      [93008, 'T5 ArtistSort  A'],
      [93009, 'T5 ArtistSort !'],
      [93010, 'T5 ArtistSort +'],
      [93011, 'T5 Greek exact Artist αβς'],
      [93012, 'T5 Greek false Artist αβσ'],
      [93013, 'T5 long exact Artist aſb'],
      [93014, 'T5 long false Artist asb'],
    ] as const;
    for (const [artistId, name] of artists) {
      database.run(
        'INSERT INTO Artist (ArtistId, Name) VALUES (?, ?)',
        artistId,
        name,
      );
    }

    insertAlbum(93001, 'T5 Cañón_100% Needle', 93001);
    insertAlbum(93002, 'T5 Cañon_200% Needle', 93001);
    insertAlbum(93003, 'T5 Cañón_100% Needle', 93002);
    insertAlbum(93004, 'T5 Cañón_100% Needle', 93001);
    insertAlbum(93101, 'T5 Lit % marker', 93001);
    insertAlbum(93102, 'T5 Lit X marker', 93001);
    insertAlbum(93103, 'T5 Lit _ marker', 93001);
    insertAlbum(93104, 'T5 Quote "Needle" marker', 93001);
    insertAlbum(93105, "T5 SQL ' OR 1=1 -- marker", 93001);
    insertAlbum(93106, 'T5 QZ token', 93001);
    insertAlbum(93200, 'T5 Sort  A', 93001);
    insertAlbum(93201, 'T5 Sort á', 93001);
    insertAlbum(93202, 'T5 Sort A', 93001);
    insertAlbum(93203, 'T5 Sort B', 93001);
    insertAlbum(93204, 'T5 Sort B', 93001);
    insertAlbum(93205, 'T5 Sort !', 93001);
    insertAlbum(93206, 'T5 Sort +', 93001);
    insertAlbum(93301, 'T5 ArtistSort one', 93003);
    insertAlbum(93302, 'T5 ArtistSort two', 93004);
    insertAlbum(93303, 'T5 ArtistSort three', 93005);
    insertAlbum(93304, 'T5 ArtistSort four', 93008);
    insertAlbum(93305, 'T5 ArtistSort five', 93009);
    insertAlbum(93306, 'T5 ArtistSort six', 93010);
    insertAlbum(93401, 'T5 ac title probe', 93006);
    insertAlbum(93402, 'T5 related field probe', 93007);
    insertAlbum(93501, 'T5 Greek title αβς exact', 93002);
    insertAlbum(93502, 'T5 Greek title αβσ false', 93002);
    insertAlbum(93503, 'T5 long title aſb exact', 93002);
    insertAlbum(93504, 'T5 long title asb false', 93002);
    insertAlbum(93505, 'T5 Artist fold Greek exact', 93011);
    insertAlbum(93506, 'T5 Artist fold Greek false', 93012);
    insertAlbum(93507, 'T5 Artist fold long exact', 93013);
    insertAlbum(93508, 'T5 Artist fold long false', 93014);
  }

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );
    searchIndex = new SearchIndexService(database);
    searchIndex.onModuleInit();
    repository = new AlbumsRepository(database);
    seedSearchFixtures();
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('combina título y artista con AND, normaliza texto y devuelve Album público con Artist', () => {
    const firstPage = repository.search(
      makeQuery({ text: '  cAnOn  ', artist: ' BEYONCÉ ', limit: 2 }),
    );

    expect(firstPage).toMatchObject({
      total: 3,
      skip: 0,
      limit: 2,
      hasMore: true,
    });
    expect(firstPage.items.map(({ AlbumId }) => AlbumId)).toEqual([
      93001, 93004,
    ]);
    expect(firstPage.items[0]).toEqual({
      AlbumId: 93001,
      Title: 'T5 Cañón_100% Needle',
      ArtistId: 93001,
      Artist: { ArtistId: 93001, Name: 'Beyoncé T5 Artist %_' },
    });
    expect(firstPage.items[0]).not.toHaveProperty('ArtistName');

    const secondPage = repository.search(
      makeQuery({ text: 'canon', artist: 'beyonce', skip: 2, limit: 2 }),
    );
    expect(secondPage).toMatchObject({
      total: 3,
      skip: 2,
      limit: 2,
      hasMore: false,
    });
    expect(secondPage.items.map(({ AlbumId }) => AlbumId)).toEqual([93002]);
  });

  it('trata porcentaje, guion bajo, comillas y texto SQL-like como literales', () => {
    expect(
      repository
        .search(makeQuery({ text: 'T5 Lit %' }))
        .items.map(({ AlbumId }) => AlbumId),
    ).toEqual([93101]);
    expect(
      repository
        .search(makeQuery({ text: 'T5 Lit _ marker' }))
        .items.map(({ AlbumId }) => AlbumId),
    ).toEqual([93103]);
    expect(
      repository
        .search(makeQuery({ text: 'Quote "Needle"' }))
        .items.map(({ AlbumId }) => AlbumId),
    ).toEqual([93104]);
    expect(
      repository
        .search(makeQuery({ text: "' OR 1=1 --" }))
        .items.map(({ AlbumId }) => AlbumId),
    ).toEqual([93105]);
    expect(
      repository
        .search(makeQuery({ text: 'qz' }))
        .items.map(({ AlbumId }) => AlbumId),
    ).toEqual([93106]);
  });

  it.each([
    {
      label: 'Title final sigma',
      query: makeQuery({ text: 'αβς' }),
      column: 'TitleKey',
      term: 'αβς',
      expectedAlbumId: 93501,
    },
    {
      label: 'Title long s',
      query: makeQuery({ text: 'aſb' }),
      column: 'TitleKey',
      term: 'aſb',
      expectedAlbumId: 93503,
    },
    {
      label: 'ArtistName final sigma',
      query: makeQuery({ artist: 'αβς' }),
      column: 'ArtistNameKey',
      term: 'αβς',
      expectedAlbumId: 93505,
    },
    {
      label: 'ArtistName long s',
      query: makeQuery({ artist: 'aſb' }),
      column: 'ArtistNameKey',
      term: 'aſb',
      expectedAlbumId: 93507,
    },
  ])('confirms $label candidates exactly after FTS matching', (testCase) => {
    const allSpy = vi.spyOn(database, 'all');
    const result = repository.search(testCase.query);

    expect({
      ids: result.items.map(({ AlbumId }) => AlbumId),
      total: result.total,
    }).toEqual({ ids: [testCase.expectedAlbumId], total: 1 });

    const pageCall = allSpy.mock.calls.find(([sql]) => sql.includes('ORDER BY'));
    if (pageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Albums.');
    }
    const [sql, ...parameters] = pageCall;
    expect(sql).toContain('album_search_fts MATCH ?');
    expect(sql).toContain(
      `instr(search_key("Search"."${testCase.column}"), search_key(?)) > 0`,
    );
    expect(parameters).toContain(testCase.term);
    expect(
      searchIndex.explainQueryPlan(sql, ...parameters).join(' '),
    ).toMatch(/album_search_fts.*VIRTUAL TABLE INDEX/i);
  });

  it('elige el fallback según la longitud de la clave normalizada', () => {
    const decomposed = 'a\u0301c';
    const allSpy = vi.spyOn(database, 'all');
    const titleMatch = (text: string) =>
      repository
        .search(makeQuery({ text, artist: 'T5 Search Artist' }))
        .items.map(({ AlbumId }) => AlbumId);
    const relatedArtistMatch = (artist: string) =>
      repository
        .search(makeQuery({ text: 'related field probe', artist }))
        .items.map(({ AlbumId }) => AlbumId);

    expect(titleMatch('ac')).toEqual([93401]);
    expect(titleMatch(decomposed)).toEqual([93401]);
    expect(relatedArtistMatch('ac')).toEqual([93402]);
    expect(relatedArtistMatch(decomposed)).toEqual([93402]);

    allSpy.mockClear();
    repository.search(makeQuery({ text: decomposed }));
    const titleFallback = allSpy.mock.calls.find(([sql]) =>
      sql.includes('ORDER BY'),
    );
    if (titleFallback === undefined) {
      throw new Error('Se esperaba una consulta paginada de Albums.');
    }
    const [titleSql, ...titleParameters] = titleFallback;
    expect(titleSql).toMatch(
      /instr\(search_key\("Search"\."TitleKey"\), search_key\(\?\)\)/,
    );
    expect(titleSql).not.toContain('album_search_fts MATCH');
    expect(titleParameters).toContain(decomposed);
    expect(
      searchIndex.explainQueryPlan(titleSql, ...titleParameters).join(' '),
    ).not.toMatch(/VIRTUAL TABLE INDEX/i);

    allSpy.mockClear();
    repository.search(makeQuery({ artist: decomposed }));
    const artistFallback = allSpy.mock.calls.find(([sql]) =>
      sql.includes('ORDER BY'),
    );
    if (artistFallback === undefined) {
      throw new Error('Se esperaba una consulta paginada de Albums.');
    }
    const [artistSql, ...artistParameters] = artistFallback;
    expect(artistSql).toMatch(
      /instr\(search_key\("Search"\."ArtistNameKey"\), search_key\(\?\)\)/,
    );
    expect(artistSql).not.toContain('album_search_fts MATCH');
    expect(artistParameters).toContain(decomposed);
    expect(
      searchIndex.explainQueryPlan(artistSql, ...artistParameters).join(' '),
    ).not.toMatch(/VIRTUAL TABLE INDEX/i);
  });

  it('devuelve total real con página vacía fuera de rango y con cero coincidencias', () => {
    const beyondEnd = repository.search(
      makeQuery({
        text: 'cAnOn_100%',
        artist: 'beyonce',
        skip: 20,
        limit: 2,
      }),
    );
    expect(beyondEnd).toMatchObject({
      items: [],
      total: 2,
      skip: 20,
      limit: 2,
      hasMore: false,
    });

    expect(
      repository.search(makeQuery({ text: 'not-a-real-album' })),
    ).toMatchObject({
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
      hasMore: false,
    });
  });

  it('busca sin filtros y calcula total y corte de página en SQLite', () => {
    const count = database.get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM Album',
    );
    const result = repository.search(makeQuery({ limit: 1 }));

    expect(count).toBeDefined();
    expect(result.total).toBe(count?.total);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.items[0]?.Artist).toEqual({
      ArtistId: result.items[0]?.ArtistId,
      Name: expect.any(String),
    });
  });

  it('ordena por Title con clave Unicode normalizada e ID ascendente en empates', () => {
    const ascending = repository.search(
      makeQuery({ text: 'T5 Sort', sort: 'Title', order: 'asc' }),
    );
    expect(ascending.items.map(({ AlbumId }) => AlbumId)).toEqual([
      93200, 93205, 93206, 93201, 93202, 93203, 93204,
    ]);

    const descending = repository.search(
      makeQuery({ text: 'T5 Sort', sort: 'Title', order: 'desc' }),
    );
    expect(descending.items.map(({ AlbumId }) => AlbumId)).toEqual([
      93203, 93204, 93201, 93202, 93206, 93205, 93200,
    ]);
  });

  it('ordena por ArtistName normalizado y mantiene ID ascendente al desempatar', () => {
    const ascending = repository.search(
      makeQuery({ text: 'T5 ArtistSort', sort: 'ArtistName', order: 'asc' }),
    );
    expect(ascending.items.map(({ AlbumId }) => AlbumId)).toEqual([
      93301, 93302, 93304, 93305, 93306, 93303,
    ]);

    const descending = repository.search(
      makeQuery({ text: 'T5 ArtistSort', sort: 'ArtistName', order: 'desc' }),
    );
    expect(descending.items.map(({ AlbumId }) => AlbumId)).toEqual([
      93303, 93306, 93305, 93304, 93301, 93302,
    ]);
  });

  it('usa una whitelist de orden y pasa los términos como bindings', () => {
    const allSpy = vi.spyOn(database, 'all');
    repository.search(makeQuery({ text: 'T5 Sort', sort: 'ArtistName' }));
    const artistNamePage = allSpy.mock.calls.at(-1);
    expect(artistNamePage?.[0]).toMatch(
      /ORDER BY "Search"\."ArtistNameKey" COLLATE BINARY ASC, "Search"\."AlbumId" ASC LIMIT \? OFFSET \?$/,
    );

    repository.search(
      makeQuery({ text: 'T5 Sort', sort: 'AlbumId; DROP TABLE Album' }),
    );
    const invalidSortPage = allSpy.mock.calls.at(-1);
    expect(invalidSortPage?.[0]).toMatch(
      /ORDER BY "Search"\."TitleKey" COLLATE BINARY ASC,/,
    );
    expect(invalidSortPage?.[0]).not.toContain('DROP TABLE');

    allSpy.mockClear();
    const term = 'T5 Lit %';
    repository.search(makeQuery({ text: term, artist: 'Beyoncé' }));
    const pageCall = allSpy.mock.calls.find(([sql]) =>
      sql.includes('ORDER BY'),
    );
    if (pageCall === undefined) {
      throw new Error('Se esperaba una consulta paginada de Albums.');
    }
    const [sql, ...parameters] = pageCall;
    expect(sql).toContain('album_search_fts MATCH ?');
    expect(sql).not.toContain(term);
    expect(sql).not.toContain('Beyoncé');
    expect(parameters).toContain(
      'TitleKey : "t5 lit %" AND ArtistNameKey : "beyonce"',
    );
    expect(parameters.slice(-2)).toEqual([100, 0]);

    const ftsPlan = searchIndex.explainQueryPlan(sql, ...parameters).join(' ');
    expect(ftsPlan).toMatch(/album_search_fts.*VIRTUAL TABLE INDEX/i);
  });

  it('usa el fallback parametrizado para términos cortos o frases inseguras', () => {
    const allSpy = vi.spyOn(database, 'all');
    repository.search(makeQuery({ text: 'qz' }));
    const shortPage = allSpy.mock.calls.at(-1);
    if (shortPage === undefined) {
      throw new Error('Se esperaba una consulta paginada de Albums.');
    }
    const [shortSql, ...shortParameters] = shortPage;
    expect(shortSql).toMatch(
      /instr\(search_key\("Search"\."TitleKey"\), search_key\(\?\)\)/,
    );
    expect(shortParameters).toContain('qz');
    expect(shortSql).not.toContain('album_search_fts MATCH');
    expect(
      searchIndex.explainQueryPlan(shortSql, ...shortParameters).join(' '),
    ).not.toMatch(/VIRTUAL TABLE INDEX/i);

    allSpy.mockClear();
    repository.search(makeQuery({ text: 'Quote "Needle"' }));
    const unsafePage = allSpy.mock.calls.at(-1);
    expect(unsafePage?.[0]).toMatch(
      /instr\(search_key\("Search"\."TitleKey"\), search_key\(\?\)\)/,
    );
    expect(unsafePage?.slice(1)).toContain('Quote "Needle"');
  });

  it('conserva el índice B-tree de relación y el hash del seed', () => {
    expect(
      searchIndex
        .explainQueryPlan(
          'SELECT AlbumId FROM temp.album_search WHERE ArtistId = ?',
          93001,
        )
        .join(' '),
    ).toMatch(/album_search_artist_id_idx/i);

    const sourceHash = createHash('sha256')
      .update(readFileSync(resolve(process.cwd(), 'data/chinook.db')))
      .digest('hex')
      .toUpperCase();
    expect(sourceHash).toBe(expectedSeedHash);
  });
});
