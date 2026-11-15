import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SqliteRepository } from '../common/repositories/sqlite.repository.js';
import type { Artist } from './entities/artist.entity.js';

@Injectable()
export class ArtistsRepository extends SqliteRepository<Artist> {
  constructor(database: DatabaseService) {
    super(database, {
      tableName: 'Artist',
      idColumn: 'ArtistId',
      columns: ['ArtistId', 'Name'],
    });
  }
}
