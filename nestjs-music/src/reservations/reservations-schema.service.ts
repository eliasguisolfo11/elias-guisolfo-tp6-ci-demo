import { Injectable, OnModuleInit } from '@nestjs/common';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { INITIAL_SLOTS, prepareInitialSlots } from './initial-slots.js';

interface SlotCountRow {
  slot_count: number;
}

@Injectable()
export class ReservationsSchemaService implements OnModuleInit {
  constructor(private readonly database: ReservationsDatabaseService) {}

  onModuleInit(): void {
    this.database.transaction(() => {
      this.createTables();
      this.createIndexes();
      this.seedInitialSlotsWhenEmpty();
    });
  }

  private createTables(): void {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY,
        starts_at TEXT NOT NULL,
        starts_at_utc TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (typeof(capacity) = 'integer' AND capacity > 0)
      )
    `);
    this.database.run(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
        status TEXT NOT NULL CHECK (
          status IN ('PENDIENTE', 'PAGADA', 'CANCELADA', 'COMPLETADA')
        ),
        idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
        request_payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    this.database.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY,
        reservation_id INTEGER NOT NULL
          REFERENCES reservations(id) ON DELETE RESTRICT,
        result TEXT NOT NULL CHECK (result = 'EXITOSO'),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
  }

  private createIndexes(): void {
    this.database.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS slots_starts_at_utc_uq
      ON slots(starts_at_utc)
    `);
    this.database.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS reservations_user_idempotency_key_uq
      ON reservations(user_id, idempotency_key)
    `);
    this.database.run(`
      CREATE INDEX IF NOT EXISTS reservations_slot_status_idx
      ON reservations(slot_id, status)
    `);
    this.database.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS payments_reservation_id_uq
      ON payments(reservation_id)
    `);
  }

  private seedInitialSlotsWhenEmpty(): void {
    const slotCount = this.database.get<SlotCountRow>(
      'SELECT COUNT(*) AS slot_count FROM slots',
    )?.slot_count;

    if (slotCount !== 0) {
      return;
    }

    for (const slot of prepareInitialSlots(INITIAL_SLOTS)) {
      this.database.run(
        `INSERT OR IGNORE INTO slots (starts_at, starts_at_utc, capacity)
         VALUES (?, ?, ?)`,
        slot.startsAt,
        slot.startsAtUtc,
        slot.capacity,
      );
    }
  }
}
