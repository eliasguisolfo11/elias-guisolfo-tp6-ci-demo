import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

@Injectable()
export class ReservationsDatabaseService implements OnModuleDestroy {
  private readonly connection: Database.Database;

  constructor(configService: ConfigService) {
    const configuredPath = configService
      .get<string>('RESERVATIONS_DATABASE_PATH')
      ?.trim();
    const databasePath =
      configuredPath || resolve(process.cwd(), 'data/reservations.db');

    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('foreign_keys = ON');
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

  transaction<Result>(operation: () => Result): Result {
    return this.connection.transaction(operation)();
  }

  transactionImmediate<Result>(operation: () => Result): Result {
    return this.connection.transaction(operation).immediate();
  }

  onModuleDestroy(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
