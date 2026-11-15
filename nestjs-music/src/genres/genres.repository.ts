import { Injectable } from '@nestjs/common';
import { SqliteRepository } from '../common/repositories/sqlite.repository.js';
import { DatabaseService } from '../database/database.service.js';
import type { Genre } from './entities/genre.entity.js';

@Injectable()
export class GenresRepository extends SqliteRepository<Genre> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Genre',
      idColumn: 'GenreId',
      columns: ['GenreId', 'Name'],
    });
  }
}
