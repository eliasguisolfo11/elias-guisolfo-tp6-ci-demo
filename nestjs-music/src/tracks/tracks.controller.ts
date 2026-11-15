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
import { CreateTrackDto } from './dto/create-track.dto.js';
import { SearchTracksQueryDto } from './dto/search-tracks-query.dto.js';
import { TrackSearchPageDto } from './dto/track-search-page.dto.js';
import { UpdateTrackDto } from './dto/update-track.dto.js';
import { Track } from './entities/track.entity.js';
import { TracksService } from './tracks.service.js';

@Controller('tracks')
@ApiTags('Tracks')
export class TracksController {
  constructor(
    private readonly tracksService: TracksService,
    private readonly parseIdPipe: ParseIdPipe,
    @Inject(SearchQueryPipe)
    private readonly searchQueryPipe: SearchQueryPipe<SearchTracksQueryDto>,
  ) {}

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Crear pista',
    description: 'Crea una pista con sus relaciones del catálogo.',
  })
  @ApiResponse({ status: 201, description: 'Pista creada.', type: Track })
  @ApiResponse({
    status: 400,
    description: 'Los datos de la pista o sus referencias no son válidos.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Se requieren credenciales válidas.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide crear la pista.',
    type: ApiErrorResponse,
  })
  @Post()
  @Roles('admin')
  create(@Body() createTrackDto: CreateTrackDto): Track {
    return this.tracksService.create(createTrackDto);
  }

  @ApiOperation({
    summary: 'Listar pistas',
    description: 'Obtiene una página de pistas ordenada por identificador.',
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
    description: 'Página de pistas con sus relaciones.',
    type: Track,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Los parámetros de paginación no son válidos.',
    type: ApiErrorResponse,
  })
  @Get()
  @Roles('viewer', 'admin')
  findAll(@Query() listQueryDto: ListQueryDto): Track[] {
    return this.tracksService.findAll(listQueryDto.skip, listQueryDto.limit);
  }

  @Get('search')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Buscar pistas',
    description:
      'Busca pistas mediante filtros combinables y devuelve resultados paginados.',
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
    description: 'Campo de orden permitido para Tracks.',
    schema: {
      type: 'string',
      enum: ['Name', 'UnitPrice', 'Milliseconds'],
      default: 'Name',
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
    description: 'Coincidencia parcial en el nombre de la pista.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'genre',
    required: false,
    description: 'Coincidencia parcial en el nombre del género.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'artist',
    required: false,
    description: 'Coincidencia parcial en el nombre del artista.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'minPrice',
    required: false,
    description:
      'Precio mínimo inclusivo. Si se envían ambos límites, minPrice y maxPrice se comparan entre sí como decimales originales antes de convertir; si minPrice supera maxPrice, responde HTTP 400. El filtro usa el Number finito de JavaScript y redondeo IEEE-754 en SQLite REAL; 0.99000000000000001 se filtra como 0.99. Si convierte a infinito, responde HTTP 400. No hay máximo decimal de aplicación.',
    schema: { type: 'number', minimum: 0 },
  })
  @ApiQuery({
    name: 'maxPrice',
    required: false,
    description:
      'Precio máximo inclusivo. Si se envían ambos límites, minPrice y maxPrice se comparan entre sí como decimales originales antes de convertir; si minPrice supera maxPrice, responde HTTP 400. El filtro usa el Number finito de JavaScript y redondeo IEEE-754 en SQLite REAL; 0.99000000000000001 se filtra como 0.99. Si convierte a infinito, responde HTTP 400. No hay máximo decimal de aplicación.',
    schema: { type: 'number', minimum: 0 },
  })
  @ApiQuery({
    name: 'minDuration',
    required: false,
    description: 'Duración mínima inclusiva, en milisegundos.',
    schema: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
  })
  @ApiQuery({
    name: 'maxDuration',
    required: false,
    description: 'Duración máxima inclusiva, en milisegundos.',
    schema: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Página de resultados de pistas.',
    type: TrackSearchPageDto,
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
    return this.tracksService.search(this.searchQueryPipe.transform(query));
  }

  @ApiOperation({
    summary: 'Obtener pista',
    description: 'Obtiene una pista y sus relaciones por identificador.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo de la pista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({
    status: 200,
    description: 'Pista encontrada con sus relaciones.',
    type: Track,
  })
  @ApiResponse({
    status: 400,
    description: 'El identificador no es válido.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 404,
    description: 'No se encontró la pista solicitada.',
    type: ApiErrorResponse,
  })
  @Get(':id')
  @Roles('viewer', 'admin')
  findOne(@Param('id') id: string): Track {
    return this.tracksService.findOne(this.parseIdPipe.transformCatalogId(id));
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Actualizar pista',
    description: 'Actualiza parcialmente una pista existente.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo de la pista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 200, description: 'Pista actualizada.', type: Track })
  @ApiResponse({
    status: 400,
    description:
      'Una referencia inexistente responde 400 cuando la pista existe; los demás datos inválidos también responden 400.',
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
      'Si la pista no existe, este 404 prevalece aunque el body válido incluya una referencia inexistente.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'Una restricción de integridad impide actualizar la pista.',
    type: ApiErrorResponse,
  })
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() updateTrackDto: UpdateTrackDto,
  ): Track {
    return this.tracksService.update(
      this.parseIdPipe.transformCatalogId(id),
      updateTrackDto,
    );
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Eliminar pista',
    description: 'Elimina una pista que no tenga facturas ni listas asociadas.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador entero no negativo de la pista.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiResponse({ status: 204, description: 'Pista eliminada sin contenido.' })
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
    description: 'No se encontró la pista solicitada.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 409,
    description: 'La pista tiene facturas o listas asociadas.',
    type: ApiErrorResponse,
  })
  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.tracksService.remove(this.parseIdPipe.transformCatalogId(id));
  }
}
