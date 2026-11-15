import { Injectable } from '@nestjs/common';
import { ReservationsDatabaseService } from './reservations.database.service.js';

export interface SlotAvailability {
  startsAt: string;
  capacity: number;
  remainingCapacity: number;
}

export interface ReservableSlot extends SlotAvailability {
  id: number;
}

@Injectable()
export class SlotsRepository {
  constructor(private readonly database: ReservationsDatabaseService) {}

  findAll(): SlotAvailability[] {
    return this.database.all<SlotAvailability>(`
      SELECT
        slots.starts_at AS startsAt,
        slots.capacity AS capacity,
        slots.capacity - COALESCE(
          SUM(
            CASE
              WHEN reservations.status IN ('PAGADA', 'COMPLETADA')
                THEN reservations.quantity
              ELSE 0
            END
          ),
          0
        ) AS remainingCapacity
      FROM slots
      LEFT JOIN reservations ON reservations.slot_id = slots.id
      GROUP BY slots.id
      ORDER BY slots.starts_at_utc ASC
    `);
  }

  findForReservation(startsAtUtc: string): ReservableSlot | null {
    const slot = this.database.get<ReservableSlot>(
      `SELECT
         slots.id AS id,
         slots.starts_at AS startsAt,
         slots.capacity AS capacity,
         slots.capacity - COALESCE(
           SUM(
             CASE
               WHEN reservations.status IN ('PAGADA', 'COMPLETADA')
                 THEN reservations.quantity
               ELSE 0
             END
           ),
           0
         ) AS remainingCapacity
       FROM slots
       LEFT JOIN reservations ON reservations.slot_id = slots.id
       WHERE slots.starts_at_utc = ?
       GROUP BY slots.id`,
      startsAtUtc,
    );

    return slot ?? null;
  }
}
