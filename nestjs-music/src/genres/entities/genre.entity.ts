import { ApiProperty } from '@nestjs/swagger';

export class Genre {
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
