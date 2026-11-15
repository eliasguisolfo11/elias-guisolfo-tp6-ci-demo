import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReservationsIdempotencyCoordinatorDatabaseService } from './reservations-idempotency-coordinator.database.service.js';

export interface CoordinatedHttpResponse {
  status: number;
  body: unknown;
}

type TicketAdmission =
  | { kind: 'leader'; generationId: string; ticketId: string }
  | { kind: 'participant'; generationId: string; ticketId: string }
  | { kind: 'draining'; generationId: string }
  | { kind: 'conflict' };

type TicketState =
  | { kind: 'leader' }
  | { kind: 'pending' }
  | { kind: 'response'; response: CoordinatedHttpResponse }
  | { kind: 'cancelled' };

interface GenerationRow {
  generationId: string;
  canonicalContent: string;
  phase: 'RUNNING' | 'PUBLISHED' | 'ABANDONED';
  leaderTicketId: string | null;
}

interface TicketGenerationRow extends GenerationRow {
  ticketId: string;
  httpStatus: number | null;
  httpBody: string | null;
}

const ACTIVE_CONTENT_CONFLICT =
  'La clave de idempotencia ya se usó con otro contenido.';
const COORDINATION_ERROR_MESSAGE =
  'La solicitud de idempotencia fue cancelada durante la coordinación.';
const POLL_INTERVAL_MS = 5;

