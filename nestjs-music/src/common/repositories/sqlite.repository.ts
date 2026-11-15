import { BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export interface SqliteRepositoryOptions<Row extends object> {
  tableName: string;
  idColumn: keyof Row & string;
  columns: readonly (keyof Row & string)[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

function isIntegrityConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    (error.code === 'SQLITE_CONSTRAINT' ||
      error.code.startsWith('SQLITE_CONSTRAINT_'))
  );
}

function translateForeignKeyViolation(
  error: unknown,
  operation: 'write' | 'delete',
): never {
  if (!isForeignKeyViolation(error)) {
    throw error;
  }

  if (operation === 'delete') {
    throw new ConflictException(
      'No se puede eliminar el registro porque tiene elementos asociados.',
    );
  }

  throw new BadRequestException('La referencia indicada no existe.');
}

function translateIntegrityConstraintViolation(error: unknown): never {
  if (!isIntegrityConstraintViolation(error) || isForeignKeyViolation(error)) {
    throw error;
  }

  throw new ConflictException(
    'La operación entra en conflicto con una restricción de integridad.',
  );
}

export abstract class SqliteRepository<Row extends object> {
  private static readonly maximumPageSize = 100;

  protected readonly tableName: string;
  protected readonly idColumn: keyof Row & string;
  protected readonly columns: readonly (keyof Row & string)[];

  protected constructor(
    protected readonly database: DatabaseService,
    options: SqliteRepositoryOptions<Row>,
  ) {
    this.tableName = options.tableName;
    this.idColumn = options.idColumn;
    this.columns = options.columns;
  }

  page(skip = 0, limit = 100): Row[] {
    const selectedColumns = this.columns.map(quoteIdentifier).join(', ');
    const boundedLimit = Math.min(limit, SqliteRepository.maximumPageSize);
    const sql = `SELECT ${selectedColumns} FROM ${quoteIdentifier(this.tableName)} ` +
      `ORDER BY ${quoteIdentifier(this.idColumn)} ASC LIMIT ? OFFSET ?`;

    return this.database.all<Row>(sql, boundedLimit, skip);
  }

  findById(id: number | string): Row | null {
    const selectedColumns = this.columns.map(quoteIdentifier).join(', ');
    const sql = `SELECT ${selectedColumns} FROM ${quoteIdentifier(this.tableName)} ` +
      `WHERE ${quoteIdentifier(this.idColumn)} = ? LIMIT 1`;

    return this.database.get<Row>(sql, id) ?? null;
  }

  insert(values: Partial<Row>): Row {
    const entries = this.getAllowedEntries(values);
    const columnSql = entries
      .map(({ column }) => quoteIdentifier(column))
      .join(', ');
    const placeholders = entries.map(() => '?').join(', ');
    const sql = entries.length > 0
      ? `INSERT INTO ${quoteIdentifier(this.tableName)} (${columnSql}) VALUES (${placeholders})`
      : `INSERT INTO ${quoteIdentifier(this.tableName)} DEFAULT VALUES`;

    try {
      return this.database.transaction(() => {
        const result = this.database.run(
          sql,
          ...entries.map(({ value }) => value),
        );
        const inserted = this.findById(Number(result.lastInsertRowid));
        if (inserted === null) {
          throw new Error('No se pudo recuperar el registro recién creado.');
        }
        return inserted;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        translateForeignKeyViolation(error, 'write');
      }
      translateIntegrityConstraintViolation(error);
    }
  }

  patch(id: number | string, values: Partial<Row>): Row | null {
    const entries = this.getAllowedEntries(values).filter(
      ({ column }) => column !== this.idColumn,
    );
    if (entries.length === 0) {
      return this.findById(id);
    }

    const assignments = entries
      .map(({ column }) => `${quoteIdentifier(column)} = ?`)
      .join(', ');
    const sql = `UPDATE ${quoteIdentifier(this.tableName)} SET ${assignments} ` +
      `WHERE ${quoteIdentifier(this.idColumn)} = ?`;

    try {
      const result = this.database.transaction(() =>
        this.database.run(
          sql,
          ...entries.map(({ value }) => value),
          id,
        ),
      );
      return result.changes > 0 ? this.findById(id) : null;
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        translateForeignKeyViolation(error, 'write');
      }
      translateIntegrityConstraintViolation(error);
    }
  }

  remove(id: number | string): boolean {
    const sql = `DELETE FROM ${quoteIdentifier(this.tableName)} ` +
      `WHERE ${quoteIdentifier(this.idColumn)} = ?`;

    try {
      const result = this.database.transaction(() =>
        this.database.run(sql, id),
      );
      return result.changes > 0;
    } catch (error) {
      translateForeignKeyViolation(error, 'delete');
    }
  }

  private getAllowedEntries(
    values: Partial<Row>,
  ): Array<{ column: keyof Row & string; value: unknown }> {
    const entries: Array<{ column: keyof Row & string; value: unknown }> = [];
    for (const column of this.columns) {
      if (Object.prototype.hasOwnProperty.call(values, column)) {
        entries.push({ column, value: values[column] });
      }
    }
    return entries;
  }
}
