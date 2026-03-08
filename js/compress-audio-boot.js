import { applyPageUX } from './ux-page.js';
import { init } from './compress-audio-ui.js';

init();
applyPageUX({
  preflight: {
    text: 'First run may download the audio compression engine (~10 MB) before conversion starts.',
    dismissible: true,
  },
});
