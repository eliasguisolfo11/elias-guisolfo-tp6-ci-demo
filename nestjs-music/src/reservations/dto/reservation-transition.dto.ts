import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsIn } from 'class-validator';
import type { ReservationStatus } from '../entities/reservation.entity.js';

const RESERVATION_STATUSES: ReservationStatus[] = [
  'PENDIENTE',
  'PAGADA',
  'CANCELADA',
  'COMPLETADA',
];

export class ReservationTransitionDto {
  @ApiProperty({
    type: String,
    enum: RESERVATION_STATUSES,
    description: 'Estado de destino solicitado para la transición explícita.',
    example: 'COMPLETADA',
  })
  @IsDefined({ message: 'El estado de destino es obligatorio.' })
  @IsIn(RESERVATION_STATUSES, {
    message: 'El estado de destino no es válido.',
  })
  status!: ReservationStatus;
}
