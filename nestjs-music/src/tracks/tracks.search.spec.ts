import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TracksRepository, type TrackSearchPage } from './tracks.repository.js';
import { TracksService } from './tracks.service.js';
import { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';

type TracksSearchRepositoryMock = {
  search: ReturnType<typeof vi.fn>;
};

const emptyPage: TrackSearchPage = {
  items: [],
  total: 0,
  skip: 0,
  limit: 100,
  hasMore: false,
};

function makeQuery(
  overrides: Partial<SearchTracksQueryDto> = {},
): SearchTracksQueryDto {
  return Object.assign(new SearchTracksQueryDto(), overrides);
}

async function transformQuery(
  input: Record<string, string>,
): Promise<SearchTracksQueryDto> {
  const transformed: unknown = await new ValidationPipe({ transform: true }).transform(
    input,
    {
      type: 'query',
      metatype: SearchTracksQueryDto,
      data: 'search',
    },
  );

  if (!(transformed instanceof SearchTracksQueryDto)) {
    throw new Error('El pipe no transformó la consulta de búsqueda de pistas.');
  }

  return transformed;
}

describe('TracksService.search', () => {
  let service: TracksService;
  let moduleRef: TestingModule;
  let repository: TracksSearchRepositoryMock;

  beforeEach(async () => {
    repository = { search: vi.fn().mockReturnValue(emptyPage) };
    moduleRef = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: TracksRepository, useValue: repository },
      ],
    }).compile();
    service = moduleRef.get(TracksService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('aplica los defaults de orden y página antes de delegar', () => {
    expect(service.search()).toBe(emptyPage);
    expect(repository.search).toHaveBeenCalledWith({
      skip: 0,
      limit: 100,
      sort: 'Name',
      order: 'asc',
    });
  });

  it('delega al repository los argumentos normalizados por el DTO', async () => {
    const query = await transformQuery({
      text: '  T6 texto con espacios  ',
      genre: '  Jazz  ',
      artist: '  T6 artista  ',
      sort: 'UnitPrice',
      order: 'DESC',
      skip: '3',
      limit: '8',
      minPrice: '0.99',
      maxPrice: '2.50',
      minDuration: '500',
      maxDuration: '2500',
    });

    expect(service.search(query)).toBe(emptyPage);
    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'T6 texto con espacios',
        genre: 'Jazz',
        artist: 'T6 artista',
        sort: 'UnitPrice',
        order: 'desc',
        skip: 3,
        limit: 8,
        minPrice: 0.99,
        maxPrice: 2.5,
        minDuration: 500,
        maxDuration: 2500,
      }),
    );
  });

  it.each([
    ['precio con solo mínimo', { minPrice: 0.99 }],
    ['precio con solo máximo', { maxPrice: 1.99 }],
    ['duración con solo mínimo', { minDuration: 500 }],
    ['duración con solo máximo', { maxDuration: 2500 }],
    ['precio con extremos iguales', { minPrice: 0.99, maxPrice: 0.99 }],
    [
      'duración con extremos iguales',
      { minDuration: 500, maxDuration: 500 },
    ],
  ] as const)(
    'acepta %s',
    (_description, range) => {
      expect(service.search(makeQuery(range))).toBe(emptyPage);
      expect(repository.search).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['precio', { minPrice: 1, maxPrice: 0.99 }],
    ['duración', { minDuration: 501, maxDuration: 500 }],
  ] as const)(
    'responde HTTP 400 si el rango de %s está invertido',
    (_field, range) => {
      expect(() => service.search(makeQuery(range))).toThrow(
        BadRequestException,
      );
      expect(repository.search).not.toHaveBeenCalled();
    },
  );
});
