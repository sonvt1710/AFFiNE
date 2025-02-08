import { EdgelessNoteBackground } from './components/edgeless-note-background';
import { EdgelessNoteMask } from './components/edgeless-note-mask';
import type { NoteConfig } from './config';
import { NoteBlockComponent } from './note-block';
import {
  AFFINE_EDGELESS_NOTE,
  EdgelessNoteBlockComponent,
} from './note-edgeless-block';
import type { NoteBlockService } from './note-service';

export function effects() {
  customElements.define('affine-note', NoteBlockComponent);
  customElements.define(AFFINE_EDGELESS_NOTE, EdgelessNoteBlockComponent);
  customElements.define('edgeless-note-mask', EdgelessNoteMask);
  customElements.define('edgeless-note-background', EdgelessNoteBackground);
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
