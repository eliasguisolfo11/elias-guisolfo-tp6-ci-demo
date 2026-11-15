import { Module } from '@nestjs/common';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import { ArtistsController } from './artists.controller.js';
import { ArtistsRepository } from './artists.repository.js';
import { ArtistsService } from './artists.service.js';

@Module({
  controllers: [ArtistsController],
  providers: [ArtistsService, ArtistsRepository, ParseIdPipe],
})
export class ArtistsModule {}
