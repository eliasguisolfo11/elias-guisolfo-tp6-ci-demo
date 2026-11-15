import { Injectable } from '@nestjs/common';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import type { PaymentEntity } from './entities/payment.entity.js';

interface PaymentRow {
  id: number;
  reservationId: number;
  result: 'EXITOSO';
  createdAt: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly database: ReservationsDatabaseService) {}

  recordSuccessful(reservationId: number): PaymentEntity {
    this.database.run(
      `INSERT INTO payments (reservation_id, result)
       VALUES (?, 'EXITOSO')`,
      reservationId,
    );

    const payment = this.database.get<PaymentRow>(
      `SELECT
         id AS id,
         reservation_id AS reservationId,
         result AS result,
         created_at AS createdAt
       FROM payments
       WHERE reservation_id = ?`,
      reservationId,
    );

    if (payment === undefined) {
      throw new Error('El pago exitoso no pudo recuperarse después de guardarlo.');
    }

    return payment;
  }

  findByReservationId(reservationId: number): PaymentEntity | null {
    const payment = this.database.get<PaymentRow>(
      `SELECT
         id AS id,
         reservation_id AS reservationId,
         result AS result,
         created_at AS createdAt
       FROM payments
       WHERE reservation_id = ? AND result = 'EXITOSO'`,
      reservationId,
    );

    return payment ?? null;
  }
}
