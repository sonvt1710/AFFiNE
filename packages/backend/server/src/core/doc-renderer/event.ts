import { FactoryProvider } from '@nestjs/common';

import { Config, OnEvent } from '../../base';
import { DocContentService } from './service';

class DocEventsListener {
  constructor(private readonly doc: DocContentService) {}

  @OnEvent('doc.snapshot.updated')
  async handleDocSnapshotUpdated({
    workspaceId,
    docId,
  }: Events['doc.snapshot.updated']) {
    await this.doc.markDocContentCacheStale(workspaceId, docId);
  }
}

export const DocEventsListenerProvider: FactoryProvider = {
  provide: DocEventsListener,
  useFactory: (config: Config, doc: DocContentService) => {
    if (config.flavor.renderer) {
      return new DocEventsListener(doc);
    }
    return;
  },
  inject: [Config, DocContentService],
};
