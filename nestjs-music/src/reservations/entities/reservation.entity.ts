import type { PaymentEntity } from './payment.entity.js';

export type ReservationStatus =
  'PENDIENTE' | 'PAGADA' | 'CANCELADA' | 'COMPLETADA';

export type PublicReservationStatus = Exclude<ReservationStatus, 'PENDIENTE'>;

export interface ReservationEntity {
  id: number;
  userId: number;
  slotId: number;
  startsAt: string;
  quantity: number;
  status: ReservationStatus;
  createdAt: string;
  payment?: PaymentEntity;
}
