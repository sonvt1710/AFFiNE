import {
  type BlockStdScope,
  LifeCycleWatcher,
  LifeCycleWatcherIdentifier,
  StdIdentifier,
} from '@blocksuite/block-std';
import { GfxControllerIdentifier } from '@blocksuite/block-std/gfx';
import { type Container, type ServiceIdentifier } from '@blocksuite/global/di';
import { Pane } from 'tweakpane';

import { getSentenceRects, segmentSentences } from './text-utils.js';
import { type ParagraphLayout, type SectionLayout } from './types.js';

export const ViewportTurboRendererIdentifier = LifeCycleWatcherIdentifier(
  'ViewportTurboRenderer'
) as ServiceIdentifier<ViewportTurboRendererExtension>;

export class ViewportTurboRendererExtension extends LifeCycleWatcher {
  static override setup(di: Container) {
    di.addImpl(ViewportTurboRendererIdentifier, this, [StdIdentifier]);
  }

  public readonly canvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly worker: Worker;
  private lastZoom: number | null = null;
  private lastSection: SectionLayout | null = null;
  private lastBitmap: ImageBitmap | null = null;
  private debugPane: Pane | null = null;

  constructor(std: BlockStdScope) {
    super(std);
    this.worker = new Worker(new URL('./painter.worker.ts', import.meta.url), {
      type: 'module',
    });
  }

  override mounted() {
    const viewportElement = document.querySelector('.affine-edgeless-viewport');
    if (viewportElement) {
      viewportElement.append(this.canvas);
      this.debugPane = new Pane({ container: viewportElement as HTMLElement });
      this.initTweakpane();
    }
    this.viewport.viewportUpdated.on(async () => {
      await this.render();
    });

    document.fonts.load('15px Inter').then(async () => {
      await this.render();
    });
  }

  override unmounted() {
    if (this.lastBitmap) {
      this.lastBitmap.close();
    }
    if (this.debugPane) {
      this.debugPane.dispose();
      this.debugPane = null;
    }
    this.worker.terminate();
    this.canvas.remove();
  }

  private initTweakpane() {
    if (!this.debugPane) return;

    const paneElement = this.debugPane.element;
    paneElement.style.position = 'absolute';
    paneElement.style.top = '10px';
    paneElement.style.left = '10px';
    paneElement.style.width = '250px';

    this.debugPane.title = 'Viewport Turbo Renderer';

    const params = {
      enabled: true,
    };

    this.debugPane
      .addBinding(params, 'enabled', {
        label: 'Enable',
      })
      .on('change', ({ value }) => {
        this.canvas.style.display = value ? 'block' : 'none';
      });
  }

  get viewport() {
    return this.std.get(GfxControllerIdentifier).viewport;
  }

  getHostRect() {
    return this.std.host.getBoundingClientRect();
  }

  getHostLayout() {
    if (!document.fonts.check('15px Inter')) return null;

    const paragraphBlocks = this.std.host.querySelectorAll(
      '.affine-paragraph-rich-text-wrapper [data-v-text="true"]'
    );

    const { viewport } = this;
    const zoom = this.viewport.zoom;
    const hostRect = this.getHostRect();

    let sectionMinX = Infinity;
    let sectionMinY = Infinity;
    let sectionMaxX = -Infinity;
    let sectionMaxY = -Infinity;

    const paragraphs: ParagraphLayout[] = Array.from(paragraphBlocks).map(p => {
      const sentences = segmentSentences(p.textContent || '');
      const sentenceLayouts = sentences.map(sentence => {
        const rects = getSentenceRects(p, sentence);
        rects.forEach(({ rect }) => {
          sectionMinX = Math.min(sectionMinX, rect.x);
          sectionMinY = Math.min(sectionMinY, rect.y);
          sectionMaxX = Math.max(sectionMaxX, rect.x + rect.w);
          sectionMaxY = Math.max(sectionMaxY, rect.y + rect.h);
        });
        return {
          text: sentence,
          rects: rects.map(rect => {
            const [x, y] = viewport.toModelCoordFromClientCoord([
              rect.rect.x,
              rect.rect.y,
            ]);
            return {
              ...rect,
              rect: {
                x,
                y,
                w: rect.rect.w / zoom / viewport.viewScale,
                h: rect.rect.h / zoom / viewport.viewScale,
              },
            };
          }),
        };
      });

      return {
        sentences: sentenceLayouts,
        zoom,
      };
    });

    if (paragraphs.length === 0) return null;

    const sectionModelCoord = viewport.toModelCoordFromClientCoord([
      sectionMinX,
      sectionMinY,
    ]);
    const w = (sectionMaxX - sectionMinX) / zoom / viewport.viewScale;
    const h = (sectionMaxY - sectionMinY) / zoom / viewport.viewScale;
    const section: SectionLayout = {
      paragraphs,
      rect: {
        x: sectionModelCoord[0],
        y: sectionModelCoord[1],
        w: Math.max(w, 0),
        h: Math.max(h, 0),
      },
    };

    return { section, hostRect };
  }

