import { Module } from '@nestjs/common';
import { ArtistsRepository } from '../artists/artists.repository.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import {
  SearchQueryPipe,
  albumSearchQueryParameters,
} from '../search/search-query.pipe.js';
import { AlbumsService } from './albums.service.js';
import { AlbumsController } from './albums.controller.js';
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';
import { AlbumsRepository } from './albums.repository.js';

@Module({
  controllers: [AlbumsController],
  providers: [
    AlbumsService,
    AlbumsRepository,
    ArtistsRepository,
    ParseIdPipe,
    {
      provide: SearchQueryPipe,
      useFactory: () =>
        new SearchQueryPipe(
          SearchAlbumsQueryDto,
          albumSearchQueryParameters,
        ),
    },
  ],
})
export class AlbumsModule {}
