import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { GenresRepository } from './genres.repository.js';
import { GenresService } from './genres.service.js';
import { CreateGenreDto } from './dto/create-genre.dto.js';
import { UpdateGenreDto } from './dto/update-genre.dto.js';
import type { Genre } from './entities/genre.entity.js';

type GenresRepositoryMock = {
  page: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

describe('GenresService', () => {
  let service: GenresService;
  let moduleRef: TestingModule;
  let repository: GenresRepositoryMock;

  beforeEach(async () => {
    repository = {
      page: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      insert: vi.fn(),
      patch: vi.fn().mockReturnValue(null),
      remove: vi.fn().mockReturnValue(false),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        GenresService,
        { provide: GenresRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(GenresService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('responde 404 al buscar un género inexistente con id cero', () => {
    expect(() => service.findOne(0)).toThrow(NotFoundException);
    expect(repository.findById).toHaveBeenCalledWith(0);
  });

  it('responde 404 al actualizar un género inexistente con id cero', () => {
    expect(() => service.update(0, { Name: 'Updated' })).toThrow(
      NotFoundException,
    );
    expect(repository.patch).toHaveBeenCalledWith(0, { Name: 'Updated' });
  });

  it('responde 404 al eliminar un género inexistente con id cero', () => {
    expect(() => service.remove(0)).toThrow(NotFoundException);
    expect(repository.remove).toHaveBeenCalledWith(0);
  });

  it('rechaza PATCH vacío con 400 y no escribe en el repositorio', () => {
    expect(() => service.update(1, {})).toThrow(BadRequestException);
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('acepta Name null en el DTO de alta y lo persiste como null', async () => {
    const genre: Genre = { GenreId: 1, Name: null };
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    repository.insert.mockReturnValue(genre);

    await expect(
      pipe.transform(
        { Name: null },
        { type: 'body', metatype: CreateGenreDto, data: '' },
      ),
    ).resolves.toMatchObject({ Name: null });
    expect(service.create({ Name: null })).toEqual(genre);
    expect(repository.insert).toHaveBeenCalledWith({ Name: null });
  });

  it('acepta Name vacío porque sigue siendo una cadena', async () => {
    const genre: Genre = { GenreId: 2, Name: '' };
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    repository.insert.mockReturnValue(genre);

    await expect(
      pipe.transform(
        { Name: '' },
        { type: 'body', metatype: CreateGenreDto, data: '' },
      ),
    ).resolves.toMatchObject({ Name: '' });
    expect(service.create({ Name: '' })).toEqual(genre);
    expect(repository.insert).toHaveBeenCalledWith({ Name: '' });
  });

  it.each([{}, { Name: undefined }])(
    'rechaza Name ausente al crear y no escribe',
    async (createGenreDto) => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });

      await expect(
        pipe.transform(
          createGenreDto,
          { type: 'body', metatype: CreateGenreDto, data: '' },
        ),
      ).resolves.toBeInstanceOf(CreateGenreDto);
      expect(() => service.create(createGenreDto)).toThrow(BadRequestException);
      expect(repository.insert).not.toHaveBeenCalled();
    },
  );

  it('rechaza un tipo de Name inválido en el DTO de creación', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform(
        { Name: 42 },
        { type: 'body', metatype: CreateGenreDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('rechaza un tipo de Name inválido en el DTO de actualización', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform(
        { Name: 42 },
        { type: 'body', metatype: UpdateGenreDto, data: '' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('permite limpiar Name con null durante PATCH', async () => {
    const genre: Genre = { GenreId: 1, Name: null };
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    repository.patch.mockReturnValue(genre);

    await expect(
      pipe.transform(
        { Name: null },
        { type: 'body', metatype: UpdateGenreDto, data: '' },
      ),
    ).resolves.toMatchObject({ Name: null });
    expect(service.update(1, { Name: null })).toEqual(genre);
    expect(repository.patch).toHaveBeenCalledWith(1, { Name: null });
  });

  it('propaga el 409 del repositorio al eliminar un género con pistas', () => {
    const conflict = new ConflictException(
      'No se puede eliminar el registro porque tiene elementos asociados.',
    );
    repository.remove.mockImplementation(() => {
      throw conflict;
    });

    expect(() => service.remove(1)).toThrow(conflict);
    expect(repository.remove).toHaveBeenCalledWith(1);
  });
});
