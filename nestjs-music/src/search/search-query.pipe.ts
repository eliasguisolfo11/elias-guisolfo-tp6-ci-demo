import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';

type QueryDtoConstructor<T extends object> = new () => T;

export const trackSearchQueryParameters = [
  'skip',
  'limit',
  'sort',
  'order',
  'text',
  'genre',
  'artist',
  'minPrice',
  'maxPrice',
  'minDuration',
  'maxDuration',
] as const;

export const albumSearchQueryParameters = [
  'skip',
  'limit',
  'sort',
  'order',
  'text',
  'artist',
] as const;

function isQueryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValidationError(error: ValidationError): string {
  return Object.values(error.constraints ?? {}).join(' ') || 'Valor inválido.';
}

function compareNonNegativeDecimals(left: string, right: string): number | undefined {
  const decimalPattern = /^(\d+)(?:\.(\d+))?$/;
  const leftParts = decimalPattern.exec(left);
  const rightParts = decimalPattern.exec(right);

  if (!leftParts || !rightParts) {
    return undefined;
  }

  const leftInteger = leftParts[1].replace(/^0+(?=\d)/, '');
  const rightInteger = rightParts[1].replace(/^0+(?=\d)/, '');

  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length > rightInteger.length ? 1 : -1;
  }

  if (leftInteger !== rightInteger) {
    return leftInteger > rightInteger ? 1 : -1;
  }

  const leftFraction = leftParts[2] ?? '';
  const rightFraction = rightParts[2] ?? '';
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeftFraction = leftFraction.padEnd(fractionLength, '0');
  const normalizedRightFraction = rightFraction.padEnd(fractionLength, '0');

  if (normalizedLeftFraction === normalizedRightFraction) {
    return 0;
  }

  return normalizedLeftFraction > normalizedRightFraction ? 1 : -1;
}

export class SearchQueryPipe<T extends object> implements PipeTransform<unknown, T> {
  private readonly allowedParameters: ReadonlySet<string>;

  constructor(
    private readonly queryDto: QueryDtoConstructor<T>,
    allowedParameters: readonly string[],
  ) {
    this.allowedParameters = new Set(allowedParameters);
  }

  transform(value: unknown): T {
    if (!isQueryRecord(value)) {
      throw new BadRequestException('Los parámetros de búsqueda deben ser escalares.');
    }

    for (const [parameter, parameterValue] of Object.entries(value)) {
      if (!this.allowedParameters.has(parameter)) {
        throw new BadRequestException(
          `El parámetro de búsqueda "${parameter}" no está permitido.`,
        );
      }

      if (typeof parameterValue !== 'string') {
        throw new BadRequestException(
          `El parámetro de búsqueda "${parameter}" debe enviarse una sola vez como escalar.`,
        );
      }
    }

    if (
      this.allowedParameters.has('minPrice') &&
      this.allowedParameters.has('maxPrice') &&
      typeof value.minPrice === 'string' &&
      typeof value.maxPrice === 'string' &&
      compareNonNegativeDecimals(value.minPrice, value.maxPrice) === 1
    ) {
      throw new BadRequestException('El precio mínimo no puede superar el máximo.');
    }

    const query = plainToInstance(this.queryDto, value);
    const errors = validateSync(query, { forbidUnknownValues: true });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Los parámetros de búsqueda no son válidos.',
        errors: errors.map((error) => ({
          field: error.property,
          message: describeValidationError(error),
        })),
      });
    }

    return query;
  }
}
