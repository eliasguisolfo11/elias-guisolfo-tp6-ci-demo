import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ListQueryDto } from '../common/dto/list-query.dto.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import { ApiErrorResponse } from '../common/swagger/api-error-response.js';
import { Roles } from '../auth/roles.decorator.js';
import { GenresService } from './genres.service.js';
import { CreateGenreDto } from './dto/create-genre.dto.js';
import { UpdateGenreDto } from './dto/update-genre.dto.js';
import { Genre } from './entities/genre.entity.js';

@Controller('genres')
@ApiTags('Genres')
export class GenresController {
  constructor(
    private readonly genresService: GenresService,
    private readonly parseIdPipe: ParseIdPipe,
  ) {}

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Crear género',
    description: 'Crea un género en el catálogo.',
  })
  @ApiResponse({ status: 201, description: 'Género creado.', type: Genre })
  @ApiResponse({
    status: 400,
    description: 'Los datos del género no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide crear el género.',
    type: ApiErrorResponse,
  })
  @Post()
  @Roles('admin')
  create(@Body() createGenreDto: CreateGenreDto): Genre {
    return this.genresService.create(createGenreDto);
  }

  @ApiOperation({
    summary: 'Listar géneros',
    description: 'Obtiene una página de géneros ordenada por identificador.',
  })
  @ApiQuery({
    name: 'skip',
    required: false,
    description: 'Cantidad de elementos que se omiten.',
    schema: { type: 'integer', minimum: 0, default: 0 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Máximo de elementos de la página (hasta 100).',
    schema: { type: 'integer', minimum: 1, default: 100 },
  })
  @ApiResponse({
    status: 200,
    description: 'Página de géneros.',
    type: Genre,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Los parámetros de paginación no son válidos.',
    type: ApiErrorResponse,
  })
  @Get()
  @Roles('viewer', 'admin')
  findAll(@Query() listQueryDto: ListQueryDto): Genre[] {
    return this.genresService.findAll(listQueryDto.skip, listQueryDto.limit);
  }

  @ApiOperation({
    summary: 'Obtener género',
    description: 'Obtiene un género por su identificador.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del género.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 200, description: 'Género encontrado.', type: Genre })
  @ApiResponse({
    status: 400,
    description: 'El identificador no es válido.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el género solicitado.',
    type: ApiErrorResponse,
  })
  @Get(':id')
  @Roles('viewer', 'admin')
  findOne(@Param('id') id: string): Genre {
    return this.genresService.findOne(this.parseIdPipe.transformCatalogId(id));
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Actualizar género',
    description: 'Actualiza parcialmente un género existente.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del género.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 200, description: 'Género actualizado.', type: Genre })
  @ApiResponse({
    status: 400,
    description: 'Los datos del género no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el género solicitado.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide actualizar el género.',
    type: ApiErrorResponse,
  })
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() updateGenreDto: UpdateGenreDto,
  ): Genre {
    return this.genresService.update(
      this.parseIdPipe.transformCatalogId(id),
      updateGenreDto,
    );
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Eliminar género',
    description: 'Elimina un género que no tenga pistas asociadas.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del género.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 204, description: 'Género eliminado sin contenido.' })
  @ApiResponse({
    status: 400,
    description: 'El identificador no es válido.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el género solicitado.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'El género tiene pistas asociadas.',
    type: ApiErrorResponse,
  })
  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.genresService.remove(this.parseIdPipe.transformCatalogId(id));
  }
}
