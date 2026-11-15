import { ConfigService } from '@nestjs/config';
import { createTemporaryAuthDatabase } from '../../test/helpers/temp-auth-database.js';
import { AuthDatabaseService } from './auth-database.service.js';
import { AuthBootstrapService } from './auth-bootstrap.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordHasher } from './password-hasher.js';

describe('AuthBootstrapService', () => {
  let temporaryDatabase: ReturnType<typeof createTemporaryAuthDatabase>;
  let database: AuthDatabaseService;
  let repository: AuthRepository;
  let passwordHasher: PasswordHasher;

  const completeAdminConfig = {
    AUTH_BOOTSTRAP_ADMIN_USERNAME: 'initial-admin',
    AUTH_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    AUTH_BOOTSTRAP_ADMIN_PASSWORD: 'initial-admin-password',
  };

  const createService = (config: Record<string, string> = completeAdminConfig) =>
    new AuthBootstrapService(
      new ConfigService(config),
      repository,
      passwordHasher,
    );

  beforeEach(() => {
    temporaryDatabase = createTemporaryAuthDatabase();
    database = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new AuthRepository(database);
    passwordHasher = new PasswordHasher();
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('creates one enabled admin with an Argon2id hash from complete configuration', async () => {
    const service = createService();

    const created = await service.ensureInitialAdmin();

    expect(created).toMatchObject({
      username: 'initial-admin',
      email: 'admin@example.com',
      role: 'admin',
      enabled: true,
    });
    expect(created?.passwordHash).not.toBe(
      completeAdminConfig.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
    );
    await expect(
      passwordHasher.verify(
        created?.passwordHash ?? '',
        completeAdminConfig.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
      ),
    ).resolves.toBe(true);
    expect(repository.count()).toBe(1);
  });

  it('is idempotent and does not hash or insert the admin a second time', async () => {
    const service = createService();
    const firstAdmin = await service.ensureInitialAdmin();
    const hash = firstAdmin?.passwordHash;
    const hashSpy = vi.spyOn(passwordHasher, 'hash');

    await expect(service.ensureInitialAdmin()).resolves.toBeUndefined();

    expect(hashSpy).not.toHaveBeenCalled();
    expect(repository.findById(firstAdmin?.id ?? -1)?.passwordHash).toBe(hash);
    expect(repository.count()).toBe(1);
  });

  it('fails closed on an empty database when bootstrap configuration is absent', async () => {
    const service = createService({});

    await expect(service.ensureInitialAdmin()).rejects.toThrow(
      'Complete bootstrap admin configuration is required for an empty auth database',
    );
    expect(repository.count()).toBe(0);
  });

  it('fails closed on partial configuration without writing or logging secrets', async () => {
    const partialConfig = {
      AUTH_BOOTSTRAP_ADMIN_USERNAME: 'private-admin',
      AUTH_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    };
    const service = createService(partialConfig);
    const logSpies = [
      vi.spyOn(console, 'debug'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];

    try {
      await expect(service.ensureInitialAdmin()).rejects.toThrow(
        'Complete bootstrap admin configuration is required for an empty auth database',
      );
      expect(repository.count()).toBe(0);
      for (const logSpy of logSpies) {
        expect(logSpy).not.toHaveBeenCalled();
      }
    } finally {
      for (const logSpy of logSpies) {
        logSpy.mockRestore();
      }
    }
  });

  it('validates configured bootstrap account fields before hashing or writing', async () => {
    const service = createService({
      AUTH_BOOTSTRAP_ADMIN_USERNAME: '   ',
      AUTH_BOOTSTRAP_ADMIN_EMAIL: 'not-an-email',
      AUTH_BOOTSTRAP_ADMIN_PASSWORD: 'short',
    });
    const hashSpy = vi.spyOn(passwordHasher, 'hash');

    await expect(service.ensureInitialAdmin()).rejects.toThrow(
      'Bootstrap admin configuration is invalid',
    );

    expect(hashSpy).not.toHaveBeenCalled();
    expect(repository.count()).toBe(0);
  });

  it('does not rewrite an existing viewer even when bootstrap configuration is present', async () => {
    const existingViewer = repository.create({
      username: 'existing-viewer',
      email: 'viewer@example.com',
      passwordHash: 'existing-hash',
      role: 'viewer',
      enabled: true,
    });
    const service = createService({
      ...completeAdminConfig,
      AUTH_BOOTSTRAP_ADMIN_USERNAME: 'existing-viewer',
      AUTH_BOOTSTRAP_ADMIN_EMAIL: 'viewer@example.com',
      AUTH_BOOTSTRAP_ADMIN_PASSWORD: 'a-different-password',
    });
    const hashSpy = vi.spyOn(passwordHasher, 'hash');

    await expect(service.ensureInitialAdmin()).resolves.toBeUndefined();

    expect(hashSpy).not.toHaveBeenCalled();
    expect(repository.findById(existingViewer.id)).toEqual(existingViewer);
    expect(repository.count()).toBe(1);
  });
});
