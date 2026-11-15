import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { createTemporaryAuthDatabase } from '../../test/helpers/temp-auth-database.js';
import { AuthDatabaseService } from './auth-database.service.js';

describe('AuthDatabaseService', () => {
  const catalogPath = resolve(process.cwd(), 'data/chinook.db');

  it('creates an initialized auth database at AUTH_DATABASE_PATH', () => {
    const temporaryDatabase = createTemporaryAuthDatabase();
    const service = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );

    try {
      expect(existsSync(temporaryDatabase.path)).toBe(true);
      expect(service.get<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({
        foreign_keys: 1,
      });
    } finally {
      service.onModuleDestroy();
      temporaryDatabase.cleanup();
    }
  });

  it('defaults to data/auth.db under the current working directory', () => {
    const temporaryDatabase = createTemporaryAuthDatabase();
    const dataDirectory = join(temporaryDatabase.directory, 'data');
    mkdirSync(dataDirectory);
    const defaultPath = join(dataDirectory, 'auth.db');
    const workingDirectory = vi
      .spyOn(process, 'cwd')
      .mockReturnValue(temporaryDatabase.directory);
    const service = new AuthDatabaseService(new ConfigService());
    workingDirectory.mockRestore();

    try {
      expect(existsSync(defaultPath)).toBe(true);
    } finally {
      service.onModuleDestroy();
      temporaryDatabase.cleanup();
    }
  });

  it('reopens the auth database without writing to the Chinook catalog', () => {
    const originalCatalogHash = createHash('sha256')
      .update(readFileSync(catalogPath))
      .digest('hex');
    const temporaryDatabase = createTemporaryAuthDatabase();
    const firstConnection = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );

    firstConnection.run('CREATE TABLE AuthProbe (Value TEXT NOT NULL)');
    firstConnection.run('INSERT INTO AuthProbe (Value) VALUES (?)', 'auth-only');
    firstConnection.onModuleDestroy();

    const reopenedConnection = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );

    try {
      expect(
        reopenedConnection.get<{ Value: string }>(
          'SELECT Value FROM AuthProbe',
        ),
      ).toEqual({ Value: 'auth-only' });
    } finally {
      reopenedConnection.onModuleDestroy();
      temporaryDatabase.cleanup();
    }

    const finalCatalogHash = createHash('sha256')
      .update(readFileSync(catalogPath))
      .digest('hex');
    expect(finalCatalogHash).toBe(originalCatalogHash);
  });

  it('closes the SQLite connection when its module is destroyed', () => {
    const temporaryDatabase = createTemporaryAuthDatabase();
    const service = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );

    service.onModuleDestroy();

    try {
      expect(() => service.get('PRAGMA foreign_keys')).toThrow();
    } finally {
      temporaryDatabase.cleanup();
    }
  });
});
