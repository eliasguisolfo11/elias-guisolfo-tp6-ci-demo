import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArtistsRepository } from './artists.repository.js';
import { CreateArtistDto } from './dto/create-artist.dto.js';
import { UpdateArtistDto } from './dto/update-artist.dto.js';
import type { Artist } from './entities/artist.entity.js';

@Injectable()
export class ArtistsService {
  constructor(private readonly artistsRepository: ArtistsRepository) {}

  findAll(skip = 0, limit = 100): Artist[] {
    return this.artistsRepository.page(skip, limit);
  }

  create(createArtistDto: CreateArtistDto): Artist {
    return this.artistsRepository.insert(createArtistDto);
  }

  findOne(id: number | string): Artist {
    const artist = this.artistsRepository.findById(id);
    if (artist === null) {
      throw new NotFoundException('Artista no encontrado.');
    }

    return artist;
  }

  update(id: number | string, updateArtistDto: UpdateArtistDto): Artist {
    const { Name } = updateArtistDto;
    if (Name === undefined) {
      throw new BadRequestException(
        'Debe enviar al menos un campo actualizable.',
      );
    }

    const artist = this.artistsRepository.patch(id, { Name });
    if (artist === null) {
      throw new NotFoundException('Artista no encontrado.');
    }

    return artist;
  }

  remove(id: number | string): void {
    const removed = this.artistsRepository.remove(id);
    if (!removed) {
      throw new NotFoundException('Artista no encontrado.');
    }
  }
}
