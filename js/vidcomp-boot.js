import { applyPageUX } from './ux-page.js';
import { init } from './vidcomp-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First run downloads FFmpeg (~10 MB) and initializes it before video compression begins.',
    dismissible: true,
  },
});
