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
import { ArtistsService } from './artists.service.js';
import { CreateArtistDto } from './dto/create-artist.dto.js';
import { UpdateArtistDto } from './dto/update-artist.dto.js';
import { Artist } from './entities/artist.entity.js';

@Controller('artists')
@ApiTags('Artists')
export class ArtistsController {
  constructor(
    private readonly artistsService: ArtistsService,
    private readonly parseIdPipe: ParseIdPipe,
  ) {}

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Crear artista',
    description: 'Crea un artista en el catálogo.',
  })
  @ApiResponse({ status: 201, description: 'Artista creado.', type: Artist })
  @ApiResponse({
    status: 400,
    description: 'Los datos del artista no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide crear el artista.',
    type: ApiErrorResponse,
  })
  @Post()
  @Roles('admin')
  create(@Body() createArtistDto: CreateArtistDto): Artist {
    return this.artistsService.create(createArtistDto);
  }

  @ApiOperation({
    summary: 'Listar artistas',
    description: 'Obtiene una página de artistas ordenada por identificador.',
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
    description: 'Página de artistas.',
    type: Artist,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Los parámetros de paginación no son válidos.',
    type: ApiErrorResponse,
  })
  @Get()
  @Roles('viewer', 'admin')
  findAll(@Query() listQueryDto: ListQueryDto): Artist[] {
    return this.artistsService.findAll(listQueryDto.skip, listQueryDto.limit);
  }

  @ApiOperation({
    summary: 'Obtener artista',
    description: 'Obtiene un artista por su identificador.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del artista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({
    status: 200,
    description: 'Artista encontrado.',
    type: Artist,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador no es válido.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el artista solicitado.',
    type: ApiErrorResponse,
  })
  @Get(':id')
  @Roles('viewer', 'admin')
  findOne(@Param('id') id: string): Artist {
    return this.artistsService.findOne(this.parseIdPipe.transformCatalogId(id));
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Actualizar artista',
    description: 'Actualiza parcialmente un artista existente.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del artista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({
    status: 200,
    description: 'Artista actualizado.',
    type: Artist,
  })
  @ApiResponse({
    status: 400,
    description: 'Los datos del artista no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el artista solicitado.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide actualizar el artista.',
    type: ApiErrorResponse,
  })
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() updateArtistDto: UpdateArtistDto,
  ): Artist {
    return this.artistsService.update(
      this.parseIdPipe.transformCatalogId(id),
      updateArtistDto,
    );
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Eliminar artista',
    description: 'Elimina un artista que no tenga álbumes asociados.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del artista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 204, description: 'Artista eliminado sin contenido.' })
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
    description: 'No se encontró el artista solicitado.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'El artista tiene álbumes asociados.',
    type: ApiErrorResponse,
  })
  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.artistsService.remove(this.parseIdPipe.transformCatalogId(id));
  }
}
