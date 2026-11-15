import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types.js';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { AuthDatabaseService } from '../src/auth/auth-database.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import {
  AUTH_TEST_JWT_SECRET,
  authenticatedRequest,
  viewerRequest,
} from './helpers/auth-test-context.js';

describe('Auth registration (e2e)', () => {
  let app: INestApplication<App>;
  let repository: AuthRepository;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (validationErrors: ValidationError[]) =>
          new BadRequestException({
            message: 'Los datos enviados no son válidos.',
            errors: validationErrors.map((error) => ({
              field: error.property,
              message: Object.values(error.constraints ?? {}).join(' '),
            })),
          }),
      }),
    );
    await app.init();
    repository = app.get(AuthRepository);
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows only an authenticated admin to create a persisted enabled viewer with a public response', async () => {
    const response = await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: '  RegisteredReader  ',
        email: '  RegisteredReader@Example.test  ',
        password: 'reader-password',
      })
      .expect(201);

    expect(response.body).toEqual({
      id: expect.any(Number),
      username: 'RegisteredReader',
      email: 'RegisteredReader@Example.test',
      role: 'viewer',
    });
    expect(Object.keys(response.body).sort()).toEqual([
      'email',
      'id',
      'role',
      'username',
    ]);
    expect(response.text).not.toContain('reader-password');
    expect(response.text).not.toContain('passwordHash');
    expect(response.text).not.toContain('hashedPassword');
    expect(response.text).not.toContain(AUTH_TEST_JWT_SECRET);
    expect(repository.findById(response.body.id)).toMatchObject({
      username: 'RegisteredReader',
      email: 'RegisteredReader@Example.test',
      role: 'viewer',
      enabled: true,
    });
  });

  it('rejects registration without authentication or with a viewer token without writing', async () => {
    const countBefore = repository.count();
    const body = {
      username: 'forbidden-reader',
      email: 'forbidden@example.test',
      password: 'reader-password',
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(body)
      .expect(401);
    await viewerRequest(app)
      .post('/auth/register')
      .send(body)
      .expect(403);

    expect(repository.count()).toBe(countBefore);
  });

  it.each([
    ['admin', 'admin'],
    ['viewer', 'viewer'],
    ['null', null],
    ['boolean', false],
  ])('rejects any supplied role field (%s) instead of silently stripping it', async (_case, role) => {
    const countBefore = repository.count();

    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'chosen-role-reader',
        email: 'chosen-role@example.test',
        password: 'reader-password',
        role,
      })
      .expect(400);

    expect(repository.count()).toBe(countBefore);
  });

  it.each([
    ['missing username', { email: 'reader@example.test', password: 'reader-password' }],
    ['missing email', { username: 'reader', password: 'reader-password' }],
    ['missing password', { username: 'reader', email: 'reader@example.test' }],
    ['null username', { username: null, email: 'reader@example.test', password: 'reader-password' }],
    ['null email', { username: 'reader', email: null, password: 'reader-password' }],
    ['null password', { username: 'reader', email: 'reader@example.test', password: null }],
    ['username with the wrong type', { username: 7, email: 'reader@example.test', password: 'reader-password' }],
    ['email with the wrong type', { username: 'reader', email: ['reader@example.test'], password: 'reader-password' }],
    ['password with the wrong type', { username: 'reader', email: 'reader@example.test', password: true }],
    ['username empty after trimming', { username: '   ', email: 'reader@example.test', password: 'reader-password' }],
    ['username longer than 50 characters', { username: 'u'.repeat(51), email: 'reader@example.test', password: 'reader-password' }],
    ['invalid email', { username: 'reader', email: 'not-an-email', password: 'reader-password' }],
    ['email longer than 254 characters', { username: 'reader', email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`, password: 'reader-password' }],
    ['password shorter than 8 characters', { username: 'reader', email: 'reader@example.test', password: 'short' }],
    ['password containing only whitespace', { username: 'reader', email: 'reader@example.test', password: '        ' }],
  ])('rejects %s with 400 and no account write', async (_case, body) => {
    const countBefore = repository.count();

    await authenticatedRequest(app)
      .post('/auth/register')
      .send(body)
      .expect(400);

    expect(repository.count()).toBe(countBefore);
  });

  it('accepts the username, email, and password boundary values', async () => {
    const username = 'u'.repeat(50);
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;

    expect(username).toHaveLength(50);
    expect(email).toHaveLength(254);
    const response = await authenticatedRequest(app)
      .post('/auth/register')
      .send({ username, email, password: '12345678' })
      .expect(201);

    expect(response.body).toMatchObject({ username, email, role: 'viewer' });
  });

  it.each([
    ['username', 'DuplicateReader', 'first@example.test', ' duplicatereader ', 'second@example.test'],
    ['email', 'FirstReader', 'Duplicate@Example.test', 'second-reader', ' duplicate@example.TEST '],
  ])('returns 409 for a normalized duplicate %s without adding an account', async (_field, firstUsername, firstEmail, secondUsername, secondEmail) => {
    const firstResponse = await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: firstUsername,
        email: firstEmail,
        password: 'reader-password',
      })
      .expect(201);
    const countAfterFirst = repository.count();

    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: secondUsername,
        email: secondEmail,
        password: 'reader-password',
      })
      .expect(409);

    expect(repository.count()).toBe(countAfterFirst);
    expect(repository.findById(firstResponse.body.id)).toMatchObject({
      role: 'viewer',
      enabled: true,
    });
  });
});

describe('Auth login (e2e)', () => {
  let app: INestApplication<App>;
  let repository: AuthRepository;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (validationErrors: ValidationError[]) =>
          new BadRequestException({
            message: 'Los datos enviados no son válidos.',
            errors: validationErrors.map((error) => ({
              field: error.property,
              message: Object.values(error.constraints ?? {}).join(' '),
            })),
          }),
      }),
    );
    await app.init();
    repository = app.get(AuthRepository);
  });

  afterEach(async () => {
    await app.close();
  });

  it('authenticates a normalized username and omits password, hash, and separate iat/exp fields from the public response', async () => {
    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'LoginReader',
        email: 'login-reader@example.test',
        password: 'reader-password',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: '  loginreader  ', password: 'reader-password' })
      .expect(200);

    expect(response.body).toEqual({
      accessToken: expect.any(String),
      user: {
        id: expect.any(Number),
        username: 'LoginReader',
        email: 'login-reader@example.test',
        role: 'viewer',
      },
    });
    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'user']);
    expect(Object.keys(response.body.user).sort()).toEqual([
      'email',
      'id',
      'role',
      'username',
    ]);
    expect(response.text).not.toContain('reader-password');
    expect(response.text).not.toContain('passwordHash');
    expect(response.text).not.toContain('hashedPassword');
    expect(response.text).not.toContain('JWT_SECRET');
    expect(response.text).not.toContain(AUTH_TEST_JWT_SECRET);
    expect(response.body).not.toHaveProperty('iat');
    expect(response.body).not.toHaveProperty('exp');

    const claims = await app
      .get(JwtService)
      .verifyAsync<Record<string, unknown>>(response.body.accessToken);
    expect(claims.sub).toBe(String(response.body.user.id));
    expect(typeof claims.exp).toBe('number');
    expect(typeof claims.iat).toBe('number');
  });

  it('returns the same generic 401 for unknown, email-as-username, incorrect-password, and disabled accounts', async () => {
    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'KnownLoginReader',
        email: 'known-login-reader@example.test',
        password: 'reader-password',
      })
      .expect(201);
    const disabledResponse = await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'DisabledLoginReader',
        email: 'disabled-login-reader@example.test',
        password: 'reader-password',
      })
      .expect(201);
    app.get(AuthDatabaseService).run(
      'UPDATE auth_users SET enabled = 0 WHERE id = ?',
      disabledResponse.body.id,
    );

    const beforeCount = repository.count();
    const attempts = await Promise.all(
      [
        { username: 'MissingLoginReader', password: 'reader-password' },
        { username: 'known-login-reader@example.test', password: 'reader-password' },
        { username: 'KnownLoginReader', password: 'wrong-password' },
        { username: 'DisabledLoginReader', password: 'reader-password' },
      ].map(({ username, password }) =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ username, password }),
      ),
    );

    for (const response of attempts) {
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Se requieren credenciales válidas.');
      expect(response.body).not.toHaveProperty('accessToken');
    }
    expect(new Set(attempts.map((response) => response.body.message)).size).toBe(1);
    expect(repository.count()).toBe(beforeCount);
  });

  it.each([
    ['missing username', { password: 'reader-password' }],
    ['missing password', { username: 'reader' }],
    ['null username', { username: null, password: 'reader-password' }],
    ['null password', { username: 'reader', password: null }],
    ['username with a wrong type', { username: 7, password: 'reader-password' }],
    ['password with a wrong type', { username: 'reader', password: true }],
    ['empty username', { username: '', password: 'reader-password' }],
    ['whitespace-only username', { username: '   ', password: 'reader-password' }],
    ['empty password', { username: 'reader', password: '' }],
    ['whitespace-only password', { username: 'reader', password: '   ' }],
  ])('rejects %s with 400 without creating an account', async (_case, body) => {
    const beforeCount = repository.count();

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(400);

    expect(response.body).not.toHaveProperty('accessToken');
    expect(repository.count()).toBe(beforeCount);
  });

  it('completes two valid login requests concurrently', async () => {
    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'ConcurrentLoginReader',
        email: 'concurrent-login-reader@example.test',
        password: 'reader-password',
      })
      .expect(201);

    const login = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'ConcurrentLoginReader', password: 'reader-password' });
    const responses = await Promise.all([login(), login()]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.every((response) => typeof response.body.accessToken === 'string')).toBe(true);
  });

  it.each([
    [
      'username',
      { username: 'ConcurrentRegisterReader', email: 'first-register@example.test' },
      { username: ' concurrentregisterreader ', email: 'second-register@example.test' },
    ],
    [
      'email',
      { username: 'first-register-reader', email: 'ConcurrentRegister@Example.test' },
      { username: 'second-register-reader', email: ' concurrentregister@example.TEST ' },
    ],
  ] as const)(
    'returns one 201 and one 409 for concurrent registrations with a duplicate normalized %s and persists one row',
    async (_key, firstInput, secondInput) => {
      const countBefore = repository.count();
      const register = (body: { username: string; email: string }) =>
        authenticatedRequest(app)
          .post('/auth/register')
          .send({ ...body, password: 'reader-password' });

      const responses = await Promise.all([
        register(firstInput),
        register(secondInput),
      ]);

      expect(
        responses
          .map((response) => response.status)
          .sort((first, second) => first - second),
      ).toEqual([201, 409]);
      expect(repository.count()).toBe(countBefore + 1);

      const createdResponse = responses.find((response) => response.status === 201);
      expect(createdResponse?.body).toMatchObject({
        id: expect.any(Number),
        role: 'viewer',
      });
      expect(repository.findById(createdResponse?.body.id)).toMatchObject({
        enabled: true,
        role: 'viewer',
      });
    },
  );
});
