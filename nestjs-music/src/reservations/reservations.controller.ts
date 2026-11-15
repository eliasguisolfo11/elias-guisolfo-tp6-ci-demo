import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/bearer-auth.guard.js';
import type { AuthenticatedUser } from '../auth/bearer-auth.guard.js';
import type { Response } from 'express';
import { ApiErrorResponse } from '../common/swagger/api-error-response.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';
import { Roles } from '../auth/roles.decorator.js';
import { validateIdempotencyKey } from './idempotency-key.js';
import { ReservationsService } from './reservations.service.js';
import { CreateReservationDto } from './dto/create-reservation.dto.js';
import { ReservationConflictResponseDto } from './dto/reservation-conflict-response.dto.js';
import { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { ReservationTransitionDto } from './dto/reservation-transition.dto.js';
import { SlotAvailabilityResponseDto } from './dto/slot-availability-response.dto.js';

const AUTHENTICATION_ERROR_MESSAGE = 'Se requieren credenciales válidas.';
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly parseIdPipe: ParseIdPipe,
  ) {}

  @Get('slots')
  @Roles('viewer', 'admin')
  @ApiOperation({
    summary: 'Consultar turnos y cupo disponible.',
    description:
      'Disponible para los roles viewer y admin. El offset de startsAt se conserva y remainingCapacity se calcula desde el cupo fijo y las reservas PAGADA o COMPLETADA. Los turnos vencidos siguen visibles para consulta histórica.',
  })
  @ApiOkResponse({
    type: SlotAvailabilityResponseDto,
    isArray: true,
    description:
      'Turnos configurados con fecha y hora con offset, capacidad fija y cupo disponible.',
  })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponse,
    description: 'Se requieren credenciales válidas.',
  })
  @ApiForbiddenResponse({
    type: ApiErrorResponse,
    description: 'El usuario no tiene permisos para esta operación.',
  })
  slots(): SlotAvailabilityResponseDto[] {
    return this.reservationsService
      .findSlots()
      .map((slot) => new SlotAvailabilityResponseDto(slot));
  }

  @Get(':id')
  @Roles('viewer', 'admin')
  @ApiOperation({
    summary: 'Consultar una reserva propia o administrar cualquiera.',
    description:
      'Disponible para viewer sobre sus propias reservas y para admin sobre cualquier reserva. La respuesta solo expone los campos públicos de la reserva y del pago simulado.',
  })
  @ApiOkResponse({
    type: ReservationResponseDto,
    description: 'Reserva y pago asociados en su forma pública.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description: 'El identificador no es válido.',
  })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponse,
    description: 'Se requieren credenciales válidas.',
  })
  @ApiForbiddenResponse({
    type: ApiErrorResponse,
    description: 'El usuario no tiene permisos para esta operación.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponse,
    description: 'No existe una reserva visible para este usuario.',
  })
  findById(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): ReservationResponseDto {
    const user = getAuthenticatedUser(request);
    const reservation = this.reservationsService.findById(
      this.parseIdPipe.transform(id),
      user.id,
      user.role,
    );

    return new ReservationResponseDto(reservation);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('viewer', 'admin')
  @ApiOperation({
    summary: 'Cancelar una reserva pagada de forma idempotente.',
    description:
      'Disponible para viewer sobre sus propias reservas y para admin sobre cualquier reserva pagada. PAGADA pasa a CANCELADA; repetir la cancelación devuelve la misma representación y no libera cupo otra vez.',
  })
  @ApiOkResponse({
    type: ReservationResponseDto,
    description:
      'Reserva cancelada o ya cancelada, sin liberar cupo más de una vez.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description: 'El identificador no es válido.',
  })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponse,
    description: 'Se requieren credenciales válidas.',
  })
  @ApiForbiddenResponse({
    type: ApiErrorResponse,
    description: 'El usuario no tiene permisos para esta operación.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponse,
    description: 'No existe una reserva visible para este usuario.',
  })
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description: 'Solo puede cancelarse una reserva PAGADA o CANCELADA.',
  })
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): ReservationResponseDto {
    const user = getAuthenticatedUser(request);
    const reservation = this.reservationsService.cancel(
      this.parseIdPipe.transform(id),
      user.id,
      user.role,
    );

    return new ReservationResponseDto(reservation);
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @Roles('viewer', 'admin')
  @ApiOperation({
    summary: 'Solicitar una transición de estado permitida.',
    description:
      'Disponible para viewer propietario y admin sobre cualquier reserva al cancelar; solo admin puede completar desde el instante programado inclusive. Solo se permiten PAGADA → CANCELADA y PAGADA → COMPLETADA; PAGADA → PENDIENTE responde HTTP 409. No existen rutas PUT ni PATCH genéricas para modificar reservas.',
  })
  @ApiBody({ type: ReservationTransitionDto })
  @ApiOkResponse({
    type: ReservationResponseDto,
    description: 'Transición aplicada; respuesta con la reserva y el pago.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description: 'El identificador o el estado de destino no son válidos.',
  })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponse,
    description: 'Se requieren credenciales válidas.',
  })
  @ApiForbiddenResponse({
    type: ApiErrorResponse,
    description: 'El usuario no tiene permisos para esta operación.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponse,
    description: 'No existe una reserva visible para este usuario.',
  })
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description:
      'El estado de origen, destino o instante programado impide la transición.',
  })
  transition(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: ReservationTransitionDto,
  ): ReservationResponseDto {
    const user = getAuthenticatedUser(request);
    const reservation = this.reservationsService.transition(
      this.parseIdPipe.transform(id),
      user.id,
      user.role,
      input.status,
    );

    return new ReservationResponseDto(reservation);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('viewer')
  @ApiOperation({
    summary: 'Crear una reserva y confirmar su pago simulado.',
    description:
      'Disponible solo para el rol viewer. Requiere un Idempotency-Key no vacío enviado una sola vez; un replay idéntico devuelve la representación original con HTTP 201 y un contenido distinto responde HTTP 409. startsAt debe incluir offset explícito y quantity debe ser entero positivo. La reserva inicia como PENDIENTE solo dentro de la operación atómica; el pago simulado confirmado deja el estado público en PAGADA.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Clave no vacía, enviada una sola vez por solicitud.',
  })
  @ApiBody({ type: CreateReservationDto })
  @ApiCreatedResponse({
    type: ReservationResponseDto,
    description: 'Reserva pagada con el resultado del pago simulado.',
  })
  @ApiBadRequestResponse({
    type: ApiErrorResponse,
    description:
      'La solicitud, el encabezado Idempotency-Key, la cantidad o el offset no son válidos.',
  })
  @ApiUnauthorizedResponse({
    type: ApiErrorResponse,
    description: 'Se requieren credenciales válidas.',
  })
  @ApiForbiddenResponse({
    type: ApiErrorResponse,
    description: 'El usuario no tiene permisos para esta operación.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorResponse,
    description: 'No existe un turno para esa fecha y hora.',
  })
  @ApiConflictResponse({
    type: ReservationConflictResponseDto,
    description:
      'La clave de idempotencia entra en conflicto o no hay cupo suficiente.',
  })
  @ApiBadGatewayResponse({
    type: ApiErrorResponse,
    description:
      'El pago simulado no pudo confirmarse; la reserva y el pago se revirtieron.',
  })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const idempotencyKey = validateIdempotencyKey(
      getRawHeaderValues(request.rawHeaders, IDEMPOTENCY_KEY_HEADER),
    );
    const user = getAuthenticatedUser(request);
    const cancellation = new AbortController();
    const cancelIfDisconnected = () => {
      if (!response.writableEnded) {
        cancellation.abort();
      }
    };
    response.once('close', cancelIfDisconnected);

    try {
      const result = await this.reservationsService.createCoordinated(
        user.id,
        idempotencyKey,
        input,
        cancellation.signal,
      );
      response.status(result.status);
      return result.body;
    } finally {
      response.off('close', cancelIfDisconnected);
    }
  }
}

function getAuthenticatedUser(
  request: AuthenticatedRequest,
): AuthenticatedUser {
  if (request.user === undefined) {
    throw new UnauthorizedException(AUTHENTICATION_ERROR_MESSAGE);
  }

  return request.user;
}

function getRawHeaderValues(
  rawHeaders: readonly string[],
  requestedName: string,
): string[] {
  const normalizedName = requestedName.toLowerCase();
  const values: string[] = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name?.toLowerCase() === normalizedName && value !== undefined) {
      values.push(value);
    }
  }

  return values;
}
