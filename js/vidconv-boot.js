import { applyPageUX } from './ux-page.js';
import { init } from './vidconv-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First run downloads FFmpeg (~10 MB) and initializes it. Large videos may take extra setup time.',
    dismissible: true,
  },
});
