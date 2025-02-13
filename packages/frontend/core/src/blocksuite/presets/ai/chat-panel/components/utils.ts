import type { CopilotContextDoc, CopilotContextFile } from '@affine/graphql';
import { WarningIcon } from '@blocksuite/icons/lit';
import { type TemplateResult } from 'lit';

import { LoadingIcon } from '../../../blocks/_common/icon';
import type { ChatChip, ChipState, DocChip, FileChip } from '../chat-context';

export function getChipTooltip(
  state: ChipState,
  name: string,
  tooltip?: string
) {
  if (tooltip) {
    return tooltip;
  }
  if (state === 'candidate') {
    return 'Click to add doc';
  }
  if (state === 'processing') {
    return 'Processing...';
  }
  if (state === 'failed') {
    return 'Failed to process';
  }
  return name;
}

export function getChipIcon(
  state: ChipState,
  icon: TemplateResult<1>
): TemplateResult<1> {
  const isLoading = state === 'processing';
  const isFailed = state === 'failed';
  if (isFailed) {
    return WarningIcon();
  }
  if (isLoading) {
    return LoadingIcon;
  }
  return icon;
}

export function isDocChip(chip: ChatChip): chip is DocChip {
  return 'docId' in chip;
}

export function isFileChip(chip: ChatChip): chip is FileChip {
  return 'fileId' in chip;
}

export function isDocContext(
  context: CopilotContextDoc | CopilotContextFile
): context is CopilotContextDoc {
  return !('blobId' in context);
}

export function isFileContext(
  context: CopilotContextDoc | CopilotContextFile
): context is CopilotContextFile {
  return 'blobId' in context;
}

export function getChipKey(chip: ChatChip) {
  if (isDocChip(chip)) {
    return chip.docId;
  }
  if (isFileChip(chip)) {
    return chip.fileId;
  }
  return null;
}
