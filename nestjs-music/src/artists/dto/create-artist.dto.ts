import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString } from 'class-validator';

export class CreateArtistDto {
  @ApiProperty({ example: 'AC/DC' })
  @IsDefined({ message: 'El campo Name es obligatorio.' })
  @IsString({ message: 'El campo Name debe ser una cadena de texto.' })
  Name!: string;
}
