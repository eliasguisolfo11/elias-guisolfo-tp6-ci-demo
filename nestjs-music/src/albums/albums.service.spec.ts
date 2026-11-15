import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AlbumsRepository } from './albums.repository.js';
import { AlbumsService } from './albums.service.js';
import { UpdateAlbumDto } from './dto/update-album.dto.js';
import { ArtistsRepository } from '../artists/artists.repository.js';
import type { AlbumRepositoryRow } from './albums.repository.js';

describe('AlbumsService', () => {
  let service: AlbumsService;
  let albumsRepository: {
    page: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let artistsRepository: { findById: ReturnType<typeof vi.fn> };

  const existingAlbum: AlbumRepositoryRow = {
    AlbumId: 1,
    Title: 'For Those About To Rock We Salute You',
    ArtistId: 1,
    Artist: { ArtistId: 1, Name: 'AC/DC' },
  };

  beforeEach(async () => {
    albumsRepository = {
      page: vi.fn(),
      findById: vi.fn().mockReturnValue(existingAlbum),
      insert: vi.fn(),
      patch: vi.fn(),
      remove: vi.fn(),
    };
    artistsRepository = { findById: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlbumsService,
        { provide: AlbumsRepository, useValue: albumsRepository },
        { provide: ArtistsRepository, useValue: artistsRepository },
      ],
    }).compile();

    service = module.get<AlbumsService>(AlbumsService);
  });

  it('returns 404 when the album does not exist', () => {
    albumsRepository.findById.mockReturnValue(null);

    expect(() => service.findOne(0)).toThrow(NotFoundException);
  });

  it('returns 404 when patching an album that does not exist', () => {
    albumsRepository.findById.mockReturnValue(null);
    albumsRepository.patch.mockReturnValue(null);

    expect(() => service.update(404, { Title: 'Updated title' })).toThrow(
      NotFoundException,
    );
    expect(albumsRepository.findById).toHaveBeenCalledWith(404);
    expect(albumsRepository.patch).not.toHaveBeenCalled();
  });

  it('checks the album before its ArtistId when patching a missing album', () => {
    albumsRepository.findById.mockReturnValue(null);
    artistsRepository.findById.mockReturnValue(null);

    expect(() => service.update(404, { ArtistId: 404 })).toThrow(
      NotFoundException,
    );
    expect(albumsRepository.findById).toHaveBeenCalledWith(404);
    expect(artistsRepository.findById).not.toHaveBeenCalled();
    expect(albumsRepository.patch).not.toHaveBeenCalled();
  });

  it('returns 404 when deleting an album that does not exist', () => {
    albumsRepository.remove.mockReturnValue(false);

    expect(() => service.remove(404)).toThrow(NotFoundException);
  });

  it('rejects an empty patch without writing', () => {
    expect(() => service.update(1, {})).toThrow(BadRequestException);
    expect(albumsRepository.patch).not.toHaveBeenCalled();
  });

  it('rejects a missing ArtistId without inserting', () => {
    artistsRepository.findById.mockReturnValue(null);

    expect(() =>
      service.create({ Title: 'New album', ArtistId: 404 }),
    ).toThrow(BadRequestException);
    expect(albumsRepository.insert).not.toHaveBeenCalled();
  });

  it('checks the album before rejecting a missing ArtistId in a patch', () => {
    const lookupOrder: string[] = [];
    albumsRepository.findById.mockImplementation(() => {
      lookupOrder.push('album');
      return existingAlbum;
    });
    artistsRepository.findById.mockImplementation(() => {
      lookupOrder.push('artist');
      return null;
    });

    expect(() => service.update(1, { ArtistId: 404 })).toThrow(
      BadRequestException,
    );
    expect(lookupOrder).toEqual(['album', 'artist']);
    expect(albumsRepository.findById).toHaveBeenCalledWith(1);
    expect(artistsRepository.findById).toHaveBeenCalledWith(404);
    expect(albumsRepository.patch).not.toHaveBeenCalled();
  });

  it('preserves fields omitted from a partial patch', () => {
    const updatedAlbum: AlbumRepositoryRow = {
      ...existingAlbum,
      Title: 'Updated title',
    };
    albumsRepository.patch.mockReturnValue(updatedAlbum);

    expect(service.update(1, { Title: 'Updated title' })).toEqual(updatedAlbum);
    expect(albumsRepository.patch).toHaveBeenCalledWith(1, {
      Title: 'Updated title',
    });
  });

  it.each([
    ['Title', { Title: null }],
    ['ArtistId', { ArtistId: null }],
  ])('rejects null %s as a bad request without writing', async (_field, body) => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: UpdateAlbumDto,
        data: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(albumsRepository.patch).not.toHaveBeenCalled();
    expect(albumsRepository.insert).not.toHaveBeenCalled();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
