import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from './public.decorator.js';
import { ROLES_METADATA_KEY, Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  class TestController {
    @Roles('admin', 'viewer')
    read(this: void): void {}

    @Roles('admin')
    write(this: void): void {}

    @Public()
    login(this: void): void {}

    unannotated(this: void): void {}
  }

  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  function createContext(
    handler: Function,
    role: 'admin' | 'viewer' | undefined,
  ): ExecutionContext {
    const request = role ? { user: { role } } : {};

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as unknown as ExecutionContext;
  }

  it('declara viewer y admin como roles permitidos en consultas', () => {
    const roles = Reflect.getMetadata(
      ROLES_METADATA_KEY,
      TestController.prototype.read,
    );

    expect(roles).toEqual(['admin', 'viewer']);
  });

  it('declara admin como rol permitido en escrituras', () => {
    const roles = Reflect.getMetadata(
      ROLES_METADATA_KEY,
      TestController.prototype.write,
    );

    expect(roles).toEqual(['admin']);
  });

  it.each(['admin', 'viewer'] as const)(
    'permite al rol %s en una operación de consulta',
    (role) => {
      expect(
        guard.canActivate(createContext(TestController.prototype.read, role)),
      ).toBe(true);
    },
  );

  it('rechaza a viewer en una operación que requiere admin', () => {
    expect(
      guard.canActivate(createContext(TestController.prototype.write, 'viewer')),
    ).toBe(false);
  });

  it('permite a admin en una operación que requiere admin', () => {
    expect(
      guard.canActivate(createContext(TestController.prototype.write, 'admin')),
    ).toBe(true);
  });

  it('falla cerrado cuando una ruta protegida no declara roles', () => {
    expect(
      guard.canActivate(
        createContext(TestController.prototype.unannotated, 'admin'),
      ),
    ).toBe(false);
  });

  it('omite el control de roles en una ruta pública', () => {
    expect(
      guard.canActivate(createContext(TestController.prototype.login, undefined)),
    ).toBe(true);
  });
});
