import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

@Injectable()
export class AuthDatabaseService implements OnModuleDestroy {
  private readonly connection: Database.Database;

  constructor(configService: ConfigService) {
    const configuredPath = configService
      .get<string>('AUTH_DATABASE_PATH')
      ?.trim();
    const databasePath = configuredPath || resolve(process.cwd(), 'data/auth.db');

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

  onModuleDestroy(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}