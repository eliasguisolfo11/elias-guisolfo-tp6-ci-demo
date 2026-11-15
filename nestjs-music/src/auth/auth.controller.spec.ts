import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { PUBLIC_ROUTE_METADATA_KEY } from './public.decorator.js';
import { ROLES_METADATA_KEY } from './roles.decorator.js';
import type { AuthService } from './auth.service.js';

describe('AuthController', () => {
  it('exposes login as the public POST /auth/login route with HTTP 200', () => {
    const handler = getHandler('login');
    const reflector = new Reflector();

    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('login');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(1);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    expect(
      reflector.get<boolean>(PUBLIC_ROUTE_METADATA_KEY, handler),
    ).toBe(true);
  });

  it('exposes registration as an admin-only POST /auth/register route', () => {
    const handler = getHandler('register');
    const reflector = new Reflector();

    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('register');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(1);
    expect(reflector.get<readonly string[]>(ROLES_METADATA_KEY, handler)).toEqual(
      ['admin'],
    );
  });

  it('delegates registration input to the service and returns its public response', async () => {
    const response = {
      id: 17,
      username: 'reader',
      email: 'reader@example.com',
      role: 'viewer' as const,
    };
    const register = vi.fn().mockResolvedValue(response);
    const login = vi.fn();
    const controller = new AuthController({ register, login } as unknown as AuthService);

    await expect(
      controller.register({
        username: 'reader',
        email: 'reader@example.com',
        password: 'reader-password',
      }),
    ).resolves.toEqual(response);
    expect(register).toHaveBeenCalledWith({
      username: 'reader',
      email: 'reader@example.com',
      password: 'reader-password',
    });
  });

  it('delegates login credentials to the service', async () => {
    const response = {
      accessToken: 'signed.jwt.token',
      user: {
        id: 17,
        username: 'reader',
        email: 'reader@example.com',
        role: 'viewer' as const,
      },
    };
    const login = vi.fn().mockResolvedValue(response);
    const controller = new AuthController({
      register: vi.fn(),
      login,
    } as unknown as AuthService);
    const credentials = {
      username: 'reader',
      password: 'reader-password',
    };

    await expect(controller.login(credentials)).resolves.toEqual(response);
    expect(login).toHaveBeenCalledWith(credentials);
  });
});

function getHandler(name: 'login' | 'register'): Function {
  const handler = Object.getOwnPropertyDescriptor(
    AuthController.prototype,
    name,
  )?.value;
  if (typeof handler !== 'function') {
    throw new Error(`AuthController.${name} handler was not defined`);
  }

  return handler;
}
