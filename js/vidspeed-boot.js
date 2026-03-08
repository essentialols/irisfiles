import { applyPageUX } from './ux-page.js';
import { init } from './vidspeed-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First run downloads FFmpeg (~10 MB) and initializes it before speed change begins.',
    dismissible: true,
  },
});
