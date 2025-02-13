import {
  DocModeExtension,
  DocModeProvider,
  EditorSettingExtension,
  EditorSettingProvider,
} from '@blocksuite/affine-shared/services';
import { SpecProvider } from '@blocksuite/affine-shared/utils';
import { BlockStdScope, LifeCycleWatcher } from '@blocksuite/block-std';
import { GfxControllerIdentifier } from '@blocksuite/block-std/gfx';
import {
  type BlockViewType,
  type Query,
  type SliceSnapshot,
} from '@blocksuite/store';
import { signal } from '@preact/signals-core';

import type { AffineDragHandleWidget } from '../drag-handle.js';
import { getSnapshotRect } from '../utils.js';

export class PreviewHelper {
  private readonly _calculateQuery = (selectedIds: string[]): Query => {
    const ids: Array<{ id: string; viewType: BlockViewType }> = selectedIds.map(
      id => ({
        id,
        viewType: 'display',
      })
    );

    // The ancestors of the selected blocks should be rendered as Bypass
    selectedIds.forEach(block => {
      let parent: string | null = block;
      do {
        if (!selectedIds.includes(parent)) {
          ids.push({ viewType: 'bypass', id: parent });
        }
        parent = this.widget.doc.getParent(parent)?.id ?? null;
      } while (parent && !ids.map(({ id }) => id).includes(parent));
    });

    // The children of the selected blocks should be rendered as Display
    const addChildren = (id: string) => {
      const children = this.widget.doc.getBlock(id)?.model.children ?? [];
      children.forEach(child => {
        ids.push({ viewType: 'display', id: child.id });
        addChildren(child.id);
      });
    };
    selectedIds.forEach(addChildren);

    return {
      match: ids,
      mode: 'strict',
    };
  };

  getPreviewStd = (
    blockIds: string[],
    snapshot: SliceSnapshot,
    mode: 'edgeless' | 'page'
  ) => {
    const widget = this.widget;
    const std = widget.std;
    const sourceGfx = std.get(GfxControllerIdentifier);
    const docModeService = std.get(DocModeProvider);
    const editorSetting = std.get(EditorSettingProvider).peek();
    const query = this._calculateQuery(blockIds as string[]);
    const store = widget.doc.doc.getStore({ query });
    const previewSpec = SpecProvider.getInstance().getSpec(
      mode === 'edgeless' ? 'edgeless:preview' : 'page:preview'
    );
    const settingSignal = signal({ ...editorSetting });
    const extensions = [
      DocModeExtension(docModeService),
      EditorSettingExtension(settingSignal),
    ];

    if (mode === 'edgeless') {
      if (!blockIds.includes(sourceGfx.surface!.id)) {
        blockIds.push(sourceGfx.surface!.id);
      }
      class PreviewViewportInitializer extends LifeCycleWatcher {
        static override key = 'preview-viewport-initializer';

        override mounted(): void {
          const rect = getSnapshotRect(snapshot);
          if (!rect) {
            return;
          }

          this.std.view.viewUpdated.on(payload => {
            if (payload.view.model.flavour === 'affine:page') {
              const gfx = this.std.get(GfxControllerIdentifier);

              queueMicrotask(() => {
                gfx.viewport.setViewportByBound(rect);
              });
            }
          });
        }
      }

      extensions.push(PreviewViewportInitializer);
    }

    previewSpec.extend(extensions);

    settingSignal.value = {
      ...settingSignal.value,
      edgelessDisableScheduleUpdate: true,
    };

    const previewStd = new BlockStdScope({
      store,
      extensions: previewSpec.value,
    });

    let width: number = 500;
    let height;

    if (mode === 'page') {
      const noteBlock = this.widget.host.querySelector('affine-note');
      width = noteBlock?.offsetWidth ?? noteBlock?.clientWidth ?? 500;
    } else {
      const rect = getSnapshotRect(snapshot);
      if (rect) {
        width = rect.w;
        height = rect.h;
      } else {
        height = 500;
      }
    }

    return {
      previewStd,
      width,
      height,
    };
  };

  renderDragPreview = (options: {
    blockIds: string[];
    snapshot: SliceSnapshot;
    container: HTMLElement;
    mode: 'page' | 'edgeless';
  }): void => {
    const { blockIds, snapshot, container, mode } = options;
    const { previewStd, width, height } = this.getPreviewStd(
      blockIds,
      snapshot,
      mode
    );
    const previewTemplate = previewStd.render();

    container.style.width = `${width}px`;
    if (height) {
      container.style.height = `${height}px`;
    }
    container.append(previewTemplate);
  };

  constructor(readonly widget: AffineDragHandleWidget) {}
}
