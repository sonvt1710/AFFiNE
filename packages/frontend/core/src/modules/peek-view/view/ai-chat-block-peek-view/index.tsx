import { toReactNode } from '@affine/component';
import { AIChatBlockPeekViewTemplate } from '@affine/core/blocksuite/presets/ai';
import type { EditorHost } from '@blocksuite/affine/block-std';
import { useFramework } from '@toeverything/infra';
import { useMemo } from 'react';

import type { AIChatBlockModel } from '../../../../blocksuite/blocks/ai-chat-block/ai-chat-model';
import { createPageModePreviewSpecs } from '../../../../components/blocksuite/block-suite-editor/specs/preview';

export type AIChatBlockPeekViewProps = {
  model: AIChatBlockModel;
  host: EditorHost;
};

export const AIChatBlockPeekView = ({
  model,
  host,
}: AIChatBlockPeekViewProps) => {
  const framework = useFramework();
  return useMemo(() => {
    const previewSpecBuilder = createPageModePreviewSpecs(framework);
    const template = AIChatBlockPeekViewTemplate(
      model,
      host,
      previewSpecBuilder
    );
    return toReactNode(template);
  }, [framework, model, host]);
};
