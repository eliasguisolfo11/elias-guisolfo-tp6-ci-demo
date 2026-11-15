import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuthRepository } from './auth.repository.js';
import { AuthUser } from './auth-user.entity.js';
import { BearerAuthGuard } from './bearer-auth.guard.js';
import { PUBLIC_ROUTE_METADATA_KEY, Public } from './public.decorator.js';

describe('BearerAuthGuard', () => {
  let guard: BearerAuthGuard;
  let moduleRef: TestingModule;
  let verifyAsync: ReturnType<typeof vi.fn>;
  let getConfig: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;

  const enabledUser = new AuthUser(
    1,
    'test-viewer',
    'test-viewer',
    'viewer@example.test',
    'viewer@example.test',
    'test-hash',
    'viewer',
    true,
  );

  beforeEach(async () => {
    verifyAsync = vi.fn().mockResolvedValue({ sub: '1' });
    getConfig = vi.fn().mockReturnValue('test-secret');
    findById = vi.fn().mockReturnValue(enabledUser);

    moduleRef = await Test.createTestingModule({
      providers: [
        BearerAuthGuard,
        Reflector,
        { provide: JwtService, useValue: { verifyAsync } },
        { provide: ConfigService, useValue: { get: getConfig } },
        { provide: AuthRepository, useValue: { findById } },
      ],
    }).compile();

    guard = moduleRef.get(BearerAuthGuard);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  function createContext(
    method: string,
    authorization?: string,
    handler: () => void = () => undefined,
    controller: Function = class {},
  ) {
    const request: {
      method: string;
      headers: { authorization?: string };
      user?: { id: number; role: 'admin' | 'viewer'; enabled: boolean };
    } = {
      method,
      headers: { authorization },
    };
    const response = { setHeader: vi.fn() };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getHandler: () => handler,
      getClass: () => controller,
    } as unknown as ExecutionContext;

    return { context, request, response };
  }

  async function expectUnauthorized(method: string, authorization?: string) {
    const { context, response } = createContext(method, authorization);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer',
    );
  }

  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE'])(
    'rechaza %s sin token con el challenge Bearer',
    async (method) => {
      await expectUnauthorized(method);
    },
  );

  it('permite sin token solo un handler con metadata pública', async () => {
    const target = {};
    const handler = () => undefined;
    Public()(target, 'login', { value: handler });
    const { context, response } = createContext('POST', undefined, handler);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(Reflect.getMetadata(PUBLIC_ROUTE_METADATA_KEY, handler)).toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('rechaza un token con firma inválida', async () => {
    verifyAsync.mockRejectedValueOnce(new Error('invalid signature'));

    await expectUnauthorized('GET', 'Bearer invalid-token');
  });

  it('rechaza un token vencido', async () => {
    verifyAsync.mockRejectedValueOnce(new Error('jwt expired'));

    await expectUnauthorized('GET', 'Bearer expired-token');
  });

  it('recarga la cuenta por sub y adjunta la cuenta habilitada al request', async () => {
    const { context, request } = createContext('GET', 'Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret: 'test-secret',
    });
    expect(findById).toHaveBeenCalledWith(1);
    expect(request.user).toEqual({ id: 1, role: 'viewer', enabled: true });
  });

  it('rechaza el token si no encuentra la cuenta del sub', async () => {
    findById.mockReturnValueOnce(undefined);

    await expectUnauthorized('GET', 'Bearer valid-token');

    expect(findById).toHaveBeenCalledWith(1);
  });

  it('rechaza el token de una cuenta deshabilitada', async () => {
    findById.mockReturnValueOnce(
      new AuthUser(
        1,
        'disabled-viewer',
        'disabled-viewer',
        'disabled@example.test',
        'disabled@example.test',
        'test-hash',
        'viewer',
        false,
      ),
    );

    await expectUnauthorized('GET', 'Bearer active-token');
  });

  it('rechaza un token sin un sub de identificador válido', async () => {
    verifyAsync.mockResolvedValueOnce({ sub: 'unknown' });

    await expectUnauthorized('GET', 'Bearer malformed-sub-token');

    expect(findById).not.toHaveBeenCalled();
  });

  it('verifica usando JWT_SECRET exactamente como está configurado', async () => {
    const configuredSecret = '  test-secret  ';
    getConfig.mockReturnValueOnce(configuredSecret);
    const { context } = createContext('POST', 'Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret: configuredSecret,
    });
  });

  it('falla cerrado si JWT_SECRET contiene solo espacios', async () => {
    getConfig.mockReturnValueOnce('   ');

    await expectUnauthorized('POST', 'Bearer valid-token');

    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('falla cerrado si no está configurado JWT_SECRET', async () => {
    getConfig.mockReturnValueOnce(undefined);

    await expectUnauthorized('POST', 'Bearer valid-token');

    expect(verifyAsync).not.toHaveBeenCalled();
  });
});
