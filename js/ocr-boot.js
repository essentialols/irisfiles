import { applyPageUX } from './ux-page.js';
import { init } from './ocr-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First OCR run downloads language data (~2-5 MB) and initializes the OCR engine.',
    dismissible: true,
  },
});
