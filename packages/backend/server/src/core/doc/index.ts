import './config';

import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { QuotaModule } from '../quota';
import { PgUserspaceDocStorageAdapter } from './adapters/userspace';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';
import { DocStorageCronJob } from './job';
import { DocStorageOptions } from './options';
import { DatabaseDocReader, DocReader, DocReaderProvider } from './reader';

@Module({
  imports: [QuotaModule, PermissionModule],
  providers: [
    DocStorageOptions,
    PgWorkspaceDocStorageAdapter,
    PgUserspaceDocStorageAdapter,
    DocStorageCronJob,
    DocReaderProvider,
    DatabaseDocReader,
  ],
  exports: [
    DatabaseDocReader,
    DocReader,
    PgWorkspaceDocStorageAdapter,
    PgUserspaceDocStorageAdapter,
  ],
})
export class DocStorageModule {}
export {
  // only for doc-service
  DatabaseDocReader,
  DocReader,
  PgUserspaceDocStorageAdapter,
  PgWorkspaceDocStorageAdapter,
};

export { DocStorageAdapter, type Editor } from './storage';
