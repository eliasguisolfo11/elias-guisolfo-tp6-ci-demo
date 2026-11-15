import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ValidationError } from 'class-validator';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import {
  authenticatedRequest,
  getAuthTestContext,
  viewerRequest,
} from './helpers/auth-test-context.js';

describe('Authentication and authorization edge cases (e2e)', () => {
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

  it('returns 401 for a protected route when the Bearer token is missing', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = app.get(JwtService).sign(
      { sub: '1' },
      { expiresIn: -1 },
    );

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('returns 401 for a token with an invalid signature', async () => {
    const token = new JwtService({ secret: 'different-e2e-secret' }).sign({
      sub: '1',
    });

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('returns 401 for a disabled account even when its token is active', async () => {
    const token = getAuthTestContext().createDisabledUserToken();

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('returns 403 for a viewer attempting an admin-only registration without writing an account', async () => {
    const countBefore = repository.count();

    await viewerRequest(app)
      .post('/auth/register')
      .send({
        username: 'forbidden-admin-reader',
        email: 'forbidden-admin@example.test',
        password: 'reader-password',
      })
      .expect(403);

    expect(repository.count()).toBe(countBefore);
  });

  it('uses the same generic login failure message for an unknown username and an incorrect password', async () => {
    await authenticatedRequest(app)
      .post('/auth/register')
      .send({
        username: 'LoginFailureReader',
        email: 'login-failure@example.test',
        password: 'reader-password',
      })
      .expect(201);

    const attempts = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'unknown-login-reader', password: 'reader-password' }),
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'LoginFailureReader', password: 'wrong-password' }),
    ]);

    expect(attempts.map((response) => response.status)).toEqual([401, 401]);
    expect(attempts.map((response) => response.body.message)).toEqual([
      'Se requieren credenciales válidas.',
      'Se requieren credenciales válidas.',
    ]);
  });
});
