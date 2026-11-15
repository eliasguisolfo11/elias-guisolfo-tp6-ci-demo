import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
import { SearchQueryPipe } from '../search/search-query.pipe.js';
import { ApiErrorResponse } from '../common/swagger/api-error-response.js';
import { Roles } from '../auth/roles.decorator.js';
import { AlbumsService } from './albums.service.js';
import { CreateAlbumDto } from './dto/create-album.dto.js';
import { SearchAlbumsQueryDto } from './dto/search-albums-query.dto.js';
import { AlbumSearchPageDto } from './dto/album-search-page.dto.js';
import { UpdateAlbumDto } from './dto/update-album.dto.js';
import { Album } from './entities/album.entity.js';

@Controller('albums')
@ApiTags('Albums')
export class AlbumsController {
  constructor(
    private readonly albumsService: AlbumsService,
    private readonly parseIdPipe: ParseIdPipe,
    @Inject(SearchQueryPipe)
    private readonly searchQueryPipe: SearchQueryPipe<SearchAlbumsQueryDto>,
  ) {}

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Crear álbum',
    description: 'Crea un álbum asociado a un artista existente.',
  })
  @ApiResponse({ status: 201, description: 'Álbum creado.', type: Album })
  @ApiResponse({
    status: 400,
    description: 'Los datos del álbum o su artista no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide crear el álbum.',
    type: ApiErrorResponse,
  })
  @Post()
  @Roles('admin')
  create(@Body() createAlbumDto: CreateAlbumDto): Album {
    return this.albumsService.create(createAlbumDto);
  }

  @ApiOperation({
    summary: 'Listar álbumes',
    description: 'Obtiene una página de álbumes ordenada por identificador.',
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
    description: 'Página de álbumes con su artista asociado.',
    type: Album,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Los parámetros de paginación no son válidos.',
    type: ApiErrorResponse,
  })
  @Get()
  @Roles('viewer', 'admin')
  findAll(@Query() listQueryDto: ListQueryDto): Album[] {
    return this.albumsService.findAll(listQueryDto.skip, listQueryDto.limit);
  }

  @Get('search')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Buscar álbumes',
    description:
      'Busca álbumes mediante filtros de título y artista y devuelve resultados paginados.',
  })
  @ApiQuery({
    name: 'skip',
    required: false,
    description: 'Cantidad de resultados a omitir.',
    schema: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 0,
    },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cantidad de resultados; admite entre 1 y 100.',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Campo de orden permitido para Albums.',
    schema: {
      type: 'string',
      enum: ['Title', 'ArtistName'],
      default: 'Title',
    },
  })
  @ApiQuery({
    name: 'order',
    required: false,
    description: 'Dirección del orden; no distingue mayúsculas.',
    schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
  })
  @ApiQuery({
    name: 'text',
    required: false,
    description: 'Coincidencia parcial solo en el título del álbum.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'artist',
    required: false,
    description: 'Coincidencia parcial en el nombre del artista.',
    schema: { type: 'string' },
  })
  @ApiResponse({
    status: 200,
    description: 'Página de resultados de álbumes.',
    type: AlbumSearchPageDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Los parámetros de búsqueda no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @Roles('viewer', 'admin')
  search(@Query() query: unknown) {
    return this.albumsService.search(this.searchQueryPipe.transform(query));
  }

  @ApiOperation({
    summary: 'Obtener álbum',
    description: 'Obtiene un álbum y su artista por identificador.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del álbum.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({
    status: 200,
    description: 'Álbum encontrado con su artista asociado.',
    type: Album,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador no es válido.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró el álbum solicitado.',
    type: ApiErrorResponse,
  })
  @Get(':id')
  @Roles('viewer', 'admin')
  findOne(@Param('id') id: string): Album {
    return this.albumsService.findOne(this.parseIdPipe.transformCatalogId(id));
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Actualizar álbum',
    description: 'Actualiza parcialmente un álbum existente.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del álbum.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 200, description: 'Álbum actualizado.', type: Album })
  @ApiResponse({
    status: 400,
    description:
      'Una referencia inexistente responde 400 cuando el álbum existe; los demás datos inválidos también responden 400.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description:
      'Si el álbum no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide actualizar el álbum.',
    type: ApiErrorResponse,
  })
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() updateAlbumDto: UpdateAlbumDto,
  ): Album {
    return this.albumsService.update(
      this.parseIdPipe.transformCatalogId(id),
      updateAlbumDto,
    );
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Eliminar álbum',
    description: 'Elimina un álbum que no tenga pistas asociadas.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo del álbum.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 204, description: 'Álbum eliminado sin contenido.' })
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
    description: 'No se encontró el álbum solicitado.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'El álbum tiene pistas asociadas.',
    type: ApiErrorResponse,
  })
  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.albumsService.remove(this.parseIdPipe.transformCatalogId(id));
  }
}
