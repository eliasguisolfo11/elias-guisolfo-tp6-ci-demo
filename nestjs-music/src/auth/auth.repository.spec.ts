import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTemporaryAuthDatabase } from '../../test/helpers/temp-auth-database.js';
import { AuthDatabaseService } from './auth-database.service.js';
import type { CreateAuthUserInput } from './auth-user.entity.js';
import { AuthRepository } from './auth.repository.js';

describe('AuthRepository', () => {
  let temporaryDatabase: ReturnType<typeof createTemporaryAuthDatabase>;
  let database: AuthDatabaseService;
  let repository: AuthRepository;

  const createUser = (overrides: Partial<CreateAuthUserInput> = {}) =>
    repository.create({
      username: 'reader',
      email: 'reader@example.com',
      passwordHash: 'encoded-hash',
      role: 'viewer',
      enabled: true,
      ...overrides,
    });

  beforeEach(() => {
    temporaryDatabase = createTemporaryAuthDatabase();
    database = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new AuthRepository(database);
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('persists accounts and finds them by ID, normalized username, and normalized email', () => {
    const created = createUser({
      username: '  Reader  ',
      email: ' Reader@Example.com ',
    });

    expect(repository.findById(created.id)).toEqual(created);
    expect(repository.findByUsername(' READER ')).toEqual(created);
    expect(repository.findByEmail(' reader@example.com ')).toEqual(created);
    expect(repository.count()).toBe(1);
  });

  it('keeps accounts persisted after reopening the auth database', () => {
    const created = createUser({ username: 'PersistentReader' });
    database.onModuleDestroy();

    database = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new AuthRepository(database);

    expect(repository.findById(created.id)).toEqual(created);
  });

  it('rejects a username that duplicates after trimming and lowercasing without a partial insert', () => {
    createUser({ username: 'Alice' });

    expect(() => createUser({
      username: '  aLiCe  ',
      email: 'different@example.com',
    })).toThrow(ConflictException);
    expect(repository.count()).toBe(1);
  });

  it('rejects an email that duplicates after trimming and lowercasing without a partial insert', () => {
    createUser({ email: 'Owner@Example.com' });

    expect(() => createUser({
      username: 'different-user',
      email: ' owner@example.COM ',
    })).toThrow(ConflictException);
    expect(repository.count()).toBe(1);
  });

  it.each([
    [
      'username',
      { username: 'ConcurrentUser', email: 'first@example.com' },
      { username: ' concurrentUSER ', email: 'second@example.com' },
    ],
    [
      'email',
      { username: 'first-user', email: 'Concurrent@Example.com' },
      { username: 'second-user', email: ' concurrent@example.COM ' },
    ],
  ] as const)(
    'allows exactly one of two concurrent creates on separate connections with a duplicate normalized %s',
    async (_key, firstInput, secondInput) => {
      const secondDatabase = new AuthDatabaseService(
        new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
      );
      const secondRepository = new AuthRepository(secondDatabase);

      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => createUser(firstInput)),
          Promise.resolve().then(() =>
            secondRepository.create({
              ...secondInput,
              passwordHash: 'encoded-hash',
              role: 'viewer',
              enabled: true,
            }),
          ),
        ]);
        const fulfilled = results.filter(
          (result) => result.status === 'fulfilled',
        );
        const rejected = results.filter(
          (result) => result.status === 'rejected',
        );

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        if (rejected[0]?.status === 'rejected') {
          expect(rejected[0].reason).toBeInstanceOf(ConflictException);
        }
        expect(repository.count()).toBe(1);
      } finally {
        secondDatabase.onModuleDestroy();
      }
    },
  );

  it('stores original values and the separately normalized keys', () => {
    const created = createUser({
      username: '  MixedCase  ',
      email: '  Mixed@Example.com  ',
    });

    expect(created.username).toBe('  MixedCase  ');
    expect(created.usernameNormalized).toBe('mixedcase');
    expect(created.email).toBe('  Mixed@Example.com  ');
    expect(created.emailNormalized).toBe('mixed@example.com');
  });

  it('does not map other database constraints to a duplicate conflict', () => {
    let capturedError: unknown;

    try {
      createUser({ username: '   ' });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).not.toBeInstanceOf(ConflictException);
    expect(repository.count()).toBe(0);
  });
});
