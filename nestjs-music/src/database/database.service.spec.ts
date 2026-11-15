import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { createTemporaryDatabase } from '../../test/helpers/temp-database.js';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  const sourceDatabasePath = resolve(process.cwd(), 'data/chinook.db');

  it('enables foreign keys on each opened connection', () => {
    const temporaryDatabase = createTemporaryDatabase(sourceDatabasePath);
    const service = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );

    try {
      expect(service.get<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({
        foreign_keys: 1,
      });
      expect(service.all<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual([
        { foreign_keys: 1 },
      ]);
    } finally {
      service.onModuleDestroy();
      temporaryDatabase.cleanup();
    }
  });

  it('keeps transactional writes after closing and reopening the connection', () => {
    const temporaryDatabase = createTemporaryDatabase(sourceDatabasePath);
    const firstConnection = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );

    const result = firstConnection.transaction(() => {
      firstConnection.run('CREATE TABLE PersistenceCheck (Value INTEGER NOT NULL)');
      return firstConnection.run(
        'INSERT INTO PersistenceCheck (Value) VALUES (?)',
        42,
      );
    });
    expect(result.changes).toBe(1);
    firstConnection.onModuleDestroy();

    const secondConnection = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );

    try {
      expect(
        secondConnection.get<{ Value: number }>(
          'SELECT Value FROM PersistenceCheck',
        ),
      ).toEqual({ Value: 42 });
    } finally {
      secondConnection.onModuleDestroy();
      temporaryDatabase.cleanup();
    }
  });

  it('writes only to a temporary copy and leaves the catalog unchanged', () => {
    const originalHash = createHash('sha256')
      .update(readFileSync(sourceDatabasePath))
      .digest('hex');
    const temporaryDatabase = createTemporaryDatabase(sourceDatabasePath);
    const service = new DatabaseService(
      new ConfigService({ DATABASE_PATH: temporaryDatabase.path }),
    );

    try {
      service.run("UPDATE Artist SET Name = 'Temporary Artist' WHERE ArtistId = 1");
      expect(
        service.get<{ Name: string }>(
          'SELECT Name FROM Artist WHERE ArtistId = 1',
        ),
      ).toEqual({ Name: 'Temporary Artist' });
    } finally {
      service.onModuleDestroy();
      temporaryDatabase.cleanup();
    }

    const finalHash = createHash('sha256')
      .update(readFileSync(sourceDatabasePath))
      .digest('hex');
    expect(finalHash).toBe(originalHash);
  });
});
