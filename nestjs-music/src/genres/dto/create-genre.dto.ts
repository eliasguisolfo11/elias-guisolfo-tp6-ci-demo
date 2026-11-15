import { ApiProperty } from '@nestjs/swagger';
import { IsString, ValidateIf } from 'class-validator';

export class CreateGenreDto {
  @ApiProperty({
    type: String,
    example: 'Rock',
    nullable: true,
    description: 'Nombre del género; puede ser null.',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: 'El campo Name debe ser una cadena de texto.' })
  Name?: string | null;
}