  private initSectionRenderer(width: number, height: number) {
    const dpr = window.devicePixelRatio;
    this.worker.postMessage({
      type: 'initSection',
      data: { width, height, dpr, zoom: this.viewport.zoom },
    });
  }

  private async renderSection(section: SectionLayout): Promise<void> {
    return new Promise(resolve => {
      if (!this.worker) return;

      this.worker.postMessage({
        type: 'paintSection',
        data: { section },
      });

      this.worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'bitmapPainted') {
          this.handlePaintedBitmap(e.data.bitmap, section, resolve);
        }
      };
    });
  }

  private handlePaintedBitmap(
    bitmap: ImageBitmap,
    section: SectionLayout,
    resolve: () => void
  ) {
    const tempCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(bitmap, 0, 0);
    const bitmapCopy = tempCanvas.transferToImageBitmap();

    this.updateCacheState(section, bitmapCopy);
    this.drawBitmap(bitmap, section);
    resolve();
  }

  private syncCanvasSize() {
    const hostRect = this.getHostRect();
    const dpr = window.devicePixelRatio;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = '0px';
    this.canvas.style.top = '0px';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.width = hostRect.width * dpr;
    this.canvas.height = hostRect.height * dpr;
    this.canvas.style.pointerEvents = 'none';
  }

  private updateCacheState(section: SectionLayout, bitmapCopy: ImageBitmap) {
    this.lastZoom = this.viewport.zoom;
    this.lastSection = section;
    if (this.lastBitmap) {
      this.lastBitmap.close();
    }
    this.lastBitmap = bitmapCopy;
  }

  private canUseCache(currentZoom: number): boolean {
    return (
      this.lastZoom === currentZoom && !!this.lastSection && !!this.lastBitmap
    );
  }

  private drawBitmap(bitmap: ImageBitmap, section: SectionLayout) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const bitmapCanvas = new OffscreenCanvas(
      section.rect.w * window.devicePixelRatio * this.viewport.zoom,
      section.rect.h * window.devicePixelRatio * this.viewport.zoom
    );
    const bitmapCtx = bitmapCanvas.getContext('bitmaprenderer');
    if (!bitmapCtx) return;

    const tempCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(bitmap, 0, 0);
    const bitmapCopy = tempCanvas.transferToImageBitmap();

    bitmapCtx.transferFromImageBitmap(bitmapCopy);

    const sectionViewCoord = this.viewport.toViewCoord(
      section.rect.x,
      section.rect.y
    );

    ctx.drawImage(
      bitmapCanvas,
      sectionViewCoord[0] * window.devicePixelRatio,
      sectionViewCoord[1] * window.devicePixelRatio,
      section.rect.w * window.devicePixelRatio * this.viewport.zoom,
      section.rect.h * window.devicePixelRatio * this.viewport.zoom
    );
  }

  public async render(): Promise<void> {
    const hostLayout = this.getHostLayout();
    if (!hostLayout) return;

    const { section } = hostLayout;
    const currentZoom = this.viewport.zoom;

    if (this.canUseCache(currentZoom)) {
      this.drawBitmap(this.lastBitmap!, this.lastSection!);
    } else {
      this.syncCanvasSize();
      this.initSectionRenderer(section.rect.w, section.rect.h);
      await this.renderSection(section);
    }
  }
}
