import { ApiProperty } from '@nestjs/swagger';

export class TrackAlbum {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del álbum.',
  })
  AlbumId!: number;

  @ApiProperty({ example: 'For Those About To Rock We Salute You', description: 'Título del álbum.' })
  Title!: string;
}

export class TrackGenre {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del género.',
  })
  GenreId!: number;

  @ApiProperty({
    type: String,
    example: 'Rock',
    nullable: true,
    description: 'Nombre del género.',
  })
  Name!: string | null;
}

export class TrackMediaType {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del tipo de medio.',
  })
  MediaTypeId!: number;

  @ApiProperty({ example: 'MPEG audio file', description: 'Nombre del tipo de medio.' })
  Name!: string;
}

export class Track {
  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador de la pista.',
  })
  TrackId!: number;

  @ApiProperty({ example: 'For Those About To Rock', description: 'Nombre de la pista.' })
  Name!: string;

  @ApiProperty({
    type: 'integer',
    example: 1,
    nullable: true,
    description: 'Identificador del álbum; puede ser null.',
  })
  AlbumId!: number | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    nullable: true,
    description: 'Identificador del género; puede ser null.',
  })
  GenreId!: number | null;

  @ApiProperty({
    type: 'integer',
    example: 1,
    description: 'Identificador del tipo de medio.',
  })
  MediaTypeId!: number;

  @ApiProperty({
    type: String,
    example: 'Angus Young, Malcolm Young, Brian Johnson',
    nullable: true,
    description: 'Compositor de la pista; puede ser null.',
  })
  Composer!: string | null;

  @ApiProperty({
    type: 'integer',
    example: 343719,
    description: 'Duración de la pista en milisegundos.',
  })
  Milliseconds!: number;

  @ApiProperty({
    type: 'integer',
    example: 11170334,
    nullable: true,
    description: 'Tamaño de la pista en bytes; puede ser null.',
  })
  Bytes!: number | null;

  @ApiProperty({ example: 0.99, description: 'Precio unitario de la pista.' })
  UnitPrice!: number;

  @ApiProperty({ type: () => TrackAlbum, nullable: true, description: 'Álbum asociado; puede ser null.' })
  Album!: TrackAlbum | null;

  @ApiProperty({ type: () => TrackGenre, nullable: true, description: 'Género asociado; puede ser null.' })
  Genre!: TrackGenre | null;

  @ApiProperty({ type: () => TrackMediaType, description: 'Tipo de medio asociado.' })
  MediaType!: TrackMediaType;
}
