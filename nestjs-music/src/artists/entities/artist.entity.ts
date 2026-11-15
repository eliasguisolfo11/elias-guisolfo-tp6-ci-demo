import { ApiProperty } from '@nestjs/swagger';

export class Artist {
  @ApiProperty({ type: 'integer', example: 1 })
  ArtistId!: number;

  @ApiProperty({ example: 'AC/DC' })
  Name!: string;
}
