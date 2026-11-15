import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function convertNonNegativeInteger(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return value;
  }

  const convertedValue = Number(value);
  if (!Number.isFinite(convertedValue) || !Number.isInteger(convertedValue)) {
    return value;
  }

  return BigInt(convertedValue) === BigInt(value) ? convertedValue : value;
}

function convertNonNegativeDecimal(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }

  const convertedValue = Number(value);
  return Number.isFinite(convertedValue) ? convertedValue : value;
}

function trimSearchText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeOrder(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

export class SearchTracksQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
    description: 'Cantidad de resultados a omitir; admite enteros seguros.',
  })
  @Transform(({ value }) => convertNonNegativeInteger(value))
  @IsInt({ message: 'skip debe ser un entero.' })
  @Min(0, { message: 'skip debe ser mayor o igual a 0.' })
  @Max(Number.MAX_SAFE_INTEGER, {
    message: 'skip no debe superar Number.MAX_SAFE_INTEGER.',
  })
  skip = 0;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    default: 100,
    description: 'Cantidad de resultados; admite entre 1 y 100.',
  })
  @Transform(({ value }) => convertNonNegativeInteger(value))
  @IsInt({ message: 'limit debe ser un entero.' })
  @Min(1, { message: 'limit debe ser mayor o igual a 1.' })
  @Max(100, { message: 'limit debe ser menor o igual a 100.' })
  limit = 100;

  @ApiPropertyOptional({
    enum: ['Name', 'UnitPrice', 'Milliseconds'],
    default: 'Name',
    description: 'Campo de orden permitido para Tracks.',
  })
  @IsIn(['Name', 'UnitPrice', 'Milliseconds'], {
    message: 'sort no es un campo permitido para Tracks.',
  })
  sort = 'Name';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description: 'Dirección del orden; no distingue mayúsculas.',
  })
  @Transform(({ value }) => normalizeOrder(value))
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order = 'asc';

  @ApiPropertyOptional({ description: 'Coincidencia parcial en el nombre de la pista.' })
  @Transform(({ value }) => trimSearchText(value))
  @IsString({ message: 'text debe ser texto.' })
  @IsNotEmpty({ message: 'text no puede estar vacío.' })
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({ description: 'Coincidencia parcial en el nombre del género.' })
  @Transform(({ value }) => trimSearchText(value))
  @IsString({ message: 'genre debe ser texto.' })
  @IsNotEmpty({ message: 'genre no puede estar vacío.' })
  @IsOptional()
  genre?: string;

  @ApiPropertyOptional({ description: 'Coincidencia parcial en el nombre del artista.' })
  @Transform(({ value }) => trimSearchText(value))
  @IsString({ message: 'artist debe ser texto.' })
  @IsNotEmpty({ message: 'artist no puede estar vacío.' })
  @IsOptional()
  artist?: string;

  @ApiPropertyOptional({
    type: 'number',
    minimum: 0,
    description: 'Precio mínimo inclusivo; admite decimales no negativos.',
  })
  @Transform(({ value }) => convertNonNegativeDecimal(value))
  @IsNumber({}, { message: 'minPrice debe ser un número decimal.' })
  @Min(0, { message: 'minPrice debe ser mayor o igual a 0.' })
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional({
    type: 'number',
    minimum: 0,
    description: 'Precio máximo inclusivo; admite decimales no negativos.',
  })
  @Transform(({ value }) => convertNonNegativeDecimal(value))
  @IsNumber({}, { message: 'maxPrice debe ser un número decimal.' })
  @Min(0, { message: 'maxPrice debe ser mayor o igual a 0.' })
  @IsOptional()
  maxPrice?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description: 'Duración mínima inclusiva segura, en milisegundos.',
  })
  @Transform(({ value }) => convertNonNegativeInteger(value))
  @IsInt({ message: 'minDuration debe ser un entero.' })
  @Min(0, { message: 'minDuration debe ser mayor o igual a 0.' })
  @Max(Number.MAX_SAFE_INTEGER, {
    message: 'minDuration no debe superar Number.MAX_SAFE_INTEGER.',
  })
  @IsOptional()
  minDuration?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description: 'Duración máxima inclusiva segura, en milisegundos.',
  })
  @Transform(({ value }) => convertNonNegativeInteger(value))
  @IsInt({ message: 'maxDuration debe ser un entero.' })
  @Min(0, { message: 'maxDuration debe ser mayor o igual a 0.' })
  @Max(Number.MAX_SAFE_INTEGER, {
    message: 'maxDuration no debe superar Number.MAX_SAFE_INTEGER.',
  })
  @IsOptional()
  maxDuration?: number;
}
