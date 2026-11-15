import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../../test/helpers/temp-database.js';
import { DatabaseService } from './database.service.js';

interface QueryPlanDiagnostics {
  explainQueryPlan(sql: string, ...parameters: unknown[]): string[];
}

function readSourceTrackProjection(
  database: DatabaseService,
  trackId: number,
): Record<string, unknown> | undefined {
  return database.get<Record<string, unknown>>(
    `SELECT track.TrackId, track.AlbumId, album.ArtistId, track.GenreId,
            search_key(track.Name) AS NameKey,
            search_key(artist.Name) AS ArtistNameKey,
            search_key(genre.Name) AS GenreNameKey,
            track.UnitPrice, track.Milliseconds
     FROM main.Track AS track
     LEFT JOIN main.Album AS album ON album.AlbumId = track.AlbumId
     LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
     LEFT JOIN main.Genre AS genre ON genre.GenreId = track.GenreId
     WHERE track.TrackId = ?`,
    trackId,
  );
}

function readSourceAlbumProjection(
  database: DatabaseService,
  albumId: number,
): Record<string, unknown> | undefined {
  return database.get<Record<string, unknown>>(
    `SELECT album.AlbumId, search_key(album.Title) AS TitleKey,
            album.ArtistId, search_key(artist.Name) AS ArtistNameKey
     FROM main.Album AS album
     LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
     WHERE album.AlbumId = ?`,
    albumId,
  );
}

function readTrackFullTextProjection(
  database: DatabaseService,
  trackId: number,
): Record<string, unknown> | undefined {
  return database.get<Record<string, unknown>>(
    `SELECT rowid AS TrackId, NameKey, ArtistNameKey, GenreNameKey
     FROM temp.track_search_fts WHERE rowid = ?`,
    trackId,
  );
}

function readAlbumFullTextProjection(
  database: DatabaseService,
  albumId: number,
): Record<string, unknown> | undefined {
  return database.get<Record<string, unknown>>(
    `SELECT rowid AS AlbumId, TitleKey, ArtistNameKey
     FROM temp.album_search_fts WHERE rowid = ?`,
    albumId,
  );
}

