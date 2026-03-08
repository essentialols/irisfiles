import { applyPageUX } from './ux-page.js';
import { init } from './audio-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First run for AAC/OGG/FLAC/M4A conversions may download FFmpeg (~10 MB) before processing starts.',
    dismissible: true,
  },
});
