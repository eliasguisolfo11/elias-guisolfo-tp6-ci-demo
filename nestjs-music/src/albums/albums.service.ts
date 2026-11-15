import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArtistsRepository } from '../artists/artists.repository.js';
import { AlbumsRepository } from './albums.repository.js';
import type { AlbumRepositoryRow, AlbumSearchPage } from './albums.repository.js';
import { CreateAlbumDto } from './dto/create-album.dto.js';
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';
import { UpdateAlbumDto } from './dto/update-album.dto.js';

@Injectable()
export class AlbumsService {
  constructor(
    private readonly albumsRepository: AlbumsRepository,
    private readonly artistsRepository: ArtistsRepository,
  ) {}

  create(createAlbumDto: CreateAlbumDto): AlbumRepositoryRow {
    if (this.artistsRepository.findById(createAlbumDto.ArtistId) === null) {
      throw new BadRequestException('El artista indicado no existe.');
    }

    return this.albumsRepository.insert(createAlbumDto);
  }

  findAll(skip = 0, limit = 100): AlbumRepositoryRow[] {
    return this.albumsRepository.page(skip, limit);
  }

  search(
    query: SearchAlbumsQueryDto = new SearchAlbumsQueryDto(),
  ): AlbumSearchPage {
    const normalizedQuery = Object.assign(new SearchAlbumsQueryDto(), query, {
      skip: query.skip ?? 0,
      limit: query.limit ?? 100,
      sort: query.sort ?? 'Title',
      order: query.order?.toLowerCase() ?? 'asc',
    });

    return this.albumsRepository.search(normalizedQuery);
  }

  findOne(id: number | string): AlbumRepositoryRow {
    const album = this.albumsRepository.findById(id);
    if (album === null) {
      throw new NotFoundException('Álbum no encontrado.');
    }

    return album;
  }

  update(id: number | string, updateAlbumDto: UpdateAlbumDto): AlbumRepositoryRow {
    const patch: Partial<Pick<AlbumRepositoryRow, 'Title' | 'ArtistId'>> = {};
    if (updateAlbumDto.Title !== undefined) {
      patch.Title = updateAlbumDto.Title;
    }
    if (updateAlbumDto.ArtistId !== undefined) {
      patch.ArtistId = updateAlbumDto.ArtistId;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo actualizable.',
      );
    }

    this.findOne(id);

    if (
      patch.ArtistId !== undefined &&
      this.artistsRepository.findById(patch.ArtistId) === null
    ) {
      throw new BadRequestException('El artista indicado no existe.');
    }

    const album = this.albumsRepository.patch(id, patch);
    if (album === null) {
      throw new NotFoundException('Álbum no encontrado.');
    }

    return album;
  }

  remove(id: number | string): void {
    const removed = this.albumsRepository.remove(id);
    if (!removed) {
      throw new NotFoundException('Álbum no encontrado.');
    }
  }
}