function readSourceTableSnapshot(
  sourceDatabasePath: string,
): Array<{ name: string; rows: unknown[] }> {
  const connection = new Database(sourceDatabasePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const tables = connection
      .prepare<[], { name: string }>(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();

    return tables.map(({ name }) => {
      const escapedTableName = name.replaceAll('"', '""');
      const rows = connection
        .prepare<[], Record<string, unknown>>(
          `SELECT * FROM main."${escapedTableName}" ORDER BY rowid`,
        )
        .all();

      return { name, rows };
    });
  } finally {
    connection.close();
  }
}

function readSourceHash(sourceDatabasePath: string): string {
  return createHash('sha256')
    .update(readFileSync(sourceDatabasePath))
    .digest('hex')
    .toUpperCase();
}

describe('SearchIndexService', () => {
  it('confirma que better-sqlite3 dispone de FTS5 con tokenizer trigram', () => {
    const database = new Database(':memory:');

    try {
      database.exec(
        "CREATE VIRTUAL TABLE fts5_trigram_probe USING fts5(value, tokenize='trigram')",
      );
      database
        .prepare('INSERT INTO fts5_trigram_probe(value) VALUES (?)')
        .run('Eleanor Rigby');

      const results = database
        .prepare(
          'SELECT rowid FROM fts5_trigram_probe WHERE fts5_trigram_probe MATCH ?',
        )
        .all('"Rig"');

      expect(results).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  describe('initialization', () => {
    const sourceDatabasePath = resolve(process.cwd(), 'data/chinook.db');
    let temporaryDatabase: TemporaryDatabase;
    let database: DatabaseService;
    let indexService: QueryPlanDiagnostics;
    let sourceHashBefore: string;
    let sourceTablesBefore: Array<{ name: string; rows: unknown[] }>;
    let mainSchemaBefore: Array<{
      name: string;
      sql: string | null;
      tbl_name: string;
      type: string;
    }>;

    beforeEach(async () => {
      sourceHashBefore = readSourceHash(sourceDatabasePath);
      sourceTablesBefore = readSourceTableSnapshot(sourceDatabasePath);
      temporaryDatabase = createTemporaryDatabase(sourceDatabasePath);
      database = new DatabaseService(
        new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
      );
      mainSchemaBefore = database.all<{
        name: string;
        sql: string | null;
        tbl_name: string;
        type: string;
      }>(
        "SELECT type, name, tbl_name, sql FROM main.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      );

      const { SearchIndexService } = await import(
        './search-index.service.js'
      );
      const service = new SearchIndexService(database);
      service.onModuleInit();
      indexService = service;
    });

    afterEach(() => {
      database.onModuleDestroy();
      temporaryDatabase.cleanup();
    });

    it('registra search_key determinista con normalización NFD, diacríticos y minúsculas', () => {
      expect(
        database.get<{ normalized: string }>(
          'SELECT search_key(?) AS normalized',
          '  Crème Brûlée ÉLECTRO  ',
        ),
      ).toEqual({ normalized: '  creme brulee electro  ' });

      database.run(
        'CREATE TEMP TABLE search_key_deterministic_probe (Value TEXT NOT NULL)',
      );
      expect(() =>
        database.run(
          'CREATE INDEX temp.search_key_deterministic_probe_idx ON search_key_deterministic_probe (search_key(Value))',
        ),
      ).not.toThrow();
    });

    it('proyecta Tracks y Albums y mantiene FTS5 e índices dentro de temp', () => {
      const expectedTrackCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM main.Track',
      )?.count;
      const projectedTrackCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM temp.track_search',
      )?.count;
      const expectedAlbumCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM main.Album',
      )?.count;
      const projectedAlbumCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM temp.album_search',
      )?.count;
      const indexedTrackCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM temp.track_search_fts',
      )?.count;
      const indexedAlbumCount = database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM temp.album_search_fts',
      )?.count;

      expect(projectedTrackCount).toBe(expectedTrackCount);
      expect(projectedAlbumCount).toBe(expectedAlbumCount);
      expect(indexedTrackCount).toBe(expectedTrackCount);
      expect(indexedAlbumCount).toBe(expectedAlbumCount);

      const expectedTrack = database.get<Record<string, unknown>>(
        `SELECT track.TrackId, track.AlbumId, album.ArtistId, track.GenreId,
                search_key(track.Name) AS NameKey,
                search_key(artist.Name) AS ArtistNameKey,
                search_key(genre.Name) AS GenreNameKey,
                track.UnitPrice, track.Milliseconds
         FROM main.Track AS track
         LEFT JOIN main.Album AS album ON album.AlbumId = track.AlbumId
         LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
         LEFT JOIN main.Genre AS genre ON genre.GenreId = track.GenreId
         WHERE track.TrackId = 1`,
      );
      const projectedTrack = database.get<Record<string, unknown>>(
        'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = 1',
      );
      expect(projectedTrack).toEqual(expectedTrack);

      const expectedAlbum = database.get<Record<string, unknown>>(
        `SELECT album.AlbumId, search_key(album.Title) AS TitleKey,
                album.ArtistId, search_key(artist.Name) AS ArtistNameKey
         FROM main.Album AS album
         LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
         WHERE album.AlbumId = 1`,
      );
      const projectedAlbum = database.get<Record<string, unknown>>(
        'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = 1',
      );
      expect(projectedAlbum).toEqual(expectedAlbum);

      const ftsTables = database.all<{ name: string; sql: string | null }>(
        "SELECT name, sql FROM temp.sqlite_master WHERE type = 'table' AND name IN ('track_search_fts', 'album_search_fts') ORDER BY name",
      );
      expect(ftsTables).toHaveLength(2);
      expect(ftsTables.every(({ sql }) => /tokenize\s*=\s*'trigram'/i.test(sql ?? ''))).toBe(
        true,
      );

      const tempIndexes = database.all<{ name: string }>(
        "SELECT name FROM temp.sqlite_master WHERE type = 'index' ORDER BY name",
      );
      expect(tempIndexes.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'track_search_unit_price_idx',
          'track_search_milliseconds_idx',
          'track_search_album_id_idx',
          'track_search_artist_id_idx',
          'track_search_genre_id_idx',
          'album_search_artist_id_idx',
        ]),
      );

      const tempTriggers = database.all<{
        name: string;
        tbl_name: string;
      }>(
        "SELECT name, tbl_name FROM temp.sqlite_master WHERE type = 'trigger' ORDER BY name",
      );
      expect(tempTriggers).toHaveLength(12);
      expect(tempTriggers.map(({ tbl_name }) => tbl_name)).toEqual(
        expect.arrayContaining(['Track', 'Album', 'Artist', 'Genre']),
      );

      const otherConnection = new Database(temporaryDatabase.path, {
        fileMustExist: true,
      });
      try {
        expect(
          otherConnection
            .prepare<[], { name: string }>(
              "SELECT name FROM temp.sqlite_master WHERE type = 'trigger'",
            )
            .all(),
        ).toEqual([]);
      } finally {
        otherConnection.close();
      }

      expect(
        database.all<{ name: string }>(
          "SELECT name FROM main.sqlite_master WHERE name LIKE '%search%'",
        ),
      ).toEqual([]);
      expect(
        database.all<{ name: string }>(
          "SELECT name FROM main.sqlite_master WHERE type = 'trigger' AND name LIKE '%search%'",
        ),
      ).toEqual([]);
    });

    it('sincroniza inserciones, actualizaciones y eliminaciones de Track con FTS', () => {
      const trackId = 990001;
      expect(
        database.get('SELECT TrackId FROM temp.track_search WHERE TrackId = ?', trackId),
      ).toBeUndefined();
      expect(readTrackFullTextProjection(database, trackId)).toBeUndefined();
      expect(readSourceTableSnapshot(sourceDatabasePath)).toEqual(
        sourceTablesBefore,
      );
      expect(readSourceHash(sourceDatabasePath)).toBe(sourceHashBefore);
      database.run(
        `INSERT INTO main.Track (
           TrackId, Name, AlbumId, MediaTypeId, GenreId, Milliseconds, UnitPrice
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        'Initial Crème Track',
        1,
        1,
        1,
        120000,
        0.99,
      );

      const insertedTrack = readSourceTrackProjection(database, trackId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(insertedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual({
        TrackId: trackId,
        NameKey: insertedTrack?.NameKey,
        ArtistNameKey: insertedTrack?.ArtistNameKey,
        GenreNameKey: insertedTrack?.GenreNameKey,
      });

      database.run(
        `UPDATE main.Track
         SET Name = ?, AlbumId = ?, GenreId = NULL, Milliseconds = ?, UnitPrice = ?
         WHERE TrackId = ?`,
        'Updated Café Track',
        2,
        121000,
        1.49,
        trackId,
      );

      const updatedTrack = readSourceTrackProjection(database, trackId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(updatedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual({
        TrackId: trackId,
        NameKey: updatedTrack?.NameKey,
        ArtistNameKey: updatedTrack?.ArtistNameKey,
        GenreNameKey: updatedTrack?.GenreNameKey,
      });

      database.run('DELETE FROM main.Track WHERE TrackId = ?', trackId);
      expect(
        database.get('SELECT TrackId FROM temp.track_search WHERE TrackId = ?', trackId),
      ).toBeUndefined();
      expect(readTrackFullTextProjection(database, trackId)).toBeUndefined();
    });

    it('sincroniza inserciones, actualizaciones y eliminaciones de Album y sus Tracks', () => {
      const firstArtistId = 990010;
      const secondArtistId = 990011;
      const albumId = 990012;
      const trackId = 990013;
      database.run(
        'INSERT INTO main.Artist (ArtistId, Name) VALUES (?, ?)',
        firstArtistId,
        'Initial Album Artist',
      );
      database.run(
        'INSERT INTO main.Artist (ArtistId, Name) VALUES (?, ?)',
        secondArtistId,
        'Updated Album Artist',
      );
      database.run(
        'INSERT INTO main.Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
        albumId,
        'Initial Album Title',
        firstArtistId,
      );

      const insertedAlbum = readSourceAlbumProjection(database, albumId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = ?',
          albumId,
        ),
      ).toEqual(insertedAlbum);
      expect(readAlbumFullTextProjection(database, albumId)).toEqual({
        AlbumId: albumId,
        TitleKey: insertedAlbum?.TitleKey,
        ArtistNameKey: insertedAlbum?.ArtistNameKey,
      });

      database.run(
        `INSERT INTO main.Track (
           TrackId, Name, AlbumId, MediaTypeId, GenreId, Milliseconds, UnitPrice
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        'Track From Test Album',
        albumId,
        1,
        1,
        100000,
        0.79,
      );
      database.run(
        'UPDATE main.Album SET Title = ?, ArtistId = ? WHERE AlbumId = ?',
        'Updated Album Title',
        secondArtistId,
        albumId,
      );

      const updatedAlbum = readSourceAlbumProjection(database, albumId);
      const updatedTrack = readSourceTrackProjection(database, trackId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = ?',
          albumId,
        ),
      ).toEqual(updatedAlbum);
      expect(readAlbumFullTextProjection(database, albumId)).toEqual({
        AlbumId: albumId,
        TitleKey: updatedAlbum?.TitleKey,
        ArtistNameKey: updatedAlbum?.ArtistNameKey,
      });
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(updatedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual({
        TrackId: trackId,
        NameKey: updatedTrack?.NameKey,
        ArtistNameKey: updatedTrack?.ArtistNameKey,
        GenreNameKey: updatedTrack?.GenreNameKey,
      });

      database.run('DELETE FROM main.Track WHERE TrackId = ?', trackId);
      database.run('DELETE FROM main.Album WHERE AlbumId = ?', albumId);
      expect(
        database.get('SELECT AlbumId FROM temp.album_search WHERE AlbumId = ?', albumId),
      ).toBeUndefined();
      expect(readAlbumFullTextProjection(database, albumId)).toBeUndefined();
      database.run('DELETE FROM main.Artist WHERE ArtistId IN (?, ?)', firstArtistId, secondArtistId);
    });

    it('actualiza las claves de Album y Track cuando cambia el nombre de Artist', () => {
      const artistId = 990020;
      const albumId = 990021;
      const trackId = 990022;
      database.run(
        'INSERT INTO main.Artist (ArtistId, Name) VALUES (?, ?)',
        artistId,
        'Initial Artist Name',
      );
      database.run(
        'INSERT INTO main.Album (AlbumId, Title, ArtistId) VALUES (?, ?, ?)',
        albumId,
        'Artist Name Test Album',
        artistId,
      );
      database.run(
        `INSERT INTO main.Track (
           TrackId, Name, AlbumId, MediaTypeId, GenreId, Milliseconds, UnitPrice
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        'Artist Name Test Track',
        albumId,
        1,
        1,
        100000,
        0.79,
      );

      database.run(
        'UPDATE main.Artist SET Name = ? WHERE ArtistId = ?',
        'Björk Artist Name',
        artistId,
      );

      const expectedAlbum = readSourceAlbumProjection(database, albumId);
      const expectedTrack = readSourceTrackProjection(database, trackId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = ?',
          albumId,
        ),
      ).toEqual(expectedAlbum);
      expect(readAlbumFullTextProjection(database, albumId)).toEqual({
        AlbumId: albumId,
        TitleKey: expectedAlbum?.TitleKey,
        ArtistNameKey: expectedAlbum?.ArtistNameKey,
      });
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(expectedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual({
        TrackId: trackId,
        NameKey: expectedTrack?.NameKey,
        ArtistNameKey: expectedTrack?.ArtistNameKey,
        GenreNameKey: expectedTrack?.GenreNameKey,
      });
    });

    it('actualiza la clave de Track cuando cambia el nombre de Genre', () => {
      const genreId = 990030;
      const trackId = 990031;
      database.run(
        'INSERT INTO main.Genre (GenreId, Name) VALUES (?, ?)',
        genreId,
        'Initial Genre Name',
      );
      database.run(
        `INSERT INTO main.Track (
           TrackId, Name, AlbumId, MediaTypeId, GenreId, Milliseconds, UnitPrice
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        trackId,
        'Genre Name Test Track',
        1,
        1,
        genreId,
        100000,
        0.79,
      );

      database.run(
        'UPDATE main.Genre SET Name = ? WHERE GenreId = ?',
        'Électronic New Genre',
        genreId,
      );

      const expectedTrack = readSourceTrackProjection(database, trackId);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(expectedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual({
        TrackId: trackId,
        NameKey: expectedTrack?.NameKey,
        ArtistNameKey: expectedTrack?.ArtistNameKey,
        GenreNameKey: expectedTrack?.GenreNameKey,
      });
    });

    it('revierte juntas las tablas fuente, proyección y FTS al hacer rollback', () => {
      const trackId = 1;
      const originalSourceTrack = readSourceTrackProjection(database, trackId);
      const originalProjectedTrack = database.get<Record<string, unknown>>(
        'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
        trackId,
      );
      const originalFullTextTrack = readTrackFullTextProjection(database, trackId);
      const originalSourceAlbum = database.get<{ AlbumId: number }>(
        'SELECT AlbumId FROM main.Track WHERE TrackId = ?',
        trackId,
      );
      const originalSourceArtist = database.get<{
        ArtistId: number;
        Name: string;
      }>(
        `SELECT artist.ArtistId, artist.Name
         FROM main.Track AS track
         JOIN main.Album AS album ON album.AlbumId = track.AlbumId
         JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
         WHERE track.TrackId = ?`,
        trackId,
      );
      const originalProjectedAlbum = originalSourceAlbum
        ? database.get<Record<string, unknown>>(
            'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = ?',
            originalSourceAlbum.AlbumId,
          )
        : undefined;
      const originalFullTextAlbum = originalSourceAlbum
        ? readAlbumFullTextProjection(database, originalSourceAlbum.AlbumId)
        : undefined;

      let projectedDuringTransaction: Record<string, unknown> | undefined;
      let fullTextDuringTransaction: Record<string, unknown> | undefined;
      expect(() =>
        database.transaction(() => {
          database.run(
            'UPDATE main.Track SET Name = ? WHERE TrackId = ?',
            'Temporary Rollback Track',
            trackId,
          );
          database.run(
            `UPDATE main.Artist SET Name = ?
             WHERE ArtistId = (
               SELECT album.ArtistId FROM main.Track AS track
               JOIN main.Album AS album ON album.AlbumId = track.AlbumId
               WHERE track.TrackId = ?
             )`,
            'Temporary Rollback Artist',
            trackId,
          );
          projectedDuringTransaction = database.get<Record<string, unknown>>(
            'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
            trackId,
          );
          fullTextDuringTransaction = readTrackFullTextProjection(
            database,
            trackId,
          );
          throw new Error('intentional rollback');
        }),
      ).toThrow('intentional rollback');

      expect(projectedDuringTransaction).toMatchObject({
        NameKey: 'temporary rollback track',
        ArtistNameKey: 'temporary rollback artist',
      });
      expect(fullTextDuringTransaction).toMatchObject({
        NameKey: 'temporary rollback track',
        ArtistNameKey: 'temporary rollback artist',
      });
      expect(readSourceTrackProjection(database, trackId)).toEqual(
        originalSourceTrack,
      );
      expect(
        database.get<{ ArtistId: number; Name: string }>(
          `SELECT artist.ArtistId, artist.Name
           FROM main.Track AS track
           JOIN main.Album AS album ON album.AlbumId = track.AlbumId
           JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
           WHERE track.TrackId = ?`,
          trackId,
        ),
      ).toEqual(originalSourceArtist);
      expect(
        database.get<Record<string, unknown>>(
          'SELECT TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey, GenreNameKey, UnitPrice, Milliseconds FROM temp.track_search WHERE TrackId = ?',
          trackId,
        ),
      ).toEqual(originalProjectedTrack);
      expect(readTrackFullTextProjection(database, trackId)).toEqual(
        originalFullTextTrack,
      );
      expect(
        originalSourceAlbum
          ? database.get<Record<string, unknown>>(
              'SELECT AlbumId, TitleKey, ArtistId, ArtistNameKey FROM temp.album_search WHERE AlbumId = ?',
              originalSourceAlbum.AlbumId,
            )
          : undefined,
      ).toEqual(originalProjectedAlbum);
      expect(
        originalSourceAlbum
          ? readAlbumFullTextProjection(database, originalSourceAlbum.AlbumId)
          : undefined,
      ).toEqual(originalFullTextAlbum);
    });

    it('expone planes con FTS trigram y B-tree para rangos y relaciones', () => {
      const ftsPlan = indexService.explainQueryPlan(
        'SELECT rowid FROM temp.track_search_fts WHERE track_search_fts MATCH ?',
        '"rock"',
      );
      expect(ftsPlan.join(' ')).toMatch(/VIRTUAL TABLE INDEX/i);

      const indexedQueries = [
        {
          indexName: 'track_search_unit_price_idx',
          parameter: 100,
          sql: 'SELECT TrackId FROM temp.track_search WHERE UnitPrice > ?',
        },
        {
          indexName: 'track_search_milliseconds_idx',
          parameter: 1000000,
          sql: 'SELECT TrackId FROM temp.track_search WHERE Milliseconds > ?',
        },
        {
          indexName: 'track_search_album_id_idx',
          parameter: 1,
          sql: 'SELECT TrackId FROM temp.track_search WHERE AlbumId = ?',
        },
        {
          indexName: 'track_search_artist_id_idx',
          parameter: 1,
          sql: 'SELECT TrackId FROM temp.track_search WHERE ArtistId = ?',
        },
        {
          indexName: 'track_search_genre_id_idx',
          parameter: 1,
          sql: 'SELECT TrackId FROM temp.track_search WHERE GenreId = ?',
        },
        {
          indexName: 'album_search_artist_id_idx',
          parameter: 1,
          sql: 'SELECT AlbumId FROM temp.album_search WHERE ArtistId = ?',
        },
      ];

      for (const { indexName, parameter, sql } of indexedQueries) {
        expect(indexService.explainQueryPlan(sql, parameter).join(' ')).toMatch(
          new RegExp(`USING (?:COVERING )?INDEX ${indexName}`, 'i'),
        );
      }
    });

    it('deja intactas las tablas y el hash del catálogo fuente', () => {
      expect(
        database.all<{
          name: string;
          sql: string | null;
          tbl_name: string;
          type: string;
        }>(
          "SELECT type, name, tbl_name, sql FROM main.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        ),
      ).toEqual(mainSchemaBefore);
      expect(readSourceTableSnapshot(sourceDatabasePath)).toEqual(
        sourceTablesBefore,
      );
      expect(readSourceHash(sourceDatabasePath)).toBe(sourceHashBefore);
      expect(readSourceHash(sourceDatabasePath)).toBe(
        '9FBE219EE9E67D2EDCCD26271AF9AFDA37EC1C0D7E17F0DF3C02C705FF0DFA1D',
      );
    });
  });
});
