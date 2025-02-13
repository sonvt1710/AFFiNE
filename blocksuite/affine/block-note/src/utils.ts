import { NoteBlockModel, NoteDisplayMode } from '@blocksuite/affine-model';
import { FeatureFlagService } from '@blocksuite/affine-shared/services';
import { matchModels } from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/block-std';

/**
 * We define a note block as a page block if it is the first visible note
 */
export function isPageBlock(std: BlockStdScope, note: NoteBlockModel) {
  return (
    std.get(FeatureFlagService).getFlag('enable_page_block') &&
    note.parent?.children.find(
      child =>
        matchModels(child, [NoteBlockModel]) &&
        child.displayMode !== NoteDisplayMode.EdgelessOnly
    ) === note
  );
}
