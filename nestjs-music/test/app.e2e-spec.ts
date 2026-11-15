import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types.js';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import request from 'supertest';
import {
  authenticatedRequest,
  getAuthTestContext,
  viewerRequest,
} from './helpers/auth-test-context.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { resolve } from 'node:path';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { createTemporaryAuthDatabase } from './helpers/temp-auth-database.js';

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('usa una copia temporal y no el catálogo versionado', () => {
    const databasePath = process.env.DATABASE_PATH;
    const databaseList = app
      .get(DatabaseService)
      .get<{ file: string }>('PRAGMA database_list');

    expect(databasePath).toContain('chinook-test-');
    expect(databasePath).not.toBe(resolve(process.cwd(), 'data/chinook.db'));
    expect(databaseList?.file).toBe(databasePath);
  });

  it('inicializa bases aisladas de reservas y coordinación en rutas distintas', () => {
    const databasePath = process.env.RESERVATIONS_DATABASE_PATH;
    const coordinationDatabasePath =
      process.env.RESERVATIONS_COORDINATION_DATABASE_PATH;
    const configuredDatabasePaths = [
      process.env.DATABASE_PATH,
      process.env.AUTH_DATABASE_PATH,
      databasePath,
      coordinationDatabasePath,
    ];

    expect(coordinationDatabasePath).toContain(
      'reservations-coordination-test-',
    );
    expect(coordinationDatabasePath).not.toBe(
      resolve(process.cwd(), 'data/reservations-coordination.db'),
    );
    expect(databasePath).toContain('reservations-test-');
    expect(databasePath).not.toBe(resolve(process.cwd(), 'data/reservations.db'));
    expect(databasePath).not.toBe(resolve(process.cwd(), 'data/chinook.db'));
    expect(process.env.AUTH_DATABASE_PATH).toBe(getAuthTestContext().path);
    expect(configuredDatabasePaths.every((path) => path !== undefined)).toBe(
      true,
    );
    expect(new Set(configuredDatabasePaths).size).toBe(4);
    expect(existsSync(databasePath!)).toBe(true);
    expect(existsSync(coordinationDatabasePath!)).toBe(true);

    const reservationsDatabase = new Database(databasePath!, {
      fileMustExist: true,
    });
    try {
      expect(reservationsDatabase.pragma('foreign_keys')).toEqual([
        { foreign_keys: 1 },
      ]);
      expect(
        reservationsDatabase
          .prepare<[], { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
          .all()
          .map(({ name }) => name),
      ).toEqual(expect.arrayContaining(['slots', 'reservations', 'payments']));
      expect(
        reservationsDatabase
          .prepare<[], { starts_at: string; capacity: number }>(
            'SELECT starts_at, capacity FROM slots ORDER BY starts_at_utc',
          )
          .all(),
      ).toEqual([
        { starts_at: '2026-12-15T10:00:00-03:00', capacity: 4 },
        { starts_at: '2026-12-15T12:00:00-03:00', capacity: 4 },
        { starts_at: '2026-12-15T14:00:00-03:00', capacity: 4 },
      ]);
    } finally {
      reservationsDatabase.close();
    }
  });

  it('ejecuta el bootstrap admin al iniciar con una base auth vacía', async () => {
    const temporaryAuthDatabase = createTemporaryAuthDatabase();
    const previousEnvironment = {
      AUTH_DATABASE_PATH: process.env.AUTH_DATABASE_PATH,
      AUTH_BOOTSTRAP_ADMIN_USERNAME: process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME,
      AUTH_BOOTSTRAP_ADMIN_EMAIL: process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL,
      AUTH_BOOTSTRAP_ADMIN_PASSWORD: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
    };
    let bootstrapApp: INestApplication<App> | undefined;

    process.env.AUTH_DATABASE_PATH = temporaryAuthDatabase.path;
    process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = 'startup-admin';
    process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL = 'startup-admin@example.test';
    process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD = 'startup-only-password';

    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      bootstrapApp = moduleFixture.createNestApplication();
      await bootstrapApp.init();

      const repository = bootstrapApp.get(AuthRepository);
      expect(repository.count()).toBe(1);
      expect(repository.findByUsername('startup-admin')).toMatchObject({
        username: 'startup-admin',
        email: 'startup-admin@example.test',
        role: 'admin',
        enabled: true,
      });
    } finally {
      await bootstrapApp?.close();
      temporaryAuthDatabase.cleanup();
      restoreEnvironmentVariable(
        'AUTH_DATABASE_PATH',
        previousEnvironment.AUTH_DATABASE_PATH,
      );
      restoreEnvironmentVariable(
        'AUTH_BOOTSTRAP_ADMIN_USERNAME',
        previousEnvironment.AUTH_BOOTSTRAP_ADMIN_USERNAME,
      );
      restoreEnvironmentVariable(
        'AUTH_BOOTSTRAP_ADMIN_EMAIL',
        previousEnvironment.AUTH_BOOTSTRAP_ADMIN_EMAIL,
      );
      restoreEnvironmentVariable(
        'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
        previousEnvironment.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
      );
    }
  });

  it('requiere Bearer tanto para la raíz como para las escrituras', async () => {
    const unauthenticatedRead = await request(app.getHttpServer())
      .get('/')
      .expect(401);

    expect(unauthenticatedRead.headers['www-authenticate']).toBe('Bearer');
    expect(unauthenticatedRead.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });

    await authenticatedRequest(app).get('/').expect(200);

    const response = await request(app.getHttpServer())
      .post('/albums')
      .send({})
      .expect(401);

    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });
  });

  it('rechaza el token vigente de una cuenta deshabilitada', async () => {
    const disabledToken = getAuthTestContext().createDisabledUserToken();
    const response = await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${disabledToken}`)
      .expect(401);

    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toEqual({
      code: 401,
      message: 'Se requieren credenciales válidas.',
    });
  });
  it('/ (GET)', () => {
    return viewerRequest(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', /application\/json/)
      .expect({ message: 'API del catálogo Chinook' });
  });

  it('devuelve un error genérico en español para JSON malformado', async () => {
    const response = await authenticatedRequest(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"dato":')
      .expect('Content-Type', /application\/json/)
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El cuerpo de la solicitud no es un JSON válido.',
    });
    expect(response.text).not.toContain('Unexpected');
    expect(response.text).not.toContain('{"dato":');
  });

  it('normaliza otros mensajes de sintaxis de JSON malformado', async () => {
    const response = await authenticatedRequest(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"dato":"texto sin cerrar')
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El cuerpo de la solicitud no es un JSON válido.',
    });
    expect(response.text).not.toContain('Unterminated string');
    expect(response.text).not.toContain('texto sin cerrar');
  });

  it('oculta el mensaje del parser para JSON inválido multilínea', async () => {
    const malformedBody = '{\n  "dato": invalid\n}';
    const response = await authenticatedRequest(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(malformedBody)
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'El cuerpo de la solicitud no es un JSON válido.',
    });
    expect(response.text).not.toContain('Unexpected token');
    expect(response.text).not.toContain('invalid');
    expect(response.text).not.toContain(malformedBody);
  });
  it('devuelve un 415 seguro en español para charset no compatible', async () => {
    const response = await authenticatedRequest(app)
      .post('/')
      .set('Content-Type', 'application/json; charset=x-invalid-codification')
      .send('{"dato":"ok"}')
      .expect(415);

    expect(response.body).toEqual({
      code: 415,
      message: 'La codificación del cuerpo de la solicitud no es compatible.',
    });
    expect(response.text).not.toContain('x-invalid-codification');
    expect(response.text).not.toContain('unsupported charset');
  });

  it('devuelve un 413 en español si el cuerpo supera el límite', async () => {
    const largeBody = `{"dato":"${'x'.repeat(110 * 1024)}"}`;
    const response = await authenticatedRequest(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(largeBody)
      .expect(413);

    expect(response.body).toEqual({
      code: 413,
      message: 'El cuerpo de la solicitud excede el tamaño permitido.',
    });
    expect(response.text).not.toContain(largeBody);
  });

  it('devuelve un 400 seguro para un parámetro de ruta con URI inválido', async () => {
    const response = await authenticatedRequest(app)
      .get('/albums/%FF')
      .expect(400);

    expect(response.body).toEqual({
      code: 400,
      message: 'La ruta solicitada contiene una codificación inválida.',
    });
    expect(response.text).not.toContain('URIError');
    expect(response.text).not.toContain('Failed to decode');
    expect(response.text).not.toContain('%FF');
  });
  it('devuelve un 404 en español para una ruta desconocida', async () => {
    const response = await authenticatedRequest(app)
      .get('/ruta-inexistente')
      .expect(404);

    expect(response.body).toEqual({
      code: 404,
      message: 'La ruta solicitada no existe.',
    });
    expect(response.text).not.toContain('Cannot GET');
  });
});
