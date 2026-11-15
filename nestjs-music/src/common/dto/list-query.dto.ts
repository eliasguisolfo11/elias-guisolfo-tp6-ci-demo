import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

function convertDigitString(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return value;
  }

  const convertedValue = Number(value);
  return Number.isSafeInteger(convertedValue)
    ? convertedValue
    : Number.MAX_SAFE_INTEGER;
}

export class ListQueryDto {
  @Transform(({ value }) => convertDigitString(value))
  @IsInt({ message: 'skip debe ser un entero.' })
  @Min(0, { message: 'skip debe ser mayor o igual a 0.' })
  skip = 0;

  @Transform(({ value }) => convertDigitString(value))
  @IsInt({ message: 'limit debe ser un entero.' })
  @Min(1, { message: 'limit debe ser mayor o igual a 1.' })
  limit = 100;
}
