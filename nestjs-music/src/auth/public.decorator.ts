import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE_METADATA_KEY = 'isPublic';

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_ROUTE_METADATA_KEY, true);
}
