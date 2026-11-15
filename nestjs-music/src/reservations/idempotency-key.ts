import { BadRequestException } from '@nestjs/common';

export function validateIdempotencyKey(
  values: readonly string[] | undefined,
): string {
  if (
    values === undefined ||
    values.length !== 1 ||
    values[0] === undefined ||
    values[0].trim().length === 0
  ) {
    throw new BadRequestException(
      'Debe enviar exactamente un encabezado Idempotency-Key no vacío.',
    );
  }

  return values[0];
}
