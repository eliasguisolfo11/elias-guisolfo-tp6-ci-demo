import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createTemporaryAuthDatabase } from '../../test/helpers/temp-auth-database.js';
import { AuthDatabaseService } from './auth-database.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';

const TEST_JWT_SECRET = 'nestjs-music-unit-test-secret';
const INVALID_CREDENTIALS_MESSAGE = 'Se requieren credenciales válidas.';

describe('AuthService registration', () => {
  let temporaryDatabase: ReturnType<typeof createTemporaryAuthDatabase>;
  let database: AuthDatabaseService;
  let repository: AuthRepository;
  let passwordHasher: PasswordHasher;
  let jwtService: JwtService;
  let configService: ConfigService;
  let service: AuthService;

  beforeEach(() => {
    temporaryDatabase = createTemporaryAuthDatabase();
    database = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );
    repository = new AuthRepository(database);
    passwordHasher = new PasswordHasher();
    jwtService = new JwtService({ secret: TEST_JWT_SECRET });
    configService = new ConfigService();
    service = new AuthService(
      repository,
      passwordHasher,
      jwtService,
      configService,
    );
  });

  afterEach(() => {
    database.onModuleDestroy();
    temporaryDatabase.cleanup();
  });

  it('creates an enabled viewer and returns only its public fields', async () => {
    const response = await service.register({
      username: '  NewReader  ',
      email: '  NewReader@Example.com  ',
      password: 'reader-password',
    });

    expect(response).toEqual({
      id: expect.any(Number),
      username: 'NewReader',
      email: 'NewReader@Example.com',
      role: 'viewer',
    });
    expect(Object.keys(response).sort()).toEqual([
      'email',
      'id',
      'role',
      'username',
    ]);

    const persisted = repository.findById(response.id);
    expect(persisted).toMatchObject({
      username: 'NewReader',
      email: 'NewReader@Example.com',
      role: 'viewer',
      enabled: true,
    });
    expect(persisted?.passwordHash).not.toBe('reader-password');
    await expect(
      passwordHasher.verify(
        persisted?.passwordHash ?? '',
        'reader-password',
      ),
    ).resolves.toBe(true);
    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('hashedPassword');
  });

  it('propagates normalized username and email conflicts without adding an account', async () => {
    await service.register({
      username: 'ExistingReader',
      email: 'existing@example.com',
      password: 'reader-password',
    });

    await expect(
      service.register({
        username: '  existingreader ',
        email: 'different@example.com',
        password: 'reader-password',
      }),
    ).rejects.toThrow('Username or email already exists');
    await expect(
      service.register({
        username: 'different-reader',
        email: ' EXISTING@example.com ',
        password: 'reader-password',
      }),
    ).rejects.toThrow('Username or email already exists');

    expect(repository.count()).toBe(1);
  });

  it('logs in with a trimmed, case-insensitive username and returns only the public response', async () => {
    const user = await createAccount('CaseSensitiveReader');

    const response = await service.login({
      username: '  casesensitivereader  ',
      password: 'reader-password',
    });

    expect(response).toEqual({
      accessToken: expect.any(String),
      user: {
        id: user.id,
        username: 'CaseSensitiveReader',
        email: 'casesensitivereader@example.test',
        role: 'viewer',
      },
    });
    expect(Object.keys(response).sort()).toEqual(['accessToken', 'user']);
    expect(Object.keys(response.user).sort()).toEqual([
      'email',
      'id',
      'role',
      'username',
    ]);
    expect(response).not.toHaveProperty('password');
    expect(response).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('hashedPassword');
    expect(response).not.toHaveProperty('iat');
    expect(response).not.toHaveProperty('exp');

    const claims = await jwtService.verifyAsync<Record<string, unknown>>(
      response.accessToken,
      { secret: TEST_JWT_SECRET },
    );
    expect(claims.sub).toBe(String(user.id));
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
    expect(Number(claims.exp) - Number(claims.iat)).toBe(60 * 60);
  });

  it('does not authenticate by email and uses the same generic 401 for invalid credentials or a disabled user', async () => {
    const enabledUser = await createAccount('KnownReader');
    const disabledUser = await createAccount('DisabledReader');
    database.run(
      'UPDATE auth_users SET enabled = 0 WHERE id = ?',
      disabledUser.id,
    );

    const attempts = await Promise.all(
      [
        { username: 'MissingReader', password: 'reader-password' },
        { username: 'reader@example.test', password: 'reader-password' },
        { username: 'KnownReader', password: 'wrong-password' },
        { username: 'DisabledReader', password: 'reader-password' },
      ].map(async (credentials) => {
        try {
          await service.login(credentials);
          return undefined;
        } catch (error) {
          if (!(error instanceof UnauthorizedException)) {
            throw error;
          }

          return { status: error.getStatus(), message: error.message };
        }
      }),
    );

    expect(attempts).toEqual(
      Array.from({ length: 4 }, () => ({
        status: 401,
        message: INVALID_CREDENTIALS_MESSAGE,
      })),
    );
    expect(repository.findById(enabledUser.id)?.enabled).toBe(true);
  });

  it('uses a configured JWT lifetime', async () => {
    const user = await createAccount('ConfiguredReader');
    const configuredService = new AuthService(
      repository,
      passwordHasher,
      jwtService,
      new ConfigService({ JWT_EXPIRES_IN: '2h' }),
    );

    const response = await configuredService.login({
      username: 'ConfiguredReader',
      password: 'reader-password',
    });
    const claims = await jwtService.verifyAsync<Record<string, unknown>>(
      response.accessToken,
      { secret: TEST_JWT_SECRET },
    );

    expect(claims.sub).toBe(String(user.id));
    expect(Number(claims.exp) - Number(claims.iat)).toBe(2 * 60 * 60);
  });

  async function createAccount(username: string) {
    return repository.create({
      username,
      email: `${username.toLowerCase()}@example.test`,
      passwordHash: await passwordHasher.hash('reader-password'),
      role: 'viewer',
      enabled: true,
    });
  }
});
