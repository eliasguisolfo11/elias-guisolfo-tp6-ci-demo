import { ApiProperty } from '@nestjs/swagger';
import { Artist } from '../../artists/entities/artist.entity.js';

export class Album {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del álbum.',
  })
  AlbumId!: number;

  @ApiProperty({
    example: 'For Those About To Rock We Salute You',
    description: 'Título del álbum.',
  })
  Title!: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador de su artista.',
  })
  ArtistId!: number;

  @ApiProperty({
    type: () => Artist,
    description: 'Artista asociado al álbum.',
  })
  Artist!: Artist;
}
