import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

import { metrics, OnEvent } from '../../base';
import { PgWorkspaceDocStorageAdapter } from './adapters/workspace';

@Injectable()
export class DocStorageCronJob {
  constructor(
    private readonly db: PrismaClient,
    private readonly workspace: PgWorkspaceDocStorageAdapter
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT /* everyday at 12am */)
  async cleanupExpiredHistory() {
    await this.db.snapshotHistory.deleteMany({
      where: {
        expiredAt: {
          lte: new Date(),
        },
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reportUpdatesQueueCount() {
    metrics.doc
      .gauge('updates_queue_count')
      .record(await this.db.update.count());
  }

  @OnEvent('user.deleted')
  async clearUserWorkspaces(payload: Events['user.deleted']) {
    for (const workspace of payload.ownedWorkspaces) {
      await this.workspace.deleteSpace(workspace);
    }
  }
}
