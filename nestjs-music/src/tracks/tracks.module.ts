import { Module } from '@nestjs/common';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import { SearchQueryPipe, trackSearchQueryParameters } from '../search/search-query.pipe.js';
import { TracksController } from './tracks.controller.js';
import { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';
import { TracksRepository } from './tracks.repository.js';
import { TracksService } from './tracks.service.js';

@Module({
  controllers: [TracksController],
  providers: [
    TracksService,
    TracksRepository,
    ParseIdPipe,
    {
      provide: SearchQueryPipe,
      useFactory: () =>
        new SearchQueryPipe(
          SearchTracksQueryDto,
          trackSearchQueryParameters,
        ),
    },
  ],
})
export class TracksModule {}
