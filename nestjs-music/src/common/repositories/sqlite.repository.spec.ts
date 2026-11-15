import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../../../test/helpers/temp-database.js';
import { DatabaseService } from '../../database/database.service.js';
import { SqliteRepository } from './sqlite.repository.js';

interface ArtistRow {
  ArtistId: number;
  Name: string;
}

interface AlbumRow {
  AlbumId: number;
  Title: string;
  ArtistId: number;
}

class ArtistsRepository extends SqliteRepository<ArtistRow> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Artist',
      idColumn: 'ArtistId',
      columns: ['ArtistId', 'Name'],
    });
  }
}

class AlbumsRepository extends SqliteRepository<AlbumRow> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Album',
      idColumn: 'AlbumId',
      columns: ['AlbumId', 'Title', 'ArtistId'],
    });
  }
}

class ConstrainedArtistsRepository extends SqliteRepository<ArtistRow> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'ConstrainedArtist',
      idColumn: 'ArtistId',
      columns: ['ArtistId', 'Name'],
    });
  }
}

class EmptyRepository extends SqliteRepository<{ EmptyId: number }> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'EmptyRecord',
      idColumn: 'EmptyId',
      columns: ['EmptyId'],
    });
  }
}

describe('SqliteRepository', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: DatabaseService;
  let repository: ArtistsRepository;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new ArtistsRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('returns rows in ascending id order', () => {
    const rows = repository.page(0, 3);

    expect(rows.map((row) => row.ArtistId)).toEqual([1, 2, 3]);
  });

  it('defaults to skip 0 and limit 100', () => {
    const rows = repository.page();

    expect(rows).toHaveLength(100);
    expect(rows[0]?.ArtistId).toBe(1);
  });

  it('applies skip and limit to the ordered result', () => {
    const rows = repository.page(2, 2);

    expect(rows.map((row) => row.ArtistId)).toEqual([3, 4]);
  });

  it('caps the requested limit at 100 rows', () => {
    expect(repository.page(0, 500)).toHaveLength(100);
  });

  it('bounds rows in SQL ordered by primary key without counting or materializing the catalog', () => {
    const query = vi.spyOn(database, 'all');

    const rows = repository.page(10, 500);

    expect(rows).toHaveLength(100);
    expect(query).toHaveBeenCalledTimes(1);

    const [sql, ...parameters] = query.mock.calls[0] ?? [];
    expect(sql).toMatch(
      /SELECT "ArtistId", "Name" FROM "Artist" ORDER BY "ArtistId" ASC LIMIT \? OFFSET \?/,
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

  it('returns an empty array when skip is beyond the row count', () => {
    expect(repository.page(1000, 10)).toEqual([]);
  });

  it('returns an empty array for a table with no rows', () => {
    database.run('CREATE TABLE EmptyRecord (EmptyId INTEGER PRIMARY KEY)');
    const emptyRepository = new EmptyRepository(database);

    expect(emptyRepository.page()).toEqual([]);
  });

  it('returns a row for an existing id', () => {
    expect(repository.findById(1)).toEqual({ ArtistId: 1, Name: 'AC/DC' });
  });

  it('returns null when the id does not exist, including id zero', () => {
    expect(repository.findById(0)).toBeNull();
    expect(repository.findById(9999)).toBeNull();
  });

  it('inserts and returns the created row', () => {
    expect(repository.insert({ Name: 'Temporary Artist' })).toMatchObject({
      ArtistId: expect.any(Number),
      Name: 'Temporary Artist',
    });
  });

  it('patches allowed columns, ignores unknown columns, and preserves other fields', () => {
    const changes: Partial<ArtistRow> = { Name: 'Updated Artist' };
    Object.assign(changes, { InternalNote: 'must be ignored' });

    expect(repository.patch(1, changes)).toEqual({
      ArtistId: 1,
      Name: 'Updated Artist',
    });
  });

  it('returns null when patch targets a missing id', () => {
    expect(repository.patch(9999, { Name: 'Missing' })).toBeNull();
  });

  it('deletes a row without dependents', () => {
    const created = repository.insert({ Name: 'Temporary Artist' });

    expect(repository.remove(created.ArtistId)).toBe(true);
    expect(repository.findById(created.ArtistId)).toBeNull();
  });

  it('translates a foreign key delete into a 409 conflict without deleting', () => {
    const removeReferencedArtist = () => repository.remove(1);
    expect(removeReferencedArtist).toThrow(ConflictException);

    let exception: unknown;
    try {
      removeReferencedArtist();
    } catch (error) {
      exception = error;
    }
    if (!(exception instanceof ConflictException)) {
      throw new Error('Se esperaba un conflicto HTTP 409.');
    }
    expect(exception.getStatus()).toBe(409);
    expect(repository.findById(1)?.ArtistId).toBe(1);
  });

  it('translates foreign key insert and patch failures into 400 errors', () => {
    const albumsRepository = new AlbumsRepository(database);
    let insertError: unknown;

    try {
      albumsRepository.insert({ Title: 'Orphan album', ArtistId: 999999 });
    } catch (error) {
      insertError = error;
    }
    expect(insertError).toBeInstanceOf(BadRequestException);
    if (insertError instanceof BadRequestException) {
      expect(insertError.getStatus()).toBe(400);
    }
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM "Album" WHERE "Title" = ?',
        'Orphan album',
      )?.count,
    ).toBe(0);
    let patchError: unknown;
    try {
      albumsRepository.patch(1, { ArtistId: 999999 });
    } catch (error) {
      patchError = error;
    }
    expect(patchError).toBeInstanceOf(BadRequestException);
    if (patchError instanceof BadRequestException) {
      expect(patchError.getStatus()).toBe(400);
    }
    expect(albumsRepository.findById(1)?.ArtistId).toBe(1);
  });

  it('translates a non-FK integrity failure on insert into 409 without persisting', () => {
    database.run(
      `CREATE TABLE "ConstrainedArtist" (
        "ArtistId" INTEGER PRIMARY KEY,
        "Name" TEXT NOT NULL CHECK ("Name" <> 'Reserved')
      )`,
    );
    const constrainedRepository = new ConstrainedArtistsRepository(database);
    const originalRun = database.run.bind(database);
    const run = vi.spyOn(database, 'run');
    let sqliteError: unknown;
    run.mockImplementation((sql, ...parameters) => {
      try {
        return originalRun(sql, ...parameters);
      } catch (error) {
        sqliteError = error;
        throw error;
      }
    });
    let insertError: unknown;

    try {
      constrainedRepository.insert({ Name: 'Reserved' });
    } catch (error) {
      insertError = error;
    }

    expect(sqliteError).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    expect(insertError).toBeInstanceOf(ConflictException);
    if (insertError instanceof ConflictException) {
      expect(insertError.getStatus()).toBe(409);
    }
    expect(
      database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM "ConstrainedArtist"',
      )?.count,
    ).toBe(0);
  });

  it('translates a non-FK integrity failure on patch into 409 without changing the row', () => {
    database.run(
      `CREATE TABLE "ConstrainedArtist" (
        "ArtistId" INTEGER PRIMARY KEY,
        "Name" TEXT NOT NULL CHECK ("Name" <> 'Reserved')
      )`,
    );
    const constrainedRepository = new ConstrainedArtistsRepository(database);
    const created = constrainedRepository.insert({ Name: 'Allowed' });
    const originalRun = database.run.bind(database);
    const run = vi.spyOn(database, 'run');
    let sqliteError: unknown;
    run.mockImplementation((sql, ...parameters) => {
      try {
        return originalRun(sql, ...parameters);
      } catch (error) {
        sqliteError = error;
        throw error;
      }
    });
    let patchError: unknown;

    try {
      constrainedRepository.patch(created.ArtistId, { Name: 'Reserved' });
    } catch (error) {
      patchError = error;
    }

    expect(sqliteError).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    expect(patchError).toBeInstanceOf(ConflictException);
    if (patchError instanceof ConflictException) {
      expect(patchError.getStatus()).toBe(409);
    }
    expect(constrainedRepository.findById(created.ArtistId)).toEqual(created);
  });

  it('rolls back a write when a later error occurs inside the transaction', () => {
    const originalArtist = repository.findById(1);
    const originalRun = database.run.bind(database);
    const run = vi.spyOn(database, 'run');
    run.mockImplementation((sql, ...parameters) => {
      originalRun(sql, ...parameters);
      throw new Error('Fallo inducido luego de escribir.');
    });

    expect(() => repository.patch(1, { Name: 'Rolled Back Artist' })).toThrow(
      'Fallo inducido luego de escribir.',
    );
    expect(repository.findById(1)).toEqual(originalArtist);
  });

  it('runs insert, patch, and remove inside transactions', () => {
    const transaction = vi.spyOn(database, 'transaction');
    const created = repository.insert({ Name: 'Transactional Artist' });

    repository.patch(created.ArtistId, { Name: 'Updated Artist' });
    repository.remove(created.ArtistId);

    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
