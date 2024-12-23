import { ArrowDownSmallIcon } from '@blocksuite/affine-components/icons';
import { once } from '@blocksuite/affine-shared/utils';
import type { GfxToolsFullOptionValue } from '@blocksuite/block-std/gfx';
import {
  arrow,
  autoUpdate,
  computePosition,
  offset,
  shift,
} from '@floating-ui/dom';
import { css, html, LitElement } from 'lit';
import { state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';

import { EdgelessToolbarToolMixin } from '../mixins/tool.mixin.js';
import { TemplateCard1, TemplateCard2, TemplateCard3 } from './icon.js';
import type { EdgelessTemplatePanel } from './template-panel.js';

export class EdgelessTemplateButton extends EdgelessToolbarToolMixin(
  LitElement
) {
  static override styles = css`
    :host {
      position: relative;
      width: 100%;
      height: 100%;
    }

    edgeless-template-button {
      cursor: pointer;
    }

    .template-cards {
      width: 100%;
      height: 64px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }
    .template-card,
    .arrow-icon {
      --x: 0;
      --y: 0;
      --r: 0;
      --s: 1;
      position: absolute;
      transform: translate(var(--x), var(--y)) rotate(var(--r)) scale(var(--s));
      transition: all 0.3s ease;
    }

    .arrow-icon {
      --y: 17px;
      background: var(--affine-black-10);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .arrow-icon > svg {
      color: var(--affine-icon-color);
      fill: currentColor;
      width: 20px;
      height: 20px;
    }

    .template-card.card1 {
      transform-origin: 100% 50%;
      --x: 15px;
      --y: 8px;
    }
    .template-card.card2 {
      transform-origin: 0% 50%;
      --x: -17px;
    }
    .template-card.card3 {
      --y: 27px;
    }

    /* hover */
    .template-cards:not(.expanded):hover .card1 {
      --r: 8.69deg;
    }
    .template-cards:not(.expanded):hover .card2 {
      --r: -10.93deg;
    }
    .template-cards:not(.expanded):hover .card3 {
      --y: 22px;
      --r: 5.19deg;
    }

    /* expanded */
    .template-cards.expanded .card1 {
      --x: 17px;
      --y: -5px;
      --r: 8.69deg;
      --s: 0.64;
    }
    .template-cards.expanded .card2 {
      --x: -19px;
      --y: -6px;
      --r: -10.93deg;
      --s: 0.64;
    }
    .template-cards.expanded .card3 {
      --y: -10px;
      --s: 0.599;
      --r: 5.19deg;
    }
  `;

  private _cleanup: (() => void) | null = null;

  private _prevTool: GfxToolsFullOptionValue | null = null;

  override enableActiveBackground = true;

  override type: GfxToolsFullOptionValue['type'] = 'template';

  get cards() {
    const { theme } = this;
    return [TemplateCard1[theme], TemplateCard2[theme], TemplateCard3[theme]];
  }

  private _closePanel() {
    if (this._openedPanel) {
      this._openedPanel.remove();
      this._openedPanel = null;
      this._cleanup?.();
      this._cleanup = null;
      this.requestUpdate();

      if (this._prevTool && this._prevTool.type !== 'template') {
        this.setEdgelessTool(this._prevTool);
        this._prevTool = null;
      } else {
        this.setEdgelessTool('default');
      }
    }
  }

  private _togglePanel() {
    if (this._openedPanel) {
      this._closePanel();
      if (this._prevTool) {
        this.setEdgelessTool(this._prevTool);
        this._prevTool = null;
      }
      return;
    }

    this._prevTool = this.edgelessTool ? { ...this.edgelessTool } : null;

    this.setEdgelessTool('template');

    const panel = document.createElement('edgeless-templates-panel');
    panel.edgeless = this.edgeless;

    this._cleanup = once(panel, 'closepanel', () => {
      this._closePanel();
    });
    this._openedPanel = panel;

    this.renderRoot.append(panel);

    requestAnimationFrame(() => {
      const arrowEl = panel.renderRoot.querySelector('.arrow') as HTMLElement;

      autoUpdate(this, panel, () => {
        computePosition(this, panel, {
          placement: 'top',
          middleware: [offset(20), arrow({ element: arrowEl }), shift()],
        })
          .then(({ x, y, middlewareData }) => {
            panel.style.left = `${x}px`;
            panel.style.top = `${y}px`;

            arrowEl.style.left = `${
              (middlewareData.arrow?.x ?? 0) - (middlewareData.shift?.x ?? 0)
            }px`;
          })
          .catch(e => {
            console.warn("Can't compute position", e);
          });
      });
    });
  }

  override render() {
    const { cards, _openedPanel } = this;
    const expanded = _openedPanel !== null;

    return html`<edgeless-toolbar-button @click=${this._togglePanel}>
      <div class="template-cards ${expanded ? 'expanded' : ''}">
        <div class="arrow-icon">${ArrowDownSmallIcon}</div>
        ${repeat(
          cards,
          (card, n) => html`
            <div
              class=${classMap({
                'template-card': true,
                [`card${n + 1}`]: true,
              })}
            >
              ${card}
            </div>
          `
        )}
      </div>
    </edgeless-toolbar-button>`;
  }

  @state()
  private accessor _openedPanel: EdgelessTemplatePanel | null = null;
}