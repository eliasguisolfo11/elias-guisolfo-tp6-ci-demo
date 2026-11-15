import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';

const INVALID_STARTS_AT_MESSAGE =
  'La fecha y hora debe ser ISO válida e incluir un offset explícito.';
const INVALID_QUANTITY_MESSAGE = 'La cantidad debe ser un entero positivo.';

export class CreateReservationDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha y hora ISO 8601 del turno, con offset explícito.',
    example: '2026-12-15T10:00:00-03:00',
  })
  @IsDefined({ message: INVALID_STARTS_AT_MESSAGE })
  @IsString({ message: INVALID_STARTS_AT_MESSAGE })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i,
    { message: INVALID_STARTS_AT_MESSAGE },
  )
  startsAt!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Cantidad de cupos a solicitar.',
    example: 2,
  })
  @IsDefined({ message: INVALID_QUANTITY_MESSAGE })
  @IsInt({ message: INVALID_QUANTITY_MESSAGE })
  @IsPositive({ message: INVALID_QUANTITY_MESSAGE })
  quantity!: number;

  @ApiHideProperty()
  @IsIn([undefined], {
    message: 'El estado de una reserva no puede definirse al crearla.',
  })
  estado?: unknown;
}
