import { ConflictException, Injectable } from '@nestjs/common';
import { AuthDatabaseService } from './auth-database.service.js';
import {
  AuthUser,
  CreateAuthUserInput,
  AuthUserRole,
} from './auth-user.entity.js';

interface AuthUserRow {
  id: number;
  username: string;
  username_normalized: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  role: AuthUserRole;
  enabled: number;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: AuthDatabaseService) {
    this.initializeSchema();
  }

  findById(id: number): AuthUser | undefined {
    const row = this.database.get<AuthUserRow>(
      'SELECT * FROM auth_users WHERE id = ?',
      id,
    );
    return row ? this.toEntity(row) : undefined;
  }

  findByUsername(username: string): AuthUser | undefined {
    const row = this.database.get<AuthUserRow>(
      'SELECT * FROM auth_users WHERE username_normalized = ?',
      normalizeKey(username),
    );
    return row ? this.toEntity(row) : undefined;
  }

  findByEmail(email: string): AuthUser | undefined {
    const row = this.database.get<AuthUserRow>(
      'SELECT * FROM auth_users WHERE email_normalized = ?',
      normalizeKey(email),
    );
    return row ? this.toEntity(row) : undefined;
  }

  count(): number {
    return (
      this.database.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM auth_users',
      )?.count ?? 0
    );
  }

  create(input: CreateAuthUserInput): AuthUser {
    try {
      return this.database.transaction(() => {
        const result = this.database.run(
          `INSERT INTO auth_users (
            username,
            username_normalized,
            email,
            email_normalized,
            password_hash,
            role,
            enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          input.username,
          normalizeKey(input.username),
          input.email,
          normalizeKey(input.email),
          input.passwordHash,
          input.role,
          input.enabled ? 1 : 0,
        );
        const created = this.findById(Number(result.lastInsertRowid));

        if (!created) {
          throw new Error('Created auth user could not be retrieved');
        }

        return created;
      });
    } catch (error) {
      if (isAuthUserUniqueConstraintError(error)) {
        throw new ConflictException('Username or email already exists');
      }

      throw error;
    }
  }

  private initializeSchema(): void {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL CHECK (length(username_normalized) > 0),
        email TEXT NOT NULL,
        email_normalized TEXT NOT NULL CHECK (length(email_normalized) > 0),
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
      )
    `);
    this.database.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_normalized_uq
      ON auth_users (username_normalized)
    `);
    this.database.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_normalized_uq
      ON auth_users (email_normalized)
    `);
  }

  private toEntity(row: AuthUserRow): AuthUser {
    return new AuthUser(
      row.id,
      row.username,
      row.username_normalized,
      row.email,
      row.email_normalized,
      row.password_hash,
      row.role,
      row.enabled === 1,
    );
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isAuthUserUniqueConstraintError(error: unknown): boolean {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'SQLITE_CONSTRAINT_UNIQUE'
  ) {
    return false;
  }

  return (
    error.message ===
      'UNIQUE constraint failed: auth_users.username_normalized' ||
    error.message ===
      'UNIQUE constraint failed: auth_users.email_normalized'
  );
}
