import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SqliteRepository } from '../common/repositories/sqlite.repository.js';
import type { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';

interface TrackAlbum {
  AlbumId: number;
  Title: string;
}

interface TrackGenre {
  GenreId: number;
  Name: string | null;
}

interface TrackMediaType {
  MediaTypeId: number;
  Name: string;
}

export interface TrackRepositoryRow {
  TrackId: number;
  Name: string;
  AlbumId: number | null;
  GenreId: number | null;
  MediaTypeId: number;
  Composer: string | null;
  Milliseconds: number;
  Bytes: number | null;
  UnitPrice: number;
  Album: TrackAlbum | null;
  Genre: TrackGenre | null;
  MediaType: TrackMediaType;
}

export interface TrackSearchPage {
  items: TrackRepositoryRow[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

interface JoinedTrackRow
  extends Omit<TrackRepositoryRow, 'Album' | 'Genre' | 'MediaType'> {
  JoinedAlbumId: number | null;
  JoinedAlbumTitle: string | null;
  JoinedGenreId: number | null;
  JoinedGenreName: string | null;
  JoinedMediaTypeId: number;
  JoinedMediaTypeName: string;
}

const selectTracksWithRelations =
  'SELECT "Track"."TrackId", "Track"."Name", "Track"."AlbumId", ' +
  '"Track"."GenreId", "Track"."MediaTypeId", "Track"."Composer", ' +
  '"Track"."Milliseconds", "Track"."Bytes", "Track"."UnitPrice", ' +
  '"Album"."AlbumId" AS "JoinedAlbumId", ' +
  '"Album"."Title" AS "JoinedAlbumTitle", ' +
  '"Genre"."GenreId" AS "JoinedGenreId", ' +
  '"Genre"."Name" AS "JoinedGenreName", ' +
  '"MediaType"."MediaTypeId" AS "JoinedMediaTypeId", ' +
  '"MediaType"."Name" AS "JoinedMediaTypeName" ' +
  'FROM "Track" ' +
  'LEFT JOIN "Album" ON "Album"."AlbumId" = "Track"."AlbumId" ' +
  'LEFT JOIN "Genre" ON "Genre"."GenreId" = "Track"."GenreId" ' +
  'INNER JOIN "MediaType" ON "MediaType"."MediaTypeId" = "Track"."MediaTypeId" ';

const selectTracksWithSearchRelations =
  'SELECT "Track"."TrackId", "Track"."Name", "Track"."AlbumId", ' +
  '"Track"."GenreId", "Track"."MediaTypeId", "Track"."Composer", ' +
  '"Track"."Milliseconds", "Track"."Bytes", "Track"."UnitPrice", ' +
  '"Album"."AlbumId" AS "JoinedAlbumId", ' +
  '"Album"."Title" AS "JoinedAlbumTitle", ' +
  '"Genre"."GenreId" AS "JoinedGenreId", ' +
  '"Genre"."Name" AS "JoinedGenreName", ' +
  '"MediaType"."MediaTypeId" AS "JoinedMediaTypeId", ' +
  '"MediaType"."Name" AS "JoinedMediaTypeName" ' +
  'FROM temp.track_search AS "Search" ' +
  'INNER JOIN "Track" ON "Track"."TrackId" = "Search"."TrackId" ' +
  'LEFT JOIN "Album" ON "Album"."AlbumId" = "Track"."AlbumId" ' +
  'LEFT JOIN "Genre" ON "Genre"."GenreId" = "Track"."GenreId" ' +
  'INNER JOIN "MediaType" ON "MediaType"."MediaTypeId" = "Track"."MediaTypeId" ';

const trackSearchSortColumns = {
  Name: '"Search"."NameKey" COLLATE BINARY',
  UnitPrice: '"Search"."UnitPrice"',
  Milliseconds: '"Search"."Milliseconds"',
} as const;

function isTrackSearchSort(
  sort: string,
): sort is keyof typeof trackSearchSortColumns {
  return Object.prototype.hasOwnProperty.call(trackSearchSortColumns, sort);
}

function normalizeSearchTerm(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function canUseTrigramSearch(value: string): boolean {
  const normalizedValue = normalizeSearchTerm(value);
  return (
    Array.from(normalizedValue).length >= 3 &&
    !normalizedValue.includes('"') &&
    !normalizedValue.includes('\0')
  );
}

function buildTrackSearchFilters(
  query: SearchTracksQueryDto,
): { whereSql: string; parameters: unknown[] } {
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  const fullTextFilters: Array<{ column: string; value: string }> = [];
  const textFilters = [
    { column: 'NameKey', value: query.text },
    { column: 'GenreNameKey', value: query.genre },
    { column: 'ArtistNameKey', value: query.artist },
  ];

  for (const filter of textFilters) {
    const value = filter.value?.trim();
    if (value === undefined || value.length === 0) {
      continue;
    }

    if (canUseTrigramSearch(value)) {
      fullTextFilters.push({ column: filter.column, value });
    } else {
      clauses.push(
        `instr(search_key("Search"."${filter.column}"), search_key(?)) > 0`,
      );
      parameters.push(value);
    }
  }

  if (fullTextFilters.length > 0) {
    const matchExpression = fullTextFilters
      .map(
        ({ column, value }) =>
          `${column} : "${normalizeSearchTerm(value)}"`,
      )
      .join(' AND ');
    clauses.push(
      '"Search"."TrackId" IN (' +
        'SELECT rowid FROM temp.track_search_fts ' +
        'WHERE track_search_fts MATCH ?)',
    );
    parameters.push(matchExpression);

    for (const filter of fullTextFilters) {
      clauses.push(
        `instr(search_key("Search"."${filter.column}"), search_key(?)) > 0`,
      );
      parameters.push(filter.value);
    }
  }

  if (query.minPrice !== undefined) {
    clauses.push('"Search"."UnitPrice" >= ?');
    parameters.push(query.minPrice);
  }
  if (query.maxPrice !== undefined) {
    clauses.push('"Search"."UnitPrice" <= ?');
    parameters.push(query.maxPrice);
  }
  if (query.minDuration !== undefined) {
    clauses.push('"Search"."Milliseconds" >= ?');
    parameters.push(query.minDuration);
  }
  if (query.maxDuration !== undefined) {
    clauses.push('"Search"."Milliseconds" <= ?');
    parameters.push(query.maxDuration);
  }

  return {
    whereSql: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1',
    parameters,
  };
}

function mapJoinedTrack(row: JoinedTrackRow): TrackRepositoryRow {
  const album =
    row.JoinedAlbumId === null || row.JoinedAlbumTitle === null
      ? null
      : {
          AlbumId: row.JoinedAlbumId,
          Title: row.JoinedAlbumTitle,
        };
  const genre =
    row.JoinedGenreId === null
      ? null
      : {
          GenreId: row.JoinedGenreId,
          Name: row.JoinedGenreName,
        };

  return {
    TrackId: row.TrackId,
    Name: row.Name,
    AlbumId: row.AlbumId,
    GenreId: row.GenreId,
    MediaTypeId: row.MediaTypeId,
    Composer: row.Composer,
    Milliseconds: row.Milliseconds,
    Bytes: row.Bytes,
    UnitPrice: Number(row.UnitPrice.toFixed(2)),
    Album: album,
    Genre: genre,
    MediaType: {
      MediaTypeId: row.JoinedMediaTypeId,
      Name: row.JoinedMediaTypeName,
    },
  };
}

@Injectable()
export class TracksRepository extends SqliteRepository<TrackRepositoryRow> {
  private static readonly maximumTrackPageSize = 100;

  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Track',
      idColumn: 'TrackId',
      columns: [
        'TrackId',
        'Name',
        'AlbumId',
        'GenreId',
        'MediaTypeId',
        'Composer',
        'Milliseconds',
        'Bytes',
        'UnitPrice',
      ],
    });
  }

  albumExists(id: number): boolean {
    return (
      this.database.get<{ AlbumId: number }>(
        'SELECT "AlbumId" FROM "Album" WHERE "AlbumId" = ? LIMIT 1',
        id,
      ) !== undefined
    );
  }

  genreExists(id: number): boolean {
    return (
      this.database.get<{ GenreId: number }>(
        'SELECT "GenreId" FROM "Genre" WHERE "GenreId" = ? LIMIT 1',
        id,
      ) !== undefined
    );
  }

  mediaTypeExists(id: number): boolean {
    return (
      this.database.get<{ MediaTypeId: number }>(
        'SELECT "MediaTypeId" FROM "MediaType" WHERE "MediaTypeId" = ? LIMIT 1',
        id,
      ) !== undefined
    );
  }
  override page(skip = 0, limit = 100): TrackRepositoryRow[] {
    const boundedLimit = Math.min(limit, TracksRepository.maximumTrackPageSize);
    const rows = this.database.all<JoinedTrackRow>(
      selectTracksWithRelations +
        'ORDER BY "Track"."TrackId" ASC LIMIT ? OFFSET ?',
      boundedLimit,
      skip,
    );

    return rows.map(mapJoinedTrack);
  }

  override findById(id: number | string): TrackRepositoryRow | null {
    const row = this.database.get<JoinedTrackRow>(
      selectTracksWithRelations + 'WHERE "Track"."TrackId" = ? LIMIT 1',
      id,
    );

    return row ? mapJoinedTrack(row) : null;
  }

  search(query: SearchTracksQueryDto): TrackSearchPage {
    const skip = query.skip ?? 0;
    const limit = Math.min(
      query.limit ?? TracksRepository.maximumTrackPageSize,
      TracksRepository.maximumTrackPageSize,
    );
    const filters = buildTrackSearchFilters(query);
    const count = this.database.get<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM temp.track_search AS "Search" ' +
        `WHERE ${filters.whereSql}`,
      ...filters.parameters,
    );
    if (count === undefined) {
      throw new Error('No se pudo contar el resultado de búsqueda de pistas.');
    }

    const sortColumn = isTrackSearchSort(query.sort)
      ? trackSearchSortColumns[query.sort]
      : trackSearchSortColumns.Name;
    const orderDirection = query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = this.database.all<JoinedTrackRow>(
      selectTracksWithSearchRelations +
        `WHERE ${filters.whereSql} ` +
        `ORDER BY ${sortColumn} ${orderDirection}, ` +
        '"Search"."TrackId" ASC LIMIT ? OFFSET ?',
      ...filters.parameters,
      limit,
      skip,
    );
    const items = rows.map(mapJoinedTrack);

    return {
      items,
      total: count.total,
      skip,
      limit,
      hasMore: skip + items.length < count.total,
    };
  }
}
