import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { TracksRepository } from './tracks.repository.js';
import { TracksService } from './tracks.service.js';
import { CreateTrackDto } from './dto/create-track.dto.js';
import { UpdateTrackDto } from './dto/update-track.dto.js';
import type { Track } from './entities/track.entity.js';

type TracksRepositoryMock = {
  page: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  albumExists: ReturnType<typeof vi.fn>;
  genreExists: ReturnType<typeof vi.fn>;
  mediaTypeExists: ReturnType<typeof vi.fn>;
};

const existingTrack: Track = {
  TrackId: 1,
  Name: 'T17 pista existente',
  AlbumId: 1,
  GenreId: 1,
  MediaTypeId: 1,
  Composer: null,
  Milliseconds: 1000,
  Bytes: null,
  UnitPrice: 0.99,
  Album: { AlbumId: 1, Title: 'T17 álbum' },
  Genre: { GenreId: 1, Name: 'T17 género' },
  MediaType: { MediaTypeId: 1, Name: 'T17 tipo' },
};

const validCreatePayload = {
  Name: 'T17 pista nueva',
  MediaTypeId: 1,
  Milliseconds: 2000,
  UnitPrice: 1.25,
};

describe('TracksService', () => {
  let service: TracksService;
  let moduleRef: TestingModule;
  let repository: TracksRepositoryMock;

  beforeEach(async () => {
    repository = {
      page: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(existingTrack),
      insert: vi.fn().mockReturnValue(existingTrack),
      patch: vi.fn().mockReturnValue(existingTrack),
      remove: vi.fn().mockReturnValue(false),
      albumExists: vi.fn().mockReturnValue(true),
      genreExists: vi.fn().mockReturnValue(true),
      mediaTypeExists: vi.fn().mockReturnValue(true),
    };

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

  it('responde 404 al consultar una pista inexistente', () => {
    repository.findById.mockReturnValue(null);
    expect(() => service.findOne(0)).toThrow(NotFoundException);
    expect(repository.findById).toHaveBeenCalledWith(0);
  });

  it('responde 404 al actualizar una pista inexistente', () => {
    repository.findById.mockReturnValue(null);
    repository.patch.mockReturnValue(null);

    expect(() => service.update(404, { Name: 'Actualizada' })).toThrow(
      NotFoundException,
    );
    expect(repository.findById).toHaveBeenCalledWith(404);
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('prioriza el destino inexistente antes de validar referencias en PATCH', () => {
    repository.findById.mockReturnValue(null);
    repository.albumExists.mockReturnValue(false);
    repository.genreExists.mockReturnValue(false);
    repository.mediaTypeExists.mockReturnValue(false);

    expect(() =>
      service.update(404, {
        AlbumId: 405,
        GenreId: 406,
        MediaTypeId: 407,
      }),
    ).toThrow(NotFoundException);

    expect(repository.findById).toHaveBeenCalledWith(404);
    expect(repository.albumExists).not.toHaveBeenCalled();
    expect(repository.genreExists).not.toHaveBeenCalled();
    expect(repository.mediaTypeExists).not.toHaveBeenCalled();
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('responde 404 al eliminar una pista inexistente', () => {
    expect(() => service.remove(404)).toThrow(NotFoundException);
    expect(repository.remove).toHaveBeenCalledWith(404);
  });

  it('rechaza PATCH vacío sin comprobar referencias ni escribir', () => {
    expect(() => service.update(1, {})).toThrow(BadRequestException);
    expect(repository.patch).not.toHaveBeenCalled();
    expect(repository.albumExists).not.toHaveBeenCalled();
    expect(repository.genreExists).not.toHaveBeenCalled();
    expect(repository.mediaTypeExists).not.toHaveBeenCalled();
  });

  it('rechaza referencias inexistentes al crear sin insertar', () => {
    repository.albumExists.mockReturnValue(false);
    expect(() =>
      service.create({ ...validCreatePayload, AlbumId: 404 }),
    ).toThrow(BadRequestException);
    expect(repository.albumExists).toHaveBeenCalledWith(404);
    expect(repository.insert).not.toHaveBeenCalled();

    repository.albumExists.mockReturnValue(true);
    repository.genreExists.mockReturnValue(false);
    expect(() =>
      service.create({ ...validCreatePayload, GenreId: 405 }),
    ).toThrow(BadRequestException);
    expect(repository.genreExists).toHaveBeenCalledWith(405);
    expect(repository.insert).not.toHaveBeenCalled();

    repository.genreExists.mockReturnValue(true);
    repository.mediaTypeExists.mockReturnValue(false);
    expect(() =>
      service.create({ ...validCreatePayload, MediaTypeId: 406 }),
    ).toThrow(BadRequestException);
    expect(repository.mediaTypeExists).toHaveBeenCalledWith(406);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('rechaza referencias inexistentes en PATCH sin escribir', () => {
    repository.findById.mockReturnValue(existingTrack);
    repository.albumExists.mockReturnValue(false);
    expect(() => service.update(1, { AlbumId: 404 })).toThrow(
      BadRequestException,
    );
    expect(repository.albumExists).toHaveBeenCalledWith(404);
    expect(repository.patch).not.toHaveBeenCalled();

    repository.albumExists.mockReturnValue(true);
    repository.genreExists.mockReturnValue(false);
    expect(() => service.update(1, { GenreId: 405 })).toThrow(
      BadRequestException,
    );
    expect(repository.genreExists).toHaveBeenCalledWith(405);
    expect(repository.patch).not.toHaveBeenCalled();

    repository.genreExists.mockReturnValue(true);
    repository.mediaTypeExists.mockReturnValue(false);
    expect(() => service.update(1, { MediaTypeId: 406 })).toThrow(
      BadRequestException,
    );
    expect(repository.mediaTypeExists).toHaveBeenCalledWith(406);
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('acepta AlbumId y GenreId null al crear', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const payload = { ...validCreatePayload, AlbumId: null, GenreId: null };

    await expect(
      pipe.transform(payload, {
        type: 'body',
        metatype: CreateTrackDto,
        data: '',
      }),
    ).resolves.toMatchObject({ AlbumId: null, GenreId: null });

    expect(service.create(payload)).toEqual(existingTrack);
    expect(repository.insert).toHaveBeenCalledWith(payload);
    expect(repository.albumExists).not.toHaveBeenCalled();
    expect(repository.genreExists).not.toHaveBeenCalled();
    expect(repository.mediaTypeExists).toHaveBeenCalledWith(1);
  });

  it('acepta AlbumId y GenreId null en PATCH sin reemplazar otros campos', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const payload = { AlbumId: null, GenreId: null };
    const updatedTrack: Track = {
      TrackId: existingTrack.TrackId,
      Name: existingTrack.Name,
      AlbumId: null,
      GenreId: null,
      MediaTypeId: existingTrack.MediaTypeId,
      Composer: existingTrack.Composer,
      Milliseconds: existingTrack.Milliseconds,
      Bytes: existingTrack.Bytes,
      UnitPrice: existingTrack.UnitPrice,
      Album: null,
      Genre: null,
      MediaType: existingTrack.MediaType,
    };
    repository.patch.mockReturnValue(updatedTrack);

    await expect(
      pipe.transform(payload, {
        type: 'body',
        metatype: UpdateTrackDto,
        data: '',
      }),
    ).resolves.toMatchObject(payload);

    expect(service.update(1, payload)).toEqual(updatedTrack);
    expect(repository.patch).toHaveBeenCalledWith(1, payload);
    expect(repository.albumExists).not.toHaveBeenCalled();
    expect(repository.genreExists).not.toHaveBeenCalled();
  });

  it.each(['Name', 'MediaTypeId', 'Milliseconds', 'UnitPrice'] as const)(
    'rechaza null en el campo obligatorio %s del DTO de alta',
    async (field) => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const payload: Record<string, unknown> = {
        ...validCreatePayload,
        [field]: null,
      };

      await expect(
        pipe.transform(payload, {
          type: 'body',
          metatype: CreateTrackDto,
          data: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.insert).not.toHaveBeenCalled();
    },
  );

  it.each(['Name', 'MediaTypeId', 'Milliseconds', 'UnitPrice'] as const)(
    'rechaza null en el campo obligatorio %s del DTO de actualización',
    async (field) => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const payload: Record<string, unknown> = { [field]: null };

      await expect(
        pipe.transform(payload, {
          type: 'body',
          metatype: UpdateTrackDto,
          data: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.patch).not.toHaveBeenCalled();
    },
  );

  it('preserva los campos omitidos en PATCH parcial', () => {
    const updatedTrack: Track = {
      TrackId: existingTrack.TrackId,
      Name: 'T17 pista actualizada',
      AlbumId: existingTrack.AlbumId,
      GenreId: existingTrack.GenreId,
      MediaTypeId: existingTrack.MediaTypeId,
      Composer: existingTrack.Composer,
      Milliseconds: existingTrack.Milliseconds,
      Bytes: existingTrack.Bytes,
      UnitPrice: existingTrack.UnitPrice,
      Album: existingTrack.Album,
      Genre: existingTrack.Genre,
      MediaType: existingTrack.MediaType,
    };
    repository.patch.mockReturnValue(updatedTrack);

    expect(service.update(1, { Name: 'T17 pista actualizada' })).toEqual(
      updatedTrack,
    );
    expect(repository.patch).toHaveBeenCalledWith(1, {
      Name: 'T17 pista actualizada',
    });
  });
});
