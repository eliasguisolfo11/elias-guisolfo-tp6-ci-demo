import { ApiProperty } from '@nestjs/swagger';
import {
  IsDefined,
  IsInt,
  IsNumber,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateTrackDto {
  @ApiProperty({ example: 'For Those About To Rock', description: 'Nombre de la pista.' })
  @IsDefined({ message: 'El campo Name es obligatorio.' })
  @IsString({ message: 'El campo Name debe ser una cadena de texto.' })
  Name!: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    nullable: true,
    required: false,
    description: 'Identificador del álbum; puede ser null.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt({ message: 'El campo AlbumId debe ser un número entero.' })
  AlbumId?: number | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del tipo de medio.',
  })
  @IsDefined({ message: 'El campo MediaTypeId es obligatorio.' })
  @IsInt({ message: 'El campo MediaTypeId debe ser un número entero.' })
  MediaTypeId!: number;

  @ApiProperty({
    type: 'integer',
    example: 1,
    nullable: true,
    required: false,
    description: 'Identificador del género; puede ser null.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt({ message: 'El campo GenreId debe ser un número entero.' })
  GenreId?: number | null;

  @ApiProperty({
    type: String,
    example: 'Angus Young, Malcolm Young, Brian Johnson',
    nullable: true,
    required: false,
    description: 'Compositor de la pista; puede ser null.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: 'El campo Composer debe ser una cadena de texto.' })
  Composer?: string | null;

  @ApiProperty({
    type: 'integer',
    example: 343719,
    description: 'Duración de la pista en milisegundos.',
  })
  @IsDefined({ message: 'El campo Milliseconds es obligatorio.' })
  @IsInt({ message: 'El campo Milliseconds debe ser un número entero.' })
  Milliseconds!: number;

  @ApiProperty({
    type: 'integer',
    example: 11170334,
    nullable: true,
    required: false,
    description: 'Tamaño de la pista en bytes; puede ser null.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt({ message: 'El campo Bytes debe ser un número entero.' })
  Bytes?: number | null;

  @ApiProperty({ example: 0.99, description: 'Precio unitario de la pista.' })
  @IsDefined({ message: 'El campo UnitPrice es obligatorio.' })
  @IsNumber({}, { message: 'El campo UnitPrice debe ser un número.' })
  UnitPrice!: number;
}
