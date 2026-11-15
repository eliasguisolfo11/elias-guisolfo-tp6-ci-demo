import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
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

function trimSearchText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeOrder(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

export class SearchAlbumsQueryDto {
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
    enum: ['Title', 'ArtistName'],
    default: 'Title',
    description: 'Campo de orden permitido para Albums.',
  })
  @IsIn(['Title', 'ArtistName'], {
    message: 'sort no es un campo permitido para Albums.',
  })
  sort = 'Title';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description: 'Dirección del orden; no distingue mayúsculas.',
  })
  @Transform(({ value }) => normalizeOrder(value))
  @IsIn(['asc', 'desc'], { message: 'order debe ser asc o desc.' })
  order = 'asc';

  @ApiPropertyOptional({ description: 'Coincidencia parcial en el título del álbum.' })
  @Transform(({ value }) => trimSearchText(value))
  @IsString({ message: 'text debe ser texto.' })
  @IsNotEmpty({ message: 'text no puede estar vacío.' })
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({ description: 'Coincidencia parcial en el nombre del artista.' })
  @Transform(({ value }) => trimSearchText(value))
  @IsString({ message: 'artist debe ser texto.' })
  @IsNotEmpty({ message: 'artist no puede estar vacío.' })
  @IsOptional()
  artist?: string;
}
