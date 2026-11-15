import { ApiProperty } from '@nestjs/swagger';
import type { ReservationReceipt } from '../reservations.service.js';
import type { PublicReservationStatus } from '../entities/reservation.entity.js';
import { ReservationPaymentResponseDto } from './reservation-payment-response.dto.js';

export class ReservationResponseDto {
  @ApiProperty({
    type: 'integer',
    description: 'Identificador público de la reserva.',
    example: 12,
  })
  readonly id: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha y hora del turno, con el offset configurado.',
    example: '2026-12-15T10:00:00-03:00',
  })
  readonly startsAt: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 2 })
  readonly quantity: number;

  @ApiProperty({
    type: String,
    enum: ['PAGADA', 'CANCELADA', 'COMPLETADA'],
    example: 'PAGADA',
  })
  readonly status: PublicReservationStatus;

  @ApiProperty({ type: () => ReservationPaymentResponseDto })
  readonly payment: ReservationPaymentResponseDto;

  constructor(reservation: ReservationReceipt) {
    this.id = reservation.id;
    this.startsAt = reservation.startsAt;
    this.quantity = reservation.quantity;
    this.status = reservation.status;
    this.payment = new ReservationPaymentResponseDto(reservation.payment);
  }
}
