import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GenresRepository } from './genres.repository.js';
import { CreateGenreDto } from './dto/create-genre.dto.js';
import { UpdateGenreDto } from './dto/update-genre.dto.js';
import type { Genre } from './entities/genre.entity.js';

@Injectable()
export class GenresService {
  constructor(private readonly genresRepository: GenresRepository) {}

  findAll(skip = 0, limit = 100): Genre[] {
    return this.genresRepository.page(skip, limit);
  }

  create(createGenreDto: CreateGenreDto): Genre {
    const { Name } = createGenreDto;
    if (Name === undefined) {
      throw new BadRequestException({
        message: 'El campo Name es obligatorio.',
        errors: [
          { field: 'Name', message: 'El campo Name es obligatorio.' },
        ],
      });
    }

    return this.genresRepository.insert({ Name });
  }

  findOne(id: number | string): Genre {
    const genre = this.genresRepository.findById(id);
    if (genre === null) {
      throw new NotFoundException('Género no encontrado.');
    }

    return genre;
  }

  update(id: number | string, updateGenreDto: UpdateGenreDto): Genre {
    const { Name } = updateGenreDto;
    if (Name === undefined) {
      throw new BadRequestException(
        'Debe enviar al menos un campo actualizable.',
      );
    }

    const genre = this.genresRepository.patch(id, { Name });
    if (genre === null) {
      throw new NotFoundException('Género no encontrado.');
    }

    return genre;
  }

  remove(id: number | string): void {
    const removed = this.genresRepository.remove(id);
    if (!removed) {
      throw new NotFoundException('Género no encontrado.');
    }
  }
}
