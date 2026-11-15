import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthDatabaseService } from '../../src/auth/auth-database.service.js';
import { AuthRepository } from '../../src/auth/auth.repository.js';
import { createTemporaryAuthDatabase } from './temp-auth-database.js';

export const AUTH_TEST_JWT_SECRET = 'nestjs-music-e2e-secret';

export interface AuthTestContext {
  readonly path: string;
  readonly accessToken: string;
  readonly adminAccessToken: string;
  readonly viewerAccessToken: string;
  createDisabledUserToken(): string;
  createAdditionalViewerToken(): string;
  cleanup(): void;
}

type AuthTestGlobal = typeof globalThis & {
  __nestjsMusicAuthTestContext?: AuthTestContext;
};

export function createAuthTestContext(): AuthTestContext {
  const temporaryDatabase = createTemporaryAuthDatabase();
  const database = new AuthDatabaseService(
    new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
  );
  const repository = new AuthRepository(database);
  const jwtService = new JwtService({ secret: AUTH_TEST_JWT_SECRET });
  let disabledUserSequence = 0;

  const fixtureUser = repository.create({
    username: 'e2e-viewer',
    email: 'e2e-viewer@example.test',
    passwordHash: 'e2e-only-fixture-hash',
    role: 'viewer',
    enabled: true,
  });
  const adminUser = repository.create({
    username: 'e2e-admin',
    email: 'e2e-admin@example.test',
    passwordHash: 'e2e-only-fixture-hash',
    role: 'admin',
    enabled: true,
  });
  let additionalViewerSequence = 0;
  const viewerAccessToken = jwtService.sign({ sub: String(fixtureUser.id) });
  const adminAccessToken = jwtService.sign({ sub: String(adminUser.id) });

  const context: AuthTestContext = {
    path: temporaryDatabase.path,
    accessToken: adminAccessToken,
    adminAccessToken,
    viewerAccessToken,
    createDisabledUserToken() {
      disabledUserSequence += 1;
      const user = repository.create({
        username: `e2e-disabled-${disabledUserSequence}`,
        email: `e2e-disabled-${disabledUserSequence}@example.test`,
        passwordHash: 'e2e-only-fixture-hash',
        role: 'viewer',
        enabled: true,
      });
      database.run('UPDATE auth_users SET enabled = 0 WHERE id = ?', user.id);

      return jwtService.sign({ sub: String(user.id) });
    },
    createAdditionalViewerToken() {
      additionalViewerSequence += 1;
      const user = repository.create({
        username: `e2e-additional-viewer-${additionalViewerSequence}`,
        email: `e2e-additional-viewer-${additionalViewerSequence}@example.test`,
        passwordHash: 'e2e-only-fixture-hash',
        role: 'viewer',
        enabled: true,
      });

      return jwtService.sign({ sub: String(user.id) });
    },
    cleanup() {
      database.onModuleDestroy();
      temporaryDatabase.cleanup();
    },
  };

  (globalThis as AuthTestGlobal).__nestjsMusicAuthTestContext = context;
  return context;
}

export function getAuthTestContext(): AuthTestContext {
  const context = (globalThis as AuthTestGlobal).__nestjsMusicAuthTestContext;
  if (!context) {
    throw new Error('Auth e2e context has not been initialized');
  }

  return context;
}

export function authenticatedRequest(app: INestApplication) {
  return requestWithToken(app, getAuthTestContext().adminAccessToken);
}

export function viewerRequest(
  app: INestApplication,
  accessToken = getAuthTestContext().viewerAccessToken,
) {
  return requestWithToken(app, accessToken);
}

function requestWithToken(app: INestApplication, accessToken: string) {
  const server = app.getHttpServer();
  const authorization = `Bearer ${accessToken}`;

  return {
    get: (path: string) =>
      request(server).get(path).set('Authorization', authorization),
    post: (path: string) =>
      request(server).post(path).set('Authorization', authorization),
    put: (path: string) =>
      request(server).put(path).set('Authorization', authorization),
    patch: (path: string) =>
      request(server).patch(path).set('Authorization', authorization),
    delete: (path: string) =>
      request(server).delete(path).set('Authorization', authorization),
    head: (path: string) =>
      request(server).head(path).set('Authorization', authorization),
    options: (path: string) =>
      request(server).options(path).set('Authorization', authorization),
  };
}
