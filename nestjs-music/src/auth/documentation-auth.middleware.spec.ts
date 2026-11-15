import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRepository } from './auth.repository.js';
import { DocumentationAuthMiddleware } from './documentation-auth.middleware.js';

describe('DocumentationAuthMiddleware', () => {
  const secret = '  original-jwt-secret  ';
  let verifyAsync: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let middleware: DocumentationAuthMiddleware;

  beforeEach(() => {
    verifyAsync = vi.fn();
    findById = vi.fn();
    middleware = new DocumentationAuthMiddleware(
      { verifyAsync } as unknown as JwtService,
      new ConfigService({ JWT_SECRET: secret }),
      { findById } as unknown as AuthRepository,
    );
  });

  it('rejects a request without a bearer token', async () => {
    const { request, response, responseMocks, next } = createRequest();

    await middleware.use(request, response, next);

    expectUnauthorized(responseMocks);
    expect(verifyAsync).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with an invalid signature', async () => {
    verifyAsync.mockRejectedValue(new Error('Invalid signature'));
    const { request, response, responseMocks, next } =
      createRequest('invalid-token');

    await middleware.use(request, response, next);

    expectUnauthorized(responseMocks);
    expect(verifyAsync).toHaveBeenCalledWith('invalid-token', { secret });
    expect(findById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token for an enabled account using the configured secret unchanged', async () => {
    verifyAsync.mockResolvedValue({ sub: '42' });
    findById.mockReturnValue({ id: 42, enabled: true });
    const { request, response, responseMocks, next } =
      createRequest('valid-token');

    await middleware.use(request, response, next);

    expect(verifyAsync).toHaveBeenCalledWith('valid-token', { secret });
    expect(findById).toHaveBeenCalledWith(42);
    expect(next).toHaveBeenCalledOnce();
    expect(responseMocks.status).not.toHaveBeenCalled();
  });

  it.each([
    ['a nonexistent account', undefined],
    ['a disabled account', { id: 42, enabled: false }],
  ])('rejects a valid token for %s', async (_description, account) => {
    verifyAsync.mockResolvedValue({ sub: '42' });
    findById.mockReturnValue(account);
    const { request, response, responseMocks, next } =
      createRequest('valid-token');

    await middleware.use(request, response, next);

    expectUnauthorized(responseMocks);
    expect(findById).toHaveBeenCalledWith(42);
    expect(next).not.toHaveBeenCalled();
  });
});

function createRequest(token?: string) {
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: '/docs',
  } as Request;
  const responseMocks = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const response = responseMocks as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;

  return { request, response, responseMocks, next };
}

function expectUnauthorized(
  responseMocks: ReturnType<typeof createRequest>['responseMocks'],
): void {
  expect(responseMocks.setHeader).toHaveBeenCalledWith(
    'WWW-Authenticate',
    'Bearer',
  );
  expect(responseMocks.status).toHaveBeenCalledWith(401);
  expect(responseMocks.json).toHaveBeenCalledWith({
    code: 401,
    message: 'Se requieren credenciales válidas.',
  });
}
