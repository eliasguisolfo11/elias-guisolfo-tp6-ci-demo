import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TracksRepository } from './tracks.repository.js';
import type { TrackRepositoryRow, TrackSearchPage } from './tracks.repository.js';
import { CreateTrackDto } from './dto/create-track.dto.js';
import { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';
import { UpdateTrackDto } from './dto/update-track.dto.js';
import type { Track } from './entities/track.entity.js';

@Injectable()
export class TracksService {
  constructor(private readonly tracksRepository: TracksRepository) {}

  findAll(skip = 0, limit = 100): Track[] {
    return this.tracksRepository.page(skip, limit);
  }

  search(
    query: SearchTracksQueryDto = new SearchTracksQueryDto(),
  ): TrackSearchPage {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException(
        'El precio mínimo no puede superar el máximo.',
      );
    }

    if (
      query.minDuration !== undefined &&
      query.maxDuration !== undefined &&
      query.minDuration > query.maxDuration
    ) {
      throw new BadRequestException(
        'La duración mínima no puede superar la máxima.',
      );
    }

    const normalizedQuery = Object.assign(new SearchTracksQueryDto(), query, {
      skip: query.skip ?? 0,
      limit: query.limit ?? 100,
      sort: query.sort ?? 'Name',
      order: query.order?.toLowerCase() ?? 'asc',
    });

    return this.tracksRepository.search(normalizedQuery);
  }

  create(createTrackDto: CreateTrackDto): Track {
    this.validateReferences(createTrackDto);
    return this.tracksRepository.insert(createTrackDto);
  }

  findOne(id: number | string): Track {
    const track = this.tracksRepository.findById(id);
    if (track === null) {
      throw new NotFoundException('Pista no encontrada.');
    }

    return track;
  }

  update(id: number | string, updateTrackDto: UpdateTrackDto): Track {
    const patch: Partial<
      Pick<
        TrackRepositoryRow,
        | 'Name'
        | 'AlbumId'
        | 'GenreId'
        | 'MediaTypeId'
        | 'Composer'
        | 'Milliseconds'
        | 'Bytes'
        | 'UnitPrice'
      >
    > = {};

    if (updateTrackDto.Name !== undefined) {
      patch.Name = updateTrackDto.Name;
    }
    if (updateTrackDto.AlbumId !== undefined) {
      patch.AlbumId = updateTrackDto.AlbumId;
    }
    if (updateTrackDto.GenreId !== undefined) {
      patch.GenreId = updateTrackDto.GenreId;
    }
    if (updateTrackDto.MediaTypeId !== undefined) {
      patch.MediaTypeId = updateTrackDto.MediaTypeId;
    }
    if (updateTrackDto.Composer !== undefined) {
      patch.Composer = updateTrackDto.Composer;
    }
    if (updateTrackDto.Milliseconds !== undefined) {
      patch.Milliseconds = updateTrackDto.Milliseconds;
    }
    if (updateTrackDto.Bytes !== undefined) {
      patch.Bytes = updateTrackDto.Bytes;
    }
    if (updateTrackDto.UnitPrice !== undefined) {
      patch.UnitPrice = updateTrackDto.UnitPrice;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        'Debe enviar al menos un campo actualizable.',
      );
    }

    this.findOne(id);
    this.validateReferences(patch);

    const updatedTrack = this.tracksRepository.patch(id, patch);
    if (updatedTrack === null) {
      throw new NotFoundException('Pista no encontrada.');
    }

    return updatedTrack;
  }

  remove(id: number | string): void {
    const removed = this.tracksRepository.remove(id);
    if (!removed) {
      throw new NotFoundException('Pista no encontrada.');
    }
  }

  private validateReferences(references: {
    AlbumId?: number | null;
    GenreId?: number | null;
    MediaTypeId?: number;
  }): void {
    if (
      references.AlbumId !== undefined &&
      references.AlbumId !== null &&
      !this.tracksRepository.albumExists(references.AlbumId)
    ) {
      throw new BadRequestException('El álbum indicado no existe.');
    }

    if (
      references.GenreId !== undefined &&
      references.GenreId !== null &&
      !this.tracksRepository.genreExists(references.GenreId)
    ) {
      throw new BadRequestException('El género indicado no existe.');
    }

    if (
      references.MediaTypeId !== undefined &&
      !this.tracksRepository.mediaTypeExists(references.MediaTypeId)
    ) {
      throw new BadRequestException('El tipo de medio indicado no existe.');
    }
  }
}
