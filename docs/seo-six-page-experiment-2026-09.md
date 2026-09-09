# Six-page SEO ranking experiment — 2026-09-09

## Purpose

Test whether materially richer, implementation-grounded converter pages improve organic visibility for IrisFiles pages that Google already ranks, while leaving comparable converter pages unchanged.

This is not a keyword-density test. The treatment adds useful conversion-specific information: how the implementation actually works, output behavior, limitations, failure cases, format tradeoffs, and contextual internal links.

## Data source and baseline

Keyword figures below were pulled from Ubersuggest on 2026-09-09 for US English search. Search volume and SEO Difficulty (SD) are third-party estimates, not Google Search Console metrics. Positions are the IrisFiles rankings returned in that pull and should be treated as a baseline snapshot rather than a guaranteed exact rank for every user or location.

| Treatment page | Baseline keyword | US searches/mo | SD | Baseline position |
| --- | --- | ---: | ---: | ---: |
| `/heic-to-pdf` | heic to pdf | 40,500 | 31 | related page already exists; narrower `heic to pdf converter` ranked #91 |
| `/m4a-to-wav` | m4a to wav | 14,800 | 29 | #94 |
| `/mp3-to-ogg` | mp3 to ogg | 12,100 | 24 | #79 |
| `/mov-to-gif` | mov to gif | 9,900 | 46 | #104 |
| `/gif-to-png` | gif to png | 8,100 | 31 | #87 |
| `/ttf-to-otf` | ttf to otf converter | 880 | 22 | #68 |

Two low-difficulty secondary terms from the same pull are especially useful for detecting early movement:

| Page | Secondary keyword | US searches/mo | SD |
| --- | --- | ---: | ---: |
| `/mov-to-gif` | mov to gif conversion | 1,600 | 9 |
| `/gif-to-png` | change gif to png | 880 | 6 |

## Treatment

Only the six converter HTML pages above receive the page-content treatment.

Treatment elements:

1. Keep the working converter above the explanatory content.
2. Use natural query language in the H1 and headings without cloning pages for keyword variants.
3. Add a short how-to section.
4. Explain the actual implementation rather than generic format-converter copy.
5. Explain lossy/lossless behavior, container-vs-codec distinctions, or outline conversion where relevant.
6. State current limits and failure modes.
7. Correct stale or overly broad factual claims.
8. Add contextual links to the most relevant existing IrisFiles tools.
9. Keep visible FAQ text synchronized with FAQPage JSON-LD.

### Implementation-specific additions

- **HEIC → PDF:** up to 50 inputs, add-order page ordering, HEIC/HEIF distinction, image-sized PDF pages, JPEG intermediate and non-lossless behavior, current lack of paper-size/rotation/reorder controls.
- **M4A → WAV:** browser Web Audio decode, 16-bit PCM WAV output, M4A container vs AAC/ALAC codec distinction, browser/DRM failure cases, sample-rate caveat, file-size and quality tradeoff.
- **MP3 → OGG:** actual FFmpeg.wasm + libvorbis path, Ogg vs Vorbis vs Opus distinction, Vorbis quality level 4, lossy-generation warning, metadata caveat.
- **MOV → GIF:** actual frame sampling/global palette/dedup behavior, 160–800 px and 4–20 FPS controls, first-60-seconds UI limit, no audio, GIF size tradeoff, codec/browser dependency.
- **GIF → PNG:** explicit first-frame-only behavior, GIF vs PNG color/transparency differences, file-size explanation, batch behavior.
- **TTF → OTF:** actual outline rebuild behavior, no promise of universal table preservation, compatibility-not-quality framing, failure cases, batch/file limits and licensing reminder.

## Untreated comparison pages

These pages had useful Ubersuggest baseline data in the same pull and remain unchanged. They are not perfect randomized controls, but they provide a useful directional comparison against site-wide or algorithm-wide movement.

| Untreated page | Baseline keyword | US searches/mo | SD | Baseline position |
| --- | --- | ---: | ---: | ---: |
| `/flac-to-wav` | flac to wav | 1,600 | 23 | #81 |
| `/mp3-to-m4a` | mp3 to m4a | 2,400 | 30 | #83 |
| `/webm-to-gif` | webm to gif | 2,900 | 37 | #96 |
| `/tif-to-png` | tif to png | 2,900 | 27 | #84 |
| `/otf-to-ttf` | otf to ttf converter | 1,900 | 27 | #76 |
| `/mobi-to-pdf` | mobi to pdf | 3,600 | 38 | #91 |

## Primary measurement source

Use Google Search Console as the primary outcome source once the treatment is deployed. Ubersuggest is useful for discovery and occasional rank snapshots, but Search Console gives first-party Google impressions/clicks/query/page data.

For each treatment and comparison page, capture:

- impressions
- clicks
- click-through rate
- average position
- number of queries producing impressions
- number of queries with average position <= 50
- number of queries with average position <= 20
- number of queries with average position <= 10
- head-term and named-secondary-term position/impressions where Search Console exposes them

## Timing

Record the merge/deploy date separately from this research date.

Recommended windows:

- **Pre period:** 28 days ending the day before deployment.
- **Early post check:** days 8–21 after deployment. Use for crawl/index confirmation and directional movement only.
- **Primary post period:** 28 days starting after deployment, with an additional 28-day check if traffic is sparse.

Do not call a result based on the first few days. Google may recrawl different pages at different times.

## Analysis

At minimum, compare within-page pre/post changes and treatment-vs-comparison median changes.

Useful directional statistic:

`(treatment post - treatment pre) - (comparison post - comparison pre)`

Do not overinterpret this as a clean causal estimate: pages were selected intentionally, sample size is small, keywords differ in difficulty, and crawl timing may differ. The comparison is primarily a guard against mistaking a site-wide or search-wide movement for a treatment effect.

## Success criteria

The experiment is promising if, after enough recrawl time, treatment pages show a materially better pattern than untreated pages on at least two of these dimensions:

1. median average-position improvement
2. growth in impressions
3. growth in the number of ranking queries
4. movement of target queries into top 50 / top 20 / top 10
5. click growth not explained solely by overall site-wide growth

A particularly useful early signal would be movement on the low-difficulty secondary terms `mov to gif conversion` and `change gif to png`.

## Product opportunities intentionally excluded

Keep these out of this content experiment so they can be evaluated separately:

- GIF → PNG: extract every animation frame as a numbered PNG sequence/ZIP rather than first-frame-only.
- HEIC → PDF: drag-to-reorder, rotation, margins, and A4/Letter page sizing.
- M4A → WAV: selectable sample rate / preview controls.

These are strong search-intent/product opportunities, but mixing them into the current treatment would make it harder to learn whether the content/semantic improvements themselves moved rankings.
