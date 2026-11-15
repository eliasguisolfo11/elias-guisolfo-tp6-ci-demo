import { ApiProperty } from '@nestjs/swagger';
import type { PaymentEntity } from '../entities/payment.entity.js';

export class ReservationPaymentResponseDto {
  @ApiProperty({
    type: String,
    enum: ['EXITOSO'],
    description: 'Resultado del pago simulado.',
    example: 'EXITOSO',
  })
  readonly result: 'EXITOSO';

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Instante UTC en que se confirmó el pago.',
    example: '2026-12-01T15:00:00.000Z',
  })
  readonly createdAt: string;

  constructor(payment: PaymentEntity) {
    this.result = payment.result;
    this.createdAt = payment.createdAt;
  }
}
