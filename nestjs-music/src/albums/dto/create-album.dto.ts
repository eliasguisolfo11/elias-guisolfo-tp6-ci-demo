import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, IsString } from 'class-validator';

export class CreateAlbumDto {
  @ApiProperty({ example: 'For Those About To Rock We Salute You' })
  @IsDefined({ message: 'El campo Title es obligatorio.' })
  @IsString({ message: 'El campo Title debe ser una cadena de texto.' })
  Title!: string;

  @ApiProperty({ type: 'integer', example: 1 })
  @IsDefined({ message: 'El campo ArtistId es obligatorio.' })
  @IsInt({ message: 'El campo ArtistId debe ser un número entero.' })
  ArtistId!: number;
}
