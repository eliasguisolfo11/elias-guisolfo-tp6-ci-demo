import { SetMetadata } from '@nestjs/common';
import type { AuthUserRole } from './auth-user.entity.js';

export const ROLES_METADATA_KEY = 'roles';

export function Roles(
  ...roles: AuthUserRole[]
): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}
