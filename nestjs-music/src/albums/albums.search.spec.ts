import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlbumsRepository,
  type AlbumSearchPage,
} from './albums.repository.js';
import { AlbumsService } from './albums.service.js';
import { ArtistsRepository } from '../artists/artists.repository.js';
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';

type AlbumsSearchRepositoryMock = {
  search: ReturnType<typeof vi.fn>;
};

const emptyPage: AlbumSearchPage = {
  items: [],
  total: 0,
  skip: 0,
  limit: 100,
  hasMore: false,
};

function makeQuery(
  overrides: Partial<SearchAlbumsQueryDto> = {},
): SearchAlbumsQueryDto {
  return Object.assign(new SearchAlbumsQueryDto(), overrides);
}

async function transformQuery(
  input: Record<string, string>,
): Promise<SearchAlbumsQueryDto> {
  const transformed: unknown = await new ValidationPipe({ transform: true }).transform(
    input,
    {
      type: 'query',
      metatype: SearchAlbumsQueryDto,
      data: 'search',
    },
  );

  if (!(transformed instanceof SearchAlbumsQueryDto)) {
    throw new Error('El pipe no transformó la consulta de búsqueda de álbumes.');
  }

  return transformed;
}

describe('AlbumsService.search', () => {
  let service: AlbumsService;
  let moduleRef: TestingModule;
  let repository: AlbumsSearchRepositoryMock;

  beforeEach(async () => {
    repository = { search: vi.fn().mockReturnValue(emptyPage) };
    moduleRef = await Test.createTestingModule({
      providers: [
        AlbumsService,
        { provide: AlbumsRepository, useValue: repository },
        { provide: ArtistsRepository, useValue: { findById: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AlbumsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('aplica los defaults de orden y página antes de delegar', () => {
    expect(service.search()).toBe(emptyPage);
    expect(repository.search).toHaveBeenCalledWith({
      skip: 0,
      limit: 100,
      sort: 'Title',
      order: 'asc',
    });
  });

  it('delega al repository los filtros y argumentos normalizados por el DTO', async () => {
    const query = await transformQuery({
      text: '  álbum con espacios  ',
      artist: '  AC/DC  ',
      sort: 'ArtistName',
      order: 'DESC',
      skip: '3',
      limit: '8',
    });

    expect(service.search(query)).toBe(emptyPage);
    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'álbum con espacios',
        artist: 'AC/DC',
        sort: 'ArtistName',
        order: 'desc',
        skip: 3,
        limit: 8,
      }),
    );
    expect(repository.search).toHaveBeenCalledOnce();
  });

  it('combina título y artista delegando la consulta completa sin filtrar filas', () => {
    const query = makeQuery({ text: 'Live', artist: 'AC/DC' });

    expect(service.search(query)).toBe(emptyPage);
    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Live', artist: 'AC/DC' }),
    );
    expect(repository.search).toHaveBeenCalledOnce();
  });
});
