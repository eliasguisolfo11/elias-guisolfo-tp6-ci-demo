import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { ArtistsRepository } from './artists.repository.js';
import { ArtistsService } from './artists.service.js';

type ArtistsRepositoryMock = {
  page: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

describe('ArtistsService', () => {
  let service: ArtistsService;
  let moduleRef: TestingModule;
  let repository: ArtistsRepositoryMock;

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
        ArtistsService,
        { provide: ArtistsRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(ArtistsService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('responde 404 al buscar un artista inexistente con id cero', () => {
    expect(() => service.findOne(0)).toThrow(NotFoundException);
    expect(repository.findById).toHaveBeenCalledWith(0);
  });

  it('responde 404 al actualizar un artista inexistente con id cero', () => {
    expect(() => service.update(0, { Name: 'Updated' })).toThrow(
      NotFoundException,
    );
    expect(repository.patch).toHaveBeenCalledWith(0, { Name: 'Updated' });
  });

  it('responde 404 al eliminar un artista inexistente con id cero', () => {
    expect(() => service.remove(0)).toThrow(NotFoundException);
    expect(repository.remove).toHaveBeenCalledWith(0);
  });

  it('rechaza PATCH vacío con 400 y no escribe en el repositorio', () => {
    expect(() => service.update(1, {})).toThrow(BadRequestException);
    expect(repository.patch).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('rechaza PATCH con Name indefinido y no lo envía al repositorio', () => {
    expect(() => service.update(1, { Name: undefined })).toThrow(
      BadRequestException,
    );
    expect(repository.patch).not.toHaveBeenCalled();
  });

  it('propaga el 409 del repositorio al eliminar un artista con álbumes', () => {
    const conflict = new ConflictException(
      'No se puede eliminar el artista porque tiene álbumes asociados.',
    );
    repository.remove.mockImplementation(() => {
      throw conflict;
    });

    expect(() => service.remove(1)).toThrow(conflict);
    expect(repository.remove).toHaveBeenCalledWith(1);
  });
});
