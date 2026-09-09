import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const pages = {
  'heic-to-pdf.html': {
    h1: 'Convert HEIC to PDF privately.',
    canonical: 'https://irisfiles.com/heic-to-pdf',
    required: ['not a lossless archival transformation', 'up to 50 HEIC photos', 'HEIC, HEIF, and PDF'],
    forbidden: ['visually identical to the original'],
  },
  'm4a-to-wav.html': {
    h1: 'Convert M4A to WAV privately.',
    canonical: 'https://irisfiles.com/m4a-to-wav',
    required: ['16-bit PCM WAV', 'M4A is a container, not one audio codec', 'DRM-protected media'],
    forbidden: ['WAV is lossless, so converted files keep detail'],
  },
  'mp3-to-ogg.html': {
    h1: 'Convert MP3 to OGG privately.',
    canonical: 'https://irisfiles.com/mp3-to-ogg',
    required: ['OGG Vorbis', 'libvorbis quality level 4', 'OGG, Vorbis, and Opus are not the same thing'],
    forbidden: ['decodes the MP3 audio using the Web Audio API, then re-encodes it as OGG Vorbis'],
  },
  'mov-to-gif.html': {
    h1: 'Convert MOV to GIF privately.',
    canonical: 'https://irisfiles.com/mov-to-gif',
    required: ['first 60 seconds', 'GIF has no audio track', 'How MOV to GIF conversion works'],
    forbidden: ['HEVC MOV files work in Safari and recent Chrome versions'],
  },
  'gif-to-png.html': {
    h1: 'Convert GIF to PNG privately.',
    canonical: 'https://irisfiles.com/gif-to-png',
    required: ['only the first frame', 'GIF vs PNG', 'Why can the PNG be larger than the GIF?'],
    forbidden: [],
  },
  'ttf-to-otf.html': {
    h1: 'Convert TTF to OTF privately.',
    canonical: 'https://irisfiles.com/ttf-to-otf',
    required: ['TTF to OTF does not improve font quality', 'Why can conversion fail?', 'not every advanced OpenType table'],
    forbidden: ['All glyphs, metrics, and font tables are preserved'],
  },
};

let failures = 0;

function check(condition, message) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

for (const [file, spec] of Object.entries(pages)) {
  const html = readFileSync(resolve(ROOT, file), 'utf8');

  check(html.includes(`<h1 class="drop-zone__title">${spec.h1}</h1>`), `${file}: treatment H1 drifted`);
  check(html.includes(`<link rel="canonical" href="${spec.canonical}">`), `${file}: canonical drifted`);
  check(html.includes('<section class="prose">'), `${file}: missing treatment prose section`);

  for (const phrase of spec.required) {
    check(html.includes(phrase), `${file}: required treatment fact missing: ${phrase}`);
  }
  for (const phrase of spec.forbidden) {
    check(!html.includes(phrase), `${file}: stale/incorrect claim reintroduced: ${phrase}`);
  }

  const ldMatch = html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/);
  check(Boolean(ldMatch), `${file}: missing JSON-LD`);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      const faq = Array.isArray(ld) ? ld.find(item => item['@type'] === 'FAQPage') : null;
      check(Boolean(faq), `${file}: missing FAQPage JSON-LD`);
      if (faq) {
        for (const item of faq.mainEntity || []) {
          const q = item?.name;
          check(Boolean(q) && html.includes(`<button class="faq-question">${q}</button>`),
            `${file}: JSON-LD FAQ question is not synchronized with visible FAQ: ${q || '(missing)'}`);
        }
      }
    } catch (err) {
      check(false, `${file}: JSON-LD parse failed: ${err.message}`);
    }
  }
}

if (failures) {
  console.error(`\nSEO treatment checks failed: ${failures}`);
  process.exit(1);
}

console.log(`SEO treatment checks passed for ${Object.keys(pages).length} pages.`);
