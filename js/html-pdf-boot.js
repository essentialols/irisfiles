import {init} from './html-pdf-ui.js';
import {exposeFilePicker} from './ux-page.js';
init();
// This page skips applyPageUX, so expose the file input here.
exposeFilePicker();
