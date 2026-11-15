import { Module } from '@nestjs/common';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import { GenresController } from './genres.controller.js';
import { GenresRepository } from './genres.repository.js';
import { GenresService } from './genres.service.js';

@Module({
  controllers: [GenresController],
  providers: [GenresService, GenresRepository, ParseIdPipe],
})
export class GenresModule {}
