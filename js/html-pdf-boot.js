import {init} from './html-pdf-ui.js';
import {exposeFilePicker} from './ux-page.js';
init();
// This page is the one converter that does not go through applyPageUX, so the
// shared upload control still has to be exposed here or its file input stays
// invisible to assistive tech and automation.
exposeFilePicker();
