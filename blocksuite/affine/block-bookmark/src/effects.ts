import { BookmarkBlockComponent } from './bookmark-block';
import { BookmarkEdgelessBlockComponent } from './bookmark-edgeless-block';
import { BookmarkCard } from './components/bookmark-card';
import {
  EmbedCardCreateModal,
  EmbedCardEditCaptionEditModal,
  EmbedCardEditModal,
} from './components/embed-card-modal';

export function effects() {
  customElements.define(
    'affine-edgeless-bookmark',
    BookmarkEdgelessBlockComponent
  );
  customElements.define('affine-bookmark', BookmarkBlockComponent);
  customElements.define('bookmark-card', BookmarkCard);

  customElements.define('embed-card-create-modal', EmbedCardCreateModal);
  customElements.define('embed-card-edit-modal', EmbedCardEditModal);
  customElements.define(
    'embed-card-caption-edit-modal',
    EmbedCardEditCaptionEditModal
  );
}
