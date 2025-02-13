import { AIChatBlockSpec } from '@affine/core/blocksuite/presets/blocks/ai-chat-block';
import { PeekViewService } from '@affine/core/modules/peek-view';
import { AppThemeService } from '@affine/core/modules/theme';
import {
  type BlockStdScope,
  LifeCycleWatcher,
  StdIdentifier,
} from '@blocksuite/affine/block-std';
import {
  ColorScheme,
  createSignalFromObservable,
  type Signal,
  type SpecBuilder,
  SpecProvider,
  type ThemeExtension,
  ThemeExtensionIdentifier,
} from '@blocksuite/affine/blocks';
import type { Container } from '@blocksuite/affine/global/di';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { FrameworkProvider } from '@toeverything/infra';
import type { Observable } from 'rxjs';

import { buildDocDisplayMetaExtension } from './custom/root-block';
import { patchPeekViewService } from './custom/spec-patchers';
import { getFontConfigExtension } from './font-extension';

const CustomSpecs: ExtensionType[] = [
  AIChatBlockSpec,
  getFontConfigExtension(),
].flat();

function patchPreviewSpec(id: string, specs: ExtensionType[]) {
  const specProvider = SpecProvider.getInstance();
  specProvider.extendSpec(id, specs);
}

export function effects() {
  // Patch edgeless preview spec for blocksuite surface-ref and embed-synced-doc
  patchPreviewSpec('edgeless:preview', CustomSpecs);
}

export function getPagePreviewThemeExtension(framework: FrameworkProvider) {
  class AffinePagePreviewThemeExtension
    extends LifeCycleWatcher
    implements ThemeExtension
  {
    static override readonly key = 'affine-page-preview-theme';

    readonly theme: Signal<ColorScheme>;

    readonly disposables: (() => void)[] = [];

    static override setup(di: Container) {
      super.setup(di);
      di.override(ThemeExtensionIdentifier, AffinePagePreviewThemeExtension, [
        StdIdentifier,
      ]);
    }

    constructor(std: BlockStdScope) {
      super(std);
      const theme$: Observable<ColorScheme> = framework
        .get(AppThemeService)
        .appTheme.theme$.map(theme => {
          return theme === ColorScheme.Dark
            ? ColorScheme.Dark
            : ColorScheme.Light;
        });
      const { signal, cleanup } = createSignalFromObservable<ColorScheme>(
        theme$,
        ColorScheme.Light
      );
      this.theme = signal;
      this.disposables.push(cleanup);
    }

    getAppTheme() {
      return this.theme;
    }

    getEdgelessTheme() {
      return this.theme;
    }

    override unmounted() {
      this.dispose();
    }

    dispose() {
      this.disposables.forEach(dispose => dispose());
    }
  }

  return AffinePagePreviewThemeExtension;
}

export function createPageModePreviewSpecs(
  framework: FrameworkProvider
): SpecBuilder {
  const specProvider = SpecProvider.getInstance();
  const pagePreviewSpec = specProvider.getSpec('page:preview');
  // Enable theme extension, doc display meta extension and peek view service
  const peekViewService = framework.get(PeekViewService);
  pagePreviewSpec.extend([
    getPagePreviewThemeExtension(framework),
    buildDocDisplayMetaExtension(framework),
    patchPeekViewService(peekViewService),
  ]);
  return pagePreviewSpec;
}
