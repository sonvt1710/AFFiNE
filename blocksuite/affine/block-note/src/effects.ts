import type { NoteConfig } from './config';
import { NoteBlockComponent } from './note-block';
import {
  EdgelessNoteBlockComponent,
  EdgelessNoteMask,
} from './note-edgeless-block';
import type { NoteBlockService } from './note-service';

export function effects() {
  customElements.define('affine-note', NoteBlockComponent);
  customElements.define('edgeless-note-mask', EdgelessNoteMask);
  customElements.define('affine-edgeless-note', EdgelessNoteBlockComponent);
}

declare global {
  namespace BlockSuite {
    interface BlockServices {
      'affine:note': NoteBlockService;
    }
    interface BlockConfigs {
      'affine:note': NoteConfig;
    }
  }
}
