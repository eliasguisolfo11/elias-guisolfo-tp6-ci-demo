import { Test, TestingModule } from '@nestjs/testing';
import { AlbumsController } from './albums.controller.js';
import { AlbumsRepository } from './albums.repository.js';
import { AlbumsService } from './albums.service.js';
import { ArtistsRepository } from '../artists/artists.repository.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import {
  SearchQueryPipe,
  albumSearchQueryParameters,
} from '../search/search-query.pipe.js';
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';

describe('AlbumsController', () => {
  let controller: AlbumsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [
        AlbumsService,
        { provide: AlbumsRepository, useValue: {} },
        { provide: ArtistsRepository, useValue: {} },
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
    }).compile();

    controller = module.get<AlbumsController>(AlbumsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
