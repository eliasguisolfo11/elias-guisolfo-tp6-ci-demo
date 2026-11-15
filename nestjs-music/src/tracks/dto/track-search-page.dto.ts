import { ApiProperty } from '@nestjs/swagger';
import { Track } from '../entities/track.entity.js';

export class TrackSearchPageDto {
  @ApiProperty({
    type: () => Track,
    isArray: true,
    description: 'Pistas de la página, con sus relaciones públicas.',
  })
  items!: Track[];

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