@Injectable()
export class ReservationsIdempotencyCoordinatorService
  implements OnModuleDestroy
{
  readonly instanceId = randomUUID();

  constructor(
    private readonly database: ReservationsIdempotencyCoordinatorDatabaseService,
  ) {}

  registerTicket(
    userId: number,
    idempotencyKey: string,
    canonicalContent: string,
  ): TicketAdmission {
    return this.database.transactionImmediate(() => {
      const generation = this.database.get<GenerationRow>(
        `SELECT generation_id AS generationId,
                canonical_content AS canonicalContent,
                phase,
                leader_ticket_id AS leaderTicketId
         FROM idempotency_generations
         WHERE user_id = ? AND idempotency_key = ?`,
        userId,
        idempotencyKey,
      );

      if (generation === undefined) {
        return this.createLeaderTicket(
          userId,
          idempotencyKey,
          canonicalContent,
        );
      }

      if (generation.canonicalContent !== canonicalContent) {
        return { kind: 'conflict' };
      }

      if (generation.phase === 'PUBLISHED') {
        return { kind: 'draining', generationId: generation.generationId };
      }

      const ticketId = randomUUID();
      this.database.run(
        `INSERT INTO idempotency_tickets
           (ticket_id, generation_id, instance_id)
         VALUES (?, ?, ?)`,
        ticketId,
        generation.generationId,
        this.instanceId,
      );

      if (
        generation.phase === 'ABANDONED' ||
        generation.leaderTicketId === null
      ) {
        this.database.run(
          `UPDATE idempotency_generations
           SET phase = 'RUNNING', leader_ticket_id = ?,
               http_status = NULL, http_body = NULL
           WHERE generation_id = ?`,
          ticketId,
          generation.generationId,
        );
        return {
          kind: 'leader',
          generationId: generation.generationId,
          ticketId,
        };
      }

      return {
        kind: 'participant',
        generationId: generation.generationId,
        ticketId,
      };
    });
  }

  readTicket(ticketId: string): TicketState {
    const row = this.findTicket(ticketId);
    if (row === undefined) {
      return { kind: 'cancelled' };
    }

    if (row.phase === 'PUBLISHED') {
      return this.readPublishedResponse(row);
    }

    if (row.phase === 'ABANDONED' && row.leaderTicketId === null) {
      return this.database.transactionImmediate(() => {
        const current = this.findTicket(ticketId);
        if (current === undefined) {
          return { kind: 'cancelled' };
        }
        if (current.phase === 'PUBLISHED') {
          return this.readPublishedResponse(current);
        }
        if (
          current.phase === 'ABANDONED' &&
          current.leaderTicketId === null
        ) {
          this.database.run(
            `UPDATE idempotency_generations
             SET phase = 'RUNNING', leader_ticket_id = ?
             WHERE generation_id = ? AND phase = 'ABANDONED'
               AND leader_ticket_id IS NULL`,
            ticketId,
            current.generationId,
          );
          return { kind: 'leader' };
        }

        return current.leaderTicketId === ticketId
          ? { kind: 'leader' }
          : { kind: 'pending' };
      });
    }

    return row.leaderTicketId === ticketId
      ? { kind: 'leader' }
      : { kind: 'pending' };
  }

  publish(ticketId: string, response: CoordinatedHttpResponse): boolean {
    const row = this.database.get<{ generationId: string }>(
      `SELECT idempotency_generations.generation_id AS generationId
       FROM idempotency_tickets
       INNER JOIN idempotency_generations
         ON idempotency_generations.generation_id =
            idempotency_tickets.generation_id
       WHERE idempotency_tickets.ticket_id = ?
         AND idempotency_generations.phase = 'RUNNING'
         AND idempotency_generations.leader_ticket_id = ?`,
      ticketId,
      ticketId,
    );
    if (row === undefined) {
      return false;
    }

    const serializedBody = JSON.stringify(response.body);
    if (serializedBody === undefined) {
      throw new Error('Coordinated HTTP response body is not serializable.');
    }

    return this.database.transactionImmediate(() => {
      const result = this.database.run(
        `UPDATE idempotency_generations
         SET phase = 'PUBLISHED', http_status = ?, http_body = ?
         WHERE generation_id = ? AND phase = 'RUNNING'
           AND leader_ticket_id = ?`,
        response.status,
        serializedBody,
        row.generationId,
        ticketId,
      );
      return result.changes === 1;
    });
  }

  consume(ticketId: string): void {
    this.removeTicket(ticketId);
  }

  abandon(ticketId: string): void {
    this.removeTicket(ticketId);
  }

  async coordinate(
    userId: number,
    idempotencyKey: string,
    canonicalContent: string,
    operation: () => CoordinatedHttpResponse | Promise<CoordinatedHttpResponse>,
    signal?: AbortSignal,
  ): Promise<CoordinatedHttpResponse> {
    while (true) {
      if (signal?.aborted) {
        throw new Error(COORDINATION_ERROR_MESSAGE);
      }

      const admission = this.registerTicket(
        userId,
        idempotencyKey,
        canonicalContent,
      );

      if (admission.kind === 'conflict') {
        return {
          status: 409,
          body: { code: 409, message: ACTIVE_CONTENT_CONFLICT },
        };
      }

      if (admission.kind === 'draining') {
        await this.waitForGenerationRemoval(admission.generationId, signal);
        continue;
      }

      const ticketId = admission.ticketId;
      try {
        while (true) {
          if (signal?.aborted) {
            this.abandon(ticketId);
            throw new Error(COORDINATION_ERROR_MESSAGE);
          }

          const state = this.readTicket(ticketId);
          if (state.kind === 'cancelled') {
            throw new Error(COORDINATION_ERROR_MESSAGE);
          }

          if (state.kind === 'leader') {
            try {
              const response = await operation();
              if (!this.publish(ticketId, response)) {
                throw new Error(COORDINATION_ERROR_MESSAGE);
              }
            } catch (error) {
              this.abandon(ticketId);
              throw error;
            }
            continue;
          }

          if (state.kind === 'response') {
            this.consume(ticketId);
            return state.response;
          }

          await this.waitForChange(signal);
        }
      } catch (error) {
        this.abandon(ticketId);
        throw error;
      }
    }
  }

  onModuleDestroy(): void {
    this.database.retireInstance(this.instanceId);
  }

  private createLeaderTicket(
    userId: number,
    idempotencyKey: string,
    canonicalContent: string,
  ): TicketAdmission {
    const generationId = randomUUID();
    const ticketId = randomUUID();
    this.database.run(
      `INSERT INTO idempotency_generations (
         generation_id, user_id, idempotency_key, canonical_content,
         phase, leader_ticket_id
       ) VALUES (?, ?, ?, ?, 'RUNNING', ?)`,
      generationId,
      userId,
      idempotencyKey,
      canonicalContent,
      ticketId,
    );
    this.database.run(
      `INSERT INTO idempotency_tickets
         (ticket_id, generation_id, instance_id)
       VALUES (?, ?, ?)`,
      ticketId,
      generationId,
      this.instanceId,
    );

    return { kind: 'leader', generationId, ticketId };
  }

  private findTicket(ticketId: string): TicketGenerationRow | undefined {
    return this.database.get<TicketGenerationRow>(
      `SELECT idempotency_tickets.ticket_id AS ticketId,
              idempotency_generations.generation_id AS generationId,
              idempotency_generations.canonical_content AS canonicalContent,
              idempotency_generations.phase AS phase,
              idempotency_generations.leader_ticket_id AS leaderTicketId,
              idempotency_generations.http_status AS httpStatus,
              idempotency_generations.http_body AS httpBody
       FROM idempotency_tickets
       INNER JOIN idempotency_generations
         ON idempotency_generations.generation_id =
            idempotency_tickets.generation_id
       WHERE idempotency_tickets.ticket_id = ?`,
      ticketId,
    );
  }

  private readPublishedResponse(row: TicketGenerationRow): TicketState {
    if (row.httpStatus === null || row.httpBody === null) {
      throw new Error('Published idempotency result is incomplete.');
    }

    const body: unknown = JSON.parse(row.httpBody);
    return {
      kind: 'response',
      response: { status: row.httpStatus, body },
    };
  }

  private removeTicket(ticketId: string): void {
    this.database.transactionImmediate(() => {
      const ticket = this.database.get<{
        generationId: string;
        phase: GenerationRow['phase'];
        leaderTicketId: string | null;
      }>(
        `SELECT idempotency_generations.generation_id AS generationId,
                idempotency_generations.phase AS phase,
                idempotency_generations.leader_ticket_id AS leaderTicketId
         FROM idempotency_tickets
         INNER JOIN idempotency_generations
           ON idempotency_generations.generation_id =
              idempotency_tickets.generation_id
         WHERE idempotency_tickets.ticket_id = ?`,
        ticketId,
      );

      if (ticket === undefined) {
        return;
      }

      if (
        ticket.leaderTicketId === ticketId &&
        ticket.phase === 'RUNNING'
      ) {
        this.database.run(
          `UPDATE idempotency_generations
           SET phase = 'ABANDONED', leader_ticket_id = NULL,
               http_status = NULL, http_body = NULL
           WHERE generation_id = ?`,
          ticket.generationId,
        );
      }

      this.database.run(
        'DELETE FROM idempotency_tickets WHERE ticket_id = ?',
        ticketId,
      );

      const remainingTickets = this.database.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM idempotency_tickets
         WHERE generation_id = ?`,
        ticket.generationId,
      );
      if (remainingTickets?.count === 0) {
        this.database.run(
          'DELETE FROM idempotency_generations WHERE generation_id = ?',
          ticket.generationId,
        );
      }
    });
  }

  private async waitForGenerationRemoval(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    while (
      this.database.get<{ generationId: string }>(
        `SELECT generation_id AS generationId
         FROM idempotency_generations WHERE generation_id = ?`,
        generationId,
      ) !== undefined
    ) {
      await this.waitForChange(signal);
    }
  }

  private async waitForChange(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error(COORDINATION_ERROR_MESSAGE);
    }

    await new Promise<void>((resolveWait) => {
      const finish = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', finish);
        resolveWait();
      };
      const timer = setTimeout(finish, POLL_INTERVAL_MS);
      signal?.addEventListener('abort', finish, { once: true });
    });

    if (signal?.aborted) {
      throw new Error(COORDINATION_ERROR_MESSAGE);
    }
  }
}
