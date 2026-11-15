import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SqliteRepository } from '../common/repositories/sqlite.repository.js';
import type { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';

interface AlbumArtist {
  ArtistId: number;
  Name: string;
}

export interface AlbumRepositoryRow {
  AlbumId: number;
  Title: string;
  ArtistId: number;
  Artist: AlbumArtist;
}

interface JoinedAlbumRow {
  AlbumId: number;
  Title: string;
  ArtistId: number;
  JoinedArtistId: number;
  JoinedArtistName: string;
}

export interface AlbumSearchPage {
  items: AlbumRepositoryRow[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

interface AlbumSearchFilters {
  whereSql: string;
  parameters: unknown[];
}

const selectAlbumsWithSearchRelations =
  'SELECT "Album"."AlbumId", "Album"."Title", "Album"."ArtistId", ' +
  '"Artist"."ArtistId" AS "JoinedArtistId", ' +
  '"Artist"."Name" AS "JoinedArtistName" ' +
  'FROM temp.album_search AS "Search" ' +
  'INNER JOIN "Album" ON "Album"."AlbumId" = "Search"."AlbumId" ' +
  'INNER JOIN "Artist" ON "Artist"."ArtistId" = "Album"."ArtistId" ';

const albumSearchSortColumns = {
  Title: '"Search"."TitleKey" COLLATE BINARY',
  ArtistName: '"Search"."ArtistNameKey" COLLATE BINARY',
} as const;

function isAlbumSearchSort(
  sort: string,
): sort is keyof typeof albumSearchSortColumns {
  return Object.prototype.hasOwnProperty.call(albumSearchSortColumns, sort);
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

function buildAlbumSearchFilters(
  query: SearchAlbumsQueryDto,
): AlbumSearchFilters {
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  const fullTextFilters: Array<{ column: string; value: string }> = [];
  const textFilters = [
    { column: 'TitleKey', value: query.text },
    { column: 'ArtistNameKey', value: query.artist },
  ];

  for (const filter of textFilters) {
    const value = filter.value?.trim();
    if (value === undefined || value.length === 0) {
      continue;
    }

    if (canUseTrigramSearch(value)) {
      fullTextFilters.push({ column: filter.column, value });
    }

    clauses.push(
      `instr(search_key("Search"."${filter.column}"), search_key(?)) > 0`,
    );
    parameters.push(value);
  }

  if (fullTextFilters.length > 0) {
    const matchExpression = fullTextFilters
      .map(({ column, value }) => `${column} : "${normalizeSearchTerm(value)}"`)
      .join(' AND ');
    clauses.push(
      '"Search"."AlbumId" IN (' +
        'SELECT rowid FROM temp.album_search_fts ' +
        'WHERE album_search_fts MATCH ?)',
    );
    parameters.push(matchExpression);
  }

  return {
    whereSql: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1',
    parameters,
  };
}

function mapJoinedAlbum(row: JoinedAlbumRow): AlbumRepositoryRow {
  return {
    AlbumId: row.AlbumId,
    Title: row.Title,
    ArtistId: row.ArtistId,
    Artist: {
      ArtistId: row.JoinedArtistId,
      Name: row.JoinedArtistName,
    },
  };
}

@Injectable()
export class AlbumsRepository extends SqliteRepository<AlbumRepositoryRow> {
  private static readonly maximumAlbumPageSize = 100;

  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Album',
      idColumn: 'AlbumId',
      columns: ['AlbumId', 'Title', 'ArtistId'],
    });
  }

  override page(skip = 0, limit = 100): AlbumRepositoryRow[] {
    const boundedLimit = Math.min(limit, AlbumsRepository.maximumAlbumPageSize);
    const rows = this.database.all<JoinedAlbumRow>(
      'SELECT "Album"."AlbumId", "Album"."Title", "Album"."ArtistId", ' +
        '"Artist"."ArtistId" AS "JoinedArtistId", ' +
        '"Artist"."Name" AS "JoinedArtistName" ' +
        'FROM "Album" INNER JOIN "Artist" ' +
        'ON "Artist"."ArtistId" = "Album"."ArtistId" ' +
        'ORDER BY "Album"."AlbumId" ASC LIMIT ? OFFSET ?',
      boundedLimit,
      skip,
    );

    return rows.map(mapJoinedAlbum);
  }

  override findById(id: number | string): AlbumRepositoryRow | null {
    const row = this.database.get<JoinedAlbumRow>(
      'SELECT "Album"."AlbumId", "Album"."Title", "Album"."ArtistId", ' +
        '"Artist"."ArtistId" AS "JoinedArtistId", ' +
        '"Artist"."Name" AS "JoinedArtistName" ' +
        'FROM "Album" INNER JOIN "Artist" ' +
        'ON "Artist"."ArtistId" = "Album"."ArtistId" ' +
        'WHERE "Album"."AlbumId" = ? LIMIT 1',
      id,
    );

    return row ? mapJoinedAlbum(row) : null;
  }

  search(query: SearchAlbumsQueryDto): AlbumSearchPage {
    const skip = query.skip ?? 0;
    const limit = Math.min(
      query.limit ?? AlbumsRepository.maximumAlbumPageSize,
      AlbumsRepository.maximumAlbumPageSize,
    );
    const filters = buildAlbumSearchFilters(query);
    const count = this.database.get<{ total: number }>(
      'SELECT COUNT(*) AS "total" FROM temp.album_search AS "Search" ' +
        `WHERE ${filters.whereSql}`,
      ...filters.parameters,
    );
    if (count === undefined) {
      throw new Error('No se pudo contar el resultado de búsqueda de álbumes.');
    }

    const sortColumn = isAlbumSearchSort(query.sort)
      ? albumSearchSortColumns[query.sort]
      : albumSearchSortColumns.Title;
    const orderDirection = query.order === 'desc' ? 'DESC' : 'ASC';
    const rows = this.database.all<JoinedAlbumRow>(
      selectAlbumsWithSearchRelations +
        `WHERE ${filters.whereSql} ` +
        `ORDER BY ${sortColumn} ${orderDirection}, ` +
        '"Search"."AlbumId" ASC LIMIT ? OFFSET ?',
      ...filters.parameters,
      limit,
      skip,
    );
    const items = rows.map(mapJoinedAlbum);

    return {
      items,
      total: count.total,
      skip,
      limit,
      hasMore: skip + items.length < count.total,
    };
  }
}
