import { AddButton } from './add-button';
import { SelectionLayer } from './selection-layer';
import { TableBlockComponent } from './table-block';
import { TableCell } from './table-cell';

export function effects() {
  customElements.define('affine-table', TableBlockComponent);
  customElements.define('affine-table-cell', TableCell);
  customElements.define('affine-table-add-button', AddButton);
  customElements.define('affine-table-selection-layer', SelectionLayer);
}
