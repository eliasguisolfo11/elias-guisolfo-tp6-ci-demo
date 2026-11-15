import { Injectable } from '@nestjs/common';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import type {
  PublicReservationStatus,
  ReservationEntity,
  ReservationStatus,
} from './entities/reservation.entity.js';
import type { PaymentEntity } from './entities/payment.entity.js';

export interface NewReservation {
  userId: number;
  slotId: number;
  quantity: number;
  idempotencyKey: string;
  requestPayload: string;
}

export interface SuccessfulReservation extends ReservationEntity {
  requestPayload: string;
}

export interface ReservationWithPayment extends Omit<
  ReservationEntity,
  'status'
> {
  status: PublicReservationStatus;
  payment: PaymentEntity;
}

interface ReservationRow {
  id: number;
  userId: number;
  slotId: number;
  startsAt: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: string;
}

interface SuccessfulReservationRow extends ReservationRow {
  requestPayload: string;
}

interface ReservationWithPaymentRow extends ReservationRow {
  paymentId: number;
  paymentResult: 'EXITOSO';
  paymentCreatedAt: string;
}

@Injectable()
export class ReservationsRepository {
  constructor(private readonly database: ReservationsDatabaseService) {}

  createPending(reservation: NewReservation): number {
    const result = this.database.run(
      `INSERT INTO reservations (
         user_id, slot_id, quantity, status, idempotency_key, request_payload
       ) VALUES (?, ?, ?, 'PENDIENTE', ?, ?)`,
      reservation.userId,
      reservation.slotId,
      reservation.quantity,
      reservation.idempotencyKey,
      reservation.requestPayload,
    );

    return Number(result.lastInsertRowid);
  }

  markPaid(id: number): void {
    const result = this.database.run(
      "UPDATE reservations SET status = 'PAGADA' WHERE id = ? AND status = 'PENDIENTE'",
      id,
    );

    if (result.changes !== 1) {
      throw new Error('La reserva pendiente no pudo marcarse como pagada.');
    }
  }

  findById(id: number): ReservationEntity | null {
    const reservation = this.database.get<ReservationRow>(
      `SELECT
         reservations.id AS id,
         reservations.user_id AS userId,
         reservations.slot_id AS slotId,
         slots.starts_at AS startsAt,
         reservations.quantity AS quantity,
         reservations.status AS status,
         reservations.created_at AS createdAt
       FROM reservations
       INNER JOIN slots ON slots.id = reservations.slot_id
       WHERE reservations.id = ?`,
      id,
    );

    return reservation ?? null;
  }

  findWithPaymentById(id: number): ReservationWithPayment | null {
    const reservation = this.database.get<ReservationWithPaymentRow>(
      `SELECT
         reservations.id AS id,
         reservations.user_id AS userId,
         reservations.slot_id AS slotId,
         slots.starts_at AS startsAt,
         reservations.quantity AS quantity,
         reservations.status AS status,
         reservations.created_at AS createdAt,
         payments.id AS paymentId,
         payments.result AS paymentResult,
         payments.created_at AS paymentCreatedAt
       FROM reservations
       INNER JOIN slots ON slots.id = reservations.slot_id
       INNER JOIN payments ON payments.reservation_id = reservations.id
       WHERE reservations.id = ?`,
      id,
    );

    if (reservation === undefined) {
      return null;
    }

    if (reservation.status === 'PENDIENTE') {
      return null;
    }

    return {
      id: reservation.id,
      userId: reservation.userId,
      slotId: reservation.slotId,
      startsAt: reservation.startsAt,
      quantity: reservation.quantity,
      status: reservation.status,
      createdAt: reservation.createdAt,
      payment: {
        id: reservation.paymentId,
        reservationId: reservation.id,
        result: reservation.paymentResult,
        createdAt: reservation.paymentCreatedAt,
      },
    };
  }

  transition(
    id: number,
    currentStatus: ReservationStatus,
    nextStatus: ReservationStatus,
  ): boolean {
    const result = this.database.run(
      'UPDATE reservations SET status = ? WHERE id = ? AND status = ?',
      nextStatus,
      id,
      currentStatus,
    );

    return result.changes === 1;
  }

  findSuccessfulByUserAndIdempotencyKey(
    userId: number,
    idempotencyKey: string,
  ): SuccessfulReservation | null {
    const reservation = this.database.get<SuccessfulReservationRow>(
      `SELECT
         reservations.id AS id,
         reservations.user_id AS userId,
         reservations.slot_id AS slotId,
         slots.starts_at AS startsAt,
         reservations.quantity AS quantity,
         reservations.status AS status,
         reservations.created_at AS createdAt,
         reservations.request_payload AS requestPayload
       FROM reservations
       INNER JOIN slots ON slots.id = reservations.slot_id
       WHERE reservations.user_id = ?
         AND reservations.idempotency_key = ?
         AND EXISTS (
           SELECT 1 FROM payments
           WHERE payments.reservation_id = reservations.id
             AND payments.result = 'EXITOSO'
         )`,
      userId,
      idempotencyKey,
    );

    return reservation ?? null;
  }
}
