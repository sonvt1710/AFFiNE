import {
  type EditorHost,
  ShadowlessElement,
} from '@blocksuite/affine/block-std';
import { createLitPortal } from '@blocksuite/affine/blocks';
import { WithDisposable } from '@blocksuite/affine/global/utils';
import { PlusIcon } from '@blocksuite/icons/lit';
import { flip, offset } from '@floating-ui/dom';
import { css, html } from 'lit';
import { property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { AIProvider } from '../provider';
import type { DocDisplayConfig, DocSearchMenuConfig } from './chat-config';
import type { BaseChip, ChatChip, ChatContextValue } from './chat-context';
import { getChipKey, isDocChip, isFileChip } from './components/utils';

export class ChatPanelChips extends WithDisposable(ShadowlessElement) {
  static override styles = css`
    .chips-wrapper {
      display: flex;
      flex-wrap: wrap;
    }
    .add-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: 1px solid var(--affine-border-color);
      border-radius: 4px;
      margin: 4px 0;
      box-sizing: border-box;
      cursor: pointer;
    }
    .add-button:hover {
      background-color: var(--affine-hover-color);
    }
  `;

  private _abortController: AbortController | null = null;

  @property({ attribute: false })
  accessor host!: EditorHost;

  @property({ attribute: false })
  accessor chatContextValue!: ChatContextValue;

  @property({ attribute: false })
  accessor chatContextId!: string | undefined;

  @property({ attribute: false })
  accessor updateContext!: (context: Partial<ChatContextValue>) => void;

  @property({ attribute: false })
  accessor docDisplayConfig!: DocDisplayConfig;

  @property({ attribute: false })
  accessor docSearchMenuConfig!: DocSearchMenuConfig;

  @query('.add-button')
  accessor addButton!: HTMLDivElement;

  override render() {
    return html` <div class="chips-wrapper">
      <div class="add-button" @click=${this._toggleAddDocMenu}>
        ${PlusIcon()}
      </div>
      ${repeat(
        this.chatContextValue.chips,
        chip => getChipKey(chip),
        chip => {
          if (isDocChip(chip)) {
            return html`<chat-panel-doc-chip
              .chip=${chip}
              .addChip=${this._addChip}
              .updateChip=${this._updateChip}
              .removeChip=${this._removeChip}
              .docDisplayConfig=${this.docDisplayConfig}
              .host=${this.host}
            ></chat-panel-doc-chip>`;
          }
          if (isFileChip(chip)) {
            return html`<chat-panel-file-chip
              .chip=${chip}
            ></chat-panel-file-chip>`;
          }
          return null;
        }
      )}
    </div>`;
  }

  private readonly _toggleAddDocMenu = () => {
    if (this._abortController) {
      this._abortController.abort();
      return;
    }

    this._abortController = new AbortController();
    this._abortController.signal.addEventListener('abort', () => {
      this._abortController = null;
    });

    createLitPortal({
      template: html`
        <chat-panel-add-popover
          .addChip=${this._addChip}
          .docSearchMenuConfig=${this.docSearchMenuConfig}
          .abortController=${this._abortController}
        ></chat-panel-add-popover>
      `,
      portalStyles: {
        zIndex: 'var(--affine-z-index-popover)',
      },
      container: document.body,
      computePosition: {
        referenceElement: this.addButton,
        placement: 'top-start',
        middleware: [offset({ crossAxis: -30, mainAxis: 10 }), flip()],
        autoUpdate: { animationFrame: true },
      },
      abortController: this._abortController,
      closeOnClickAway: true,
    });
  };

  private readonly _addChip = async (chip: ChatChip) => {
    if (
      this.chatContextValue.chips.length === 1 &&
      this.chatContextValue.chips[0].state === 'candidate'
    ) {
      await this._addToContext(chip);
      this.updateContext({
        chips: [chip],
      });
      return;
    }
    // remove the chip if it already exists
    const chips = this.chatContextValue.chips.filter(item => {
      if (isDocChip(chip)) {
        return !isDocChip(item) || item.docId !== chip.docId;
      } else {
        return !isFileChip(item) || item.fileId !== chip.fileId;
      }
    });
    if (chips.length < this.chatContextValue.chips.length) {
      await this._removeFromContext(chip);
    }
    await this._addToContext(chip);
    this.updateContext({
      chips: [...chips, chip],
    });
  };

  private readonly _updateChip = (
    chip: ChatChip,
    options: Partial<BaseChip>
  ) => {
    const index = this.chatContextValue.chips.findIndex(item => {
      if (isDocChip(chip)) {
        return isDocChip(item) && item.docId === chip.docId;
      } else {
        return isFileChip(item) && item.fileId === chip.fileId;
      }
    });
    const nextChip: ChatChip = {
      ...chip,
      ...options,
    };
    this.updateContext({
      chips: [
        ...this.chatContextValue.chips.slice(0, index),
        nextChip,
        ...this.chatContextValue.chips.slice(index + 1),
      ],
    });
  };

  private readonly _removeChip = async (chip: ChatChip) => {
    if (isDocChip(chip)) {
      await this._removeFromContext(chip);
      this.updateContext({
        chips: this.chatContextValue.chips.filter(item => {
          return !isDocChip(item) || item.docId !== chip.docId;
        }),
      });
    } else {
      await this._removeFromContext(chip);
      this.updateContext({
        chips: this.chatContextValue.chips.filter(item => {
          return !isFileChip(item) || item.fileId !== chip.fileId;
        }),
      });
    }
  };

  private readonly _addToContext = async (chip: ChatChip) => {
    if (!AIProvider.context || !this.chatContextId) {
      return;
    }
    if (isDocChip(chip)) {
      await AIProvider.context.addContextDoc({
        contextId: this.chatContextId,
        docId: chip.docId,
      });
    } else {
      await AIProvider.context.addContextFile({
        contextId: this.chatContextId,
        fileId: chip.fileId,
      });
    }
  };

  private readonly _removeFromContext = async (chip: ChatChip) => {
    if (!AIProvider.context || !this.chatContextId) {
      return;
    }
    if (isDocChip(chip)) {
      await AIProvider.context.removeContextDoc({
        contextId: this.chatContextId,
        docId: chip.docId,
      });
    } else {
      await AIProvider.context.removeContextFile({
        contextId: this.chatContextId,
        fileId: chip.fileId,
      });
    }
  };
}
