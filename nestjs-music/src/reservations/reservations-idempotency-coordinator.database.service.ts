import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

@Injectable()
export class ReservationsIdempotencyCoordinatorDatabaseService
  implements OnModuleDestroy
{
  private readonly connection: Database.Database;

  constructor(configService: ConfigService) {
    const configuredPath = configService
      .get<string>('RESERVATIONS_COORDINATION_DATABASE_PATH')
      ?.trim();
    const databasePath =
      configuredPath ||
      resolve(process.cwd(), 'data/reservations-coordination.db');

    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
    this.initializeSchema();
  }

  all<Row>(sql: string, ...parameters: unknown[]): Row[] {
    return this.connection.prepare(sql).all(...parameters) as Row[];
  }

  get<Row>(sql: string, ...parameters: unknown[]): Row | undefined {
    return this.connection.prepare(sql).get(...parameters) as Row | undefined;
  }

  run(sql: string, ...parameters: unknown[]): Database.RunResult {
    return this.connection.prepare(sql).run(...parameters);
  }

  transactionImmediate<Result>(operation: () => Result): Result {
    return this.connection.transaction(operation).immediate();
  }

  retireInstance(instanceId: string): void {
    this.transactionImmediate(() => {
      const ownedTickets = this.all<{
        ticketId: string;
        generationId: string;
      }>(
        `SELECT ticket_id AS ticketId, generation_id AS generationId
         FROM idempotency_tickets WHERE instance_id = ?`,
        instanceId,
      );
      if (ownedTickets.length === 0) {
        return;
      }

      this.run(
        'DELETE FROM idempotency_tickets WHERE instance_id = ?',
        instanceId,
      );

      for (const { ticketId } of ownedTickets) {
        this.run(
          `UPDATE idempotency_generations
           SET phase = 'ABANDONED', leader_ticket_id = NULL,
               http_status = NULL, http_body = NULL
           WHERE phase = 'RUNNING' AND leader_ticket_id = ?`,
          ticketId,
        );
      }

      for (const { generationId } of ownedTickets) {
        const remainingTickets = this.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM idempotency_tickets
           WHERE generation_id = ?`,
          generationId,
        );
        if (remainingTickets?.count === 0) {
          this.run(
            'DELETE FROM idempotency_generations WHERE generation_id = ?',
            generationId,
          );
        }
      }
    });
  }

  onModuleDestroy(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }

  private initializeSchema(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_generations (
        generation_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        canonical_content TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('RUNNING', 'PUBLISHED', 'ABANDONED')),
        leader_ticket_id TEXT,
        http_status INTEGER,
        http_body TEXT,
        CHECK (
          (phase = 'PUBLISHED' AND http_status IS NOT NULL AND http_body IS NOT NULL)
          OR
          (phase <> 'PUBLISHED' AND http_status IS NULL AND http_body IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idempotency_generations_user_key_uq
        ON idempotency_generations(user_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS idempotency_tickets (
        ticket_id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        FOREIGN KEY (generation_id)
          REFERENCES idempotency_generations(generation_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idempotency_tickets_generation_idx
        ON idempotency_tickets(generation_id);

      CREATE INDEX IF NOT EXISTS idempotency_tickets_instance_idx
        ON idempotency_tickets(instance_id);
    `);
  }
}
