import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE_METADATA_KEY } from './public.decorator.js';
import { ROLES_METADATA_KEY } from './roles.decorator.js';
import type { AuthenticatedRequest } from './bearer-auth.guard.js';
import type { AuthUserRole } from './auth-user.entity.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<readonly AuthUserRole[]>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) {
      return false;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user !== undefined && roles.includes(request.user.role);
  }
}
