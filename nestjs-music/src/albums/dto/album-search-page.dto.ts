import { ApiProperty } from '@nestjs/swagger';
import { Album } from '../entities/album.entity.js';

export class AlbumSearchPageDto {
  @ApiProperty({
    type: () => Album,
    isArray: true,
    description: 'Álbumes de la página, con su artista público.',
  })
  items!: Album[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Cantidad total de coincidencias antes de paginar.',
  })
  total!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Cantidad de resultados omitidos.',
  })
  skip!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 100,
    description: 'Cantidad máxima de resultados solicitados.',
  })
  limit!: number;

  @ApiProperty({ description: 'Indica si existen coincidencias después de esta página.' })
  hasMore!: boolean;
}
