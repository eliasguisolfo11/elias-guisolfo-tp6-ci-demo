import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connection: Database.Database;

  constructor(configService: ConfigService) {
    const configuredPath = configService.get<string>('DATABASE_PATH')?.trim();
    const databasePath = configuredPath || resolve(process.cwd(), 'data/chinook.db');

    this.connection = new Database(databasePath, { fileMustExist: true });
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

  registerSearchKeyFunction(
    normalize: (value: string | null) => string | null,
  ): void {
    this.connection.function('search_key', { deterministic: true }, normalize);
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
