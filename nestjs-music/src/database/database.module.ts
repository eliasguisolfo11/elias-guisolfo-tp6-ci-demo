import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { SearchIndexService } from './search-index.service.js';

@Global()
@Module({
  providers: [DatabaseService, SearchIndexService],
  exports: [DatabaseService, SearchIndexService],
})
export class DatabaseModule {}
