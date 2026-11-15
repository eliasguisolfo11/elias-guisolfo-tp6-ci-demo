import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

function normalizeSearchKey(value: string | null): string | null {
  return (
    value
      ?.normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase() ?? null
  );
}

@Injectable()
export class SearchIndexService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.database.registerSearchKeyFunction(normalizeSearchKey);
    this.database.transaction(() => {
      this.createProjections();
      this.populateProjections();
      this.createBTreeIndexes();
      this.createFullTextIndexes();
      this.populateFullTextIndexes();
      this.createSynchronizationTriggers();
    });
  }

  explainQueryPlan(sql: string, ...parameters: unknown[]): string[] {
    return this.database
      .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...parameters)
      .map(({ detail }) => detail);
  }

  private createProjections(): void {
    this.database.run(`
      CREATE TEMP TABLE track_search (
        TrackId INTEGER PRIMARY KEY,
        AlbumId INTEGER,
        ArtistId INTEGER,
        GenreId INTEGER,
        NameKey TEXT NOT NULL,
        ArtistNameKey TEXT,
        GenreNameKey TEXT,
        UnitPrice REAL NOT NULL,
        Milliseconds INTEGER NOT NULL
      )
    `);
    this.database.run(`
      CREATE TEMP TABLE album_search (
        AlbumId INTEGER PRIMARY KEY,
        TitleKey TEXT NOT NULL,
        ArtistId INTEGER,
        ArtistNameKey TEXT
      )
    `);
  }

  private populateProjections(): void {
    this.database.run(`
      INSERT INTO temp.track_search (
        TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey,
        GenreNameKey, UnitPrice, Milliseconds
      )
      SELECT track.TrackId, track.AlbumId, album.ArtistId, track.GenreId,
             search_key(track.Name), search_key(artist.Name),
             search_key(genre.Name), track.UnitPrice, track.Milliseconds
      FROM main.Track AS track
      LEFT JOIN main.Album AS album ON album.AlbumId = track.AlbumId
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
      LEFT JOIN main.Genre AS genre ON genre.GenreId = track.GenreId
    `);
    this.database.run(`
      INSERT INTO temp.album_search (
        AlbumId, TitleKey, ArtistId, ArtistNameKey
      )
      SELECT album.AlbumId, search_key(album.Title), album.ArtistId,
             search_key(artist.Name)
      FROM main.Album AS album
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
    `);
  }

  private createBTreeIndexes(): void {
    this.database.run(
      'CREATE INDEX temp.track_search_unit_price_idx ON track_search(UnitPrice)',
    );
    this.database.run(
      'CREATE INDEX temp.track_search_milliseconds_idx ON track_search(Milliseconds)',
    );
    this.database.run(
      'CREATE INDEX temp.track_search_album_id_idx ON track_search(AlbumId)',
    );
    this.database.run(
      'CREATE INDEX temp.track_search_artist_id_idx ON track_search(ArtistId)',
    );
    this.database.run(
      'CREATE INDEX temp.track_search_genre_id_idx ON track_search(GenreId)',
    );
    this.database.run(
      'CREATE INDEX temp.album_search_artist_id_idx ON album_search(ArtistId)',
    );
  }

  private createFullTextIndexes(): void {
    this.database.run(`
      CREATE VIRTUAL TABLE temp.track_search_fts USING fts5(
        NameKey, ArtistNameKey, GenreNameKey,
        tokenize = 'trigram'
      )
    `);
    this.database.run(`
      CREATE VIRTUAL TABLE temp.album_search_fts USING fts5(
        TitleKey, ArtistNameKey,
        tokenize = 'trigram'
      )
    `);
  }

  private populateFullTextIndexes(): void {
    this.database.run(`
      INSERT INTO temp.track_search_fts (
        rowid, NameKey, ArtistNameKey, GenreNameKey
      )
      SELECT TrackId, NameKey, ArtistNameKey, GenreNameKey
      FROM temp.track_search
    `);
    this.database.run(`
      INSERT INTO temp.album_search_fts (rowid, TitleKey, ArtistNameKey)
      SELECT AlbumId, TitleKey, ArtistNameKey
      FROM temp.album_search
    `);
  }

  private createSynchronizationTriggers(): void {
    this.createTrackTriggers();
    this.createAlbumTriggers();
    this.createArtistTriggers();
    this.createGenreTriggers();
  }

  private createTrackTriggers(): void {
    this.database.run(`
      CREATE TEMP TRIGGER search_track_after_insert
      AFTER INSERT ON main.Track
      BEGIN
        ${this.insertTrackProjectionFromNewRow()}
        ${this.insertTrackFullTextFromNewRow()}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_track_after_update
      AFTER UPDATE ON main.Track
      BEGIN
        DELETE FROM track_search_fts WHERE rowid = OLD.TrackId;
        DELETE FROM track_search WHERE TrackId = OLD.TrackId;
        ${this.insertTrackProjectionFromNewRow()}
        ${this.insertTrackFullTextFromNewRow()}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_track_after_delete
      AFTER DELETE ON main.Track
      BEGIN
        DELETE FROM track_search_fts WHERE rowid = OLD.TrackId;
        DELETE FROM track_search WHERE TrackId = OLD.TrackId;
      END
    `);
  }

  private createAlbumTriggers(): void {
    this.database.run(`
      CREATE TEMP TRIGGER search_album_after_insert
      AFTER INSERT ON main.Album
      BEGIN
        ${this.insertAlbumProjectionFromNewRow()}
        ${this.insertAlbumFullTextFromNewRow()}
        ${this.refreshTracksForAlbum('NEW.AlbumId')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_album_after_update
      AFTER UPDATE ON main.Album
      BEGIN
        DELETE FROM album_search_fts WHERE rowid = OLD.AlbumId;
        DELETE FROM album_search WHERE AlbumId = OLD.AlbumId;
        ${this.insertAlbumProjectionFromNewRow()}
        ${this.insertAlbumFullTextFromNewRow()}
        ${this.refreshTracksForAlbum('NEW.AlbumId')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_album_after_delete
      AFTER DELETE ON main.Album
      BEGIN
        DELETE FROM album_search_fts WHERE rowid = OLD.AlbumId;
        DELETE FROM album_search WHERE AlbumId = OLD.AlbumId;
      END
    `);
  }

  private createArtistTriggers(): void {
    this.database.run(`
      CREATE TEMP TRIGGER search_artist_after_insert
      AFTER INSERT ON main.Artist
      BEGIN
        ${this.refreshArtistRelations('ArtistId = NEW.ArtistId')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_artist_after_update
      AFTER UPDATE ON main.Artist
      BEGIN
        ${this.refreshArtistRelations('ArtistId IN (OLD.ArtistId, NEW.ArtistId)')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_artist_after_delete
      AFTER DELETE ON main.Artist
      BEGIN
        ${this.refreshArtistRelations('ArtistId = OLD.ArtistId')}
      END
    `);
  }

  private createGenreTriggers(): void {
    this.database.run(`
      CREATE TEMP TRIGGER search_genre_after_insert
      AFTER INSERT ON main.Genre
      BEGIN
        ${this.refreshGenreTracks('GenreId = NEW.GenreId')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_genre_after_update
      AFTER UPDATE ON main.Genre
      BEGIN
        ${this.refreshGenreTracks('GenreId IN (OLD.GenreId, NEW.GenreId)')}
      END
    `);
    this.database.run(`
      CREATE TEMP TRIGGER search_genre_after_delete
      AFTER DELETE ON main.Genre
      BEGIN
        ${this.refreshGenreTracks('GenreId = OLD.GenreId')}
      END
    `);
  }

  private insertTrackProjectionFromNewRow(): string {
    return `
      INSERT INTO track_search (
        TrackId, AlbumId, ArtistId, GenreId, NameKey, ArtistNameKey,
        GenreNameKey, UnitPrice, Milliseconds
      )
      SELECT NEW.TrackId, NEW.AlbumId, album.ArtistId, NEW.GenreId,
             search_key(NEW.Name), search_key(artist.Name),
             search_key(genre.Name), NEW.UnitPrice, NEW.Milliseconds
      FROM (SELECT 1) AS anchor
      LEFT JOIN main.Album AS album ON album.AlbumId = NEW.AlbumId
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
      LEFT JOIN main.Genre AS genre ON genre.GenreId = NEW.GenreId;
    `;
  }

  private insertAlbumProjectionFromNewRow(): string {
    return `
      INSERT INTO album_search (AlbumId, TitleKey, ArtistId, ArtistNameKey)
      SELECT NEW.AlbumId, search_key(NEW.Title), NEW.ArtistId,
             search_key(artist.Name)
      FROM (SELECT 1) AS anchor
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = NEW.ArtistId;
    `;
  }

  private insertTrackFullTextFor(whereClause: string): string {
    return `
      INSERT INTO track_search_fts (
        rowid, NameKey, ArtistNameKey, GenreNameKey
      )
      SELECT TrackId, NameKey, ArtistNameKey, GenreNameKey
      FROM track_search WHERE ${whereClause};
    `;
  }

  private insertAlbumFullTextFor(whereClause: string): string {
    return `
      INSERT INTO album_search_fts (rowid, TitleKey, ArtistNameKey)
      SELECT AlbumId, TitleKey, ArtistNameKey
      FROM album_search WHERE ${whereClause};
    `;
  }

  private insertTrackFullTextFromNewRow(): string {
    return `
      INSERT INTO track_search_fts (
        rowid, NameKey, ArtistNameKey, GenreNameKey
      )
      VALUES (
        NEW.TrackId,
        (SELECT NameKey FROM track_search WHERE TrackId = NEW.TrackId),
        (SELECT ArtistNameKey FROM track_search WHERE TrackId = NEW.TrackId),
        (SELECT GenreNameKey FROM track_search WHERE TrackId = NEW.TrackId)
      );
    `;
  }

  private insertAlbumFullTextFromNewRow(): string {
    return `
      INSERT INTO album_search_fts (rowid, TitleKey, ArtistNameKey)
      VALUES (
        NEW.AlbumId,
        (SELECT TitleKey FROM album_search WHERE AlbumId = NEW.AlbumId),
        (SELECT ArtistNameKey FROM album_search WHERE AlbumId = NEW.AlbumId)
      );
    `;
  }

  private refreshTracksForAlbum(albumIdExpression: string): string {
    const whereClause = `AlbumId = ${albumIdExpression}`;
    return `
      DELETE FROM track_search_fts
      WHERE rowid IN (
        SELECT TrackId FROM track_search WHERE ${whereClause}
      );
      UPDATE track_search
      SET ArtistId = (
            SELECT album.ArtistId FROM main.Album AS album
            WHERE album.AlbumId = ${albumIdExpression}
          ),
          ArtistNameKey = (
            SELECT search_key(artist.Name)
            FROM main.Album AS album
            LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
            WHERE album.AlbumId = ${albumIdExpression}
          )
      WHERE ${whereClause};
      ${this.insertTrackFullTextFor(whereClause)}
    `;
  }

  private refreshArtistRelations(whereClause: string): string {
    const artistKeyForAlbum = `(
      SELECT search_key(artist.Name)
      FROM main.Album AS album
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
      WHERE album.AlbumId = album_search.AlbumId
    )`;
    const artistIdForTrack = `(
      SELECT album.ArtistId
      FROM main.Track AS track
      LEFT JOIN main.Album AS album ON album.AlbumId = track.AlbumId
      WHERE track.TrackId = track_search.TrackId
    )`;
    const artistKeyForTrack = `(
      SELECT search_key(artist.Name)
      FROM main.Track AS track
      LEFT JOIN main.Album AS album ON album.AlbumId = track.AlbumId
      LEFT JOIN main.Artist AS artist ON artist.ArtistId = album.ArtistId
      WHERE track.TrackId = track_search.TrackId
    )`;

    return `
      DELETE FROM album_search_fts
      WHERE rowid IN (
        SELECT AlbumId FROM album_search WHERE ${whereClause}
      );
      UPDATE album_search
      SET ArtistNameKey = ${artistKeyForAlbum}
      WHERE ${whereClause};
      ${this.insertAlbumFullTextFor(whereClause)}

      DELETE FROM track_search_fts
      WHERE rowid IN (
        SELECT TrackId FROM track_search WHERE ${whereClause}
      );
      UPDATE track_search
      SET ArtistId = ${artistIdForTrack},
          ArtistNameKey = ${artistKeyForTrack}
      WHERE ${whereClause};
      ${this.insertTrackFullTextFor(whereClause)}
    `;
  }

  private refreshGenreTracks(whereClause: string): string {
    const genreKeyForTrack = `(
      SELECT search_key(genre.Name)
      FROM main.Track AS track
      LEFT JOIN main.Genre AS genre ON genre.GenreId = track.GenreId
      WHERE track.TrackId = track_search.TrackId
    )`;

    return `
      DELETE FROM track_search_fts
      WHERE rowid IN (
        SELECT TrackId FROM track_search WHERE ${whereClause}
      );
      UPDATE track_search
      SET GenreNameKey = ${genreKeyForTrack}
      WHERE ${whereClause};
      ${this.insertTrackFullTextFor(whereClause)}
    `;
  }
}
