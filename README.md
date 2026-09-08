# What the Free Font

Identify fonts from images using the Google Fonts catalog. Built with Nuxt 4 /
Vue 3, TypeScript, and pnpm. All image processing, OCR, and matching run in the
browser. The build contains only static files.

## Getting started

Requirements: Node.js 22.12+ (CI uses Node.js 24) and the pnpm version specified in `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Production:

```sh
pnpm build
pnpm preview
```

Upload **only `.output/public`** to any static host or CDN. Hosting does not require
Node.js, accounts, keys, APIs, server functions, or a database.
`pnpm build` checks the integrity of the catalog and models and generates license
notices in `licenses/` before generating the site.
`nuxt generate` performs server-side work only while building the project.

For hosting under a subdirectory, set `NUXT_APP_BASE_URL=/name/` at build time.
HTTP(S) is required; do not open `index.html` through `file://`.

## SEO and link previews

The home page is prerendered at build time: its content, canonical URL, Open Graph,
Twitter Card, and JSON-LD are available in HTML without JavaScript. OCR and matching
still run entirely in the browser. The host receives only static files.

The default public URL is `https://whatthefreefont.com/`. For another domain, set
`SITE_URL` at build time, for example `SITE_URL=https://example.com/ pnpm build`.
For a subdirectory, set both `SITE_URL=https://example.com/fonts/`
and `NUXT_APP_BASE_URL=/fonts/`. Do not use a local or temporary preview URL as
`SITE_URL` when preparing a production build.

The build generates `robots.txt` and `sitemap.xml` and marks the fallback documents
`200.html` and `404.html` as `noindex`. It finishes by running `pnpm test:seo`, which
checks the actual HTML and output files. The application metadata does not contain
fabricated ratings or reviews. Configuration lives in `config/site.ts`.

The share image is `public/og-image.png` (1200 × 630). Run `pnpm social:generate`
to rebuild it and the PNG icons from `scripts/build-social-image.ts`. Generation
requires Georgia installed locally (the macOS Supplemental font directory is the
default), or `GEORGIA_FONT_DIR` pointing to a directory containing `Georgia.ttf`,
`Georgia Bold.ttf`, and `Georgia Bold Italic.ttf`. Google Fonts are cached in
`.cache/fonts/`; font files are not embedded in the generated assets. Normal builds
use the committed PNGs and do not require Georgia or regenerate graphics.

## Features

- Upload, drag and drop, or paste an image from the clipboard; ready-to-use examples.
- Text detection and recognition with PaddleOCR PP-OCRv6 small through ONNX Runtime
  Web, with Tesseract.js (English + Polish) as an alternative and automatic fallback.
- Select detected text; draw, move, and resize the crop with a mouse or touch.
  Arrow keys move the crop, Alt + arrows resize it, and Shift increases the step.
  Shift + drag draws a new crop.
- Manually correct the text, rotation, background separation, and contrast threshold.
- Automatic straightening, 180° orientation checks, and scale and color normalization.
- Text comparison tolerant of tracking, kerning, and word spacing.
- Eight suggestions with custom text previews, relative probabilities, similar
  families, name copying, and links to Google Fonts.
- Progress and partial results, cancellation, and download error handling;
  changing parameters invalidates previous results.

Rotation applies to the entire image before cropping. The preview includes all
corners and an extra margin into which the crop can extend. OCR and matching use
the same crop of the rotated image; rotation is not applied again to the crop.
Space outside the image is filled with its estimated background color. “Straighten”
rotates the visible image and expands the selection to preserve its contents.
After loading, the image is automatically straightened before OCR if the estimator
detects a clear text direction and improved line concentration. The text is assumed
to be upright; automatic straightening does not resolve 180° orientation.
Ambiguous images remain unchanged. Any nonzero rotation shows “Reset rotation”.
Resets and manual adjustments are preserved: neither OCR nor searching straightens
the image again. Manually changing the angle keeps the crop center on the same
part of the image as far as the available space allows. “Full image” covers the
bounds of the rotated image.

## Interface layout

The main flow is to add an image, check the crop and text, then select
“Find matching fonts”. Once analysis starts, the view moves to progress and
results; “Edit selection” returns to editing.

Preview text can be edited directly in any card. Changes apply to all cards
without changing the search text or ranking. After an edit, a reset icon appears
beside each preview and restores the text in every card. A new search initializes
previews with the text used for that search.

“Adjust image” contains rotation controls and selection help. “Advanced options”
contains thorough search, OCR engine selection, background separation, the contrast
threshold, and a mask preview. Panels are collapsed by default; closing them
preserves their settings. “Reset rotation” stays visible outside the panels
whenever rotation is nonzero. “About these results” explains the percentages and
shows the number of compared variants.

## Architecture

```text
image → rotate the entire preview → crop → OCR / confirmed text
                ↓
       color mask of the selected crop
                ↓
       static indices for the characters used
                ↓
       family / variant ranking
                ↓
       render candidates in the browser
                ↓
       flexible comparison + letter shapes
                ↓
       additional variants of the best families → results
```

**Catalog:** a `google-font-metadata@6.0.8` snapshot with 1908 families and 7543
actual weight/style combinations. The manifest contains versioned URLs for static
Google files on `fonts.gstatic.com`. The app does not query the Google Fonts API,
Fontsource API, or Hugging Face Inference API.

**Index:** 137 characters (ASCII, Polish characters, and common extended Latin
characters), with a separate `<character-code>.<sha256>.bin.gz` file per character.
Each record contains a 16 × 24 grid, glyph proportions, and height. Only indices
needed for the text are downloaded, up to 14 distinct characters. All variants
are scored in the index; a shortlist moves on to the more expensive rendering
stage. Text outside the index triggers a broader comparison of fonts supporting
the relevant script, excluding fonts that do not support it. A static, compressed
`cmap` coverage map for each variant verifies that every entered character is
present, preventing browser fallback fonts from masquerading as a match.

**Matching:** normalization against the dominant background color, projection-based
angle estimation, empty-column reduction, and dynamic time warping (DTW).
Individual letter shapes provide an additional comparison when segmentation is
reliable. Candidates are rendered using the sample's colors to reduce antialiasing
differences. Text is compared using both natural typesetting and separated
characters. Connected letters also trigger a broader pool of script and decorative
candidates. The best families are checked in additional weights and styles.
The strongest candidates are rendered again at sizes close to the sample because
hinting and antialiasing change with the physical size of the letters.

**Performance:** matching runs in a Web Worker with OffscreenCanvas. OCR also uses
a worker. WASM runs in a single thread, so hosting does not require COOP/COEP
headers. Small WOFF2 subsets are downloaded for Latin text; full TTF files are used
when another script is needed. First use downloads more assets; subsequent use
can benefit from the browser's or CDN's standard HTTP cache.

**Assets:** indices live in `public/catalog` and OCR models in `public/models`.
Model weights, sources, licenses, and SHA-256 checksums are documented alongside
the files. OCR engines and WASM are pinned to specific versions. Images are passed
only to internal workers through `postMessage`, never to a server.

## What the percentages mean

These are relative probabilities **among the displayed suggestions**, obtained
by applying softmax to visual distances. They are not calibrated, absolute
identification confidence or an estimate of whether the font is in Google Fonts
at all. Short text samples can be indistinguishable across many families.
Families with identical descriptors for the tested characters may be grouped into
one suggestion, with links to similar typefaces.

The app reports low similarity and incomplete downloads. It does not promise
accuracy for every image: perspective, severe blur, obscured characters, complex
backgrounds, heavily overlapping letters, variable font axes beyond the tested
variants, and fonts outside the snapshot remain limitations. The best input is
one clear line in a single typeface with correctly entered text. The maximum
sample length is 80 characters.

## Tests and experiments

```sh
pnpm test
pnpm typecheck
pnpm test:assets
pnpm benchmark
pnpm exec tsx scripts/check-index.ts
```

Browser tests require Chrome. First build and serve `.output/public` on port 4173,
for example with `python3 -m http.server 4173 --directory .output/public`:

```sh
pnpm exec tsx scripts/browser-check.ts
pnpm exec tsx scripts/ocr-check.ts
pnpm exec tsx scripts/heldout-check.ts
pnpm test:interactions
```

`pnpm test:e2e` starts a static server and a browser test suite, including
`scripts/ux-check.ts`: the main flow, keyboard-operated panels, parameter
preservation, reset visibility, and layouts at widths of 320–1440 px.
It requires a prior `pnpm build` and an installed Playwright browser engine.

UI and OCR tests can also run with `BROWSER=webkit` after installing the engine
with `pnpm exec playwright install webkit`.

Reports are written locally to `docs/benchmarks` by default. The entire `docs/`
directory is ignored by Git and is not included in clones. The PoC compares plain
image distance, individual glyph matching, DTW, and their combination. A separate
suite checks the full static pipeline on families and text samples different from
the first PoC. The OCR test deliberately clears the text field before recognition.
These are synthetic tests and should not be presented as accuracy on arbitrary
user photos. Browser tests also verify the absence of requests that send user
data and check the mobile layout.

## Updating the catalog

```sh
pnpm catalog
```

This **build script**, run locally, downloads Google fonts, verifies character
coverage with fontkit, and renders the index. Full TTF files are cached in
`.cache/fonts` (outside Git; several GB). They are not needed to run the built
site. Incomplete cache files are downloaded again. To repair specific entries:

```sh
CATALOG_REPAIR=1004,1005 pnpm catalog
```

After updating `google-font-metadata`, perform a **full** rebuild.
The manifest points to files with content hashes. The generator writes new files
before atomically replacing the local manifest; on the host, follow the publishing
order in the caching section below. `public/catalog/build-report.json` must have
an empty error list. The `CATALOG_LIMIT` test option is only for small local PoCs
and replaces the catalog; do not use it in a production build.

## Key files

- `app/lib/image.ts` — image processing and similarity metrics.
- `app/lib/ranking.ts` — initial ranking and relative probabilities.
- `app/workers/matcher.worker.ts` — the complete search pipeline.
- `app/lib/ocr.ts` — detection, OCR, and grouping words into lines.
- `app/components/CropEditor.vue` — crop editor with keyboard and touch support.
- `scripts/build-catalog.ts` — reproducible static asset generation.

## License and project status

Project code: **MIT**; see [LICENSE](LICENSE). Dependencies and assets retain their
own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
`pnpm licenses:generate` rebuilds the full notices included in the static build.

Alpha release. The catalog is a snapshot of 1908 families, not a guarantee of
coverage of the entire current Google Fonts catalog. Expanding catalog coverage
is a separate task.

## Caching and publishing assets

The `catalog/catalog.json` manifest has a stable URL and uses `version: 2` (the
format version, not a prefix for an entire generation). It contains the URL and
SHA-256 of each character index and the Unicode coverage map. Hashes apply to the
data **after gzip decompression**, including when a CDN decompresses the response.
The browser and `test:assets` verify the checksums.

- `catalog/catalog.json`: `Cache-Control: no-cache` and ETag revalidation.
  Disable long edge TTLs for the manifest; `fetch(..., { cache: 'no-cache' })`
  alone does not replace correct CDN configuration.
- `catalog/glyphs/*.<sha256>.bin.gz` and `catalog/coverage.<sha256>.json.gz`:
  `Cache-Control: public, max-age=31536000, immutable`.
- Generated `_nuxt/` files with hashes: also use long-lived immutable caching.
- HTML: revalidate. Do not mark other files with stable names as immutable.

On a CDN, publish new data files first, then the manifest. Retain old hashed files
for open sessions and rollbacks; the generator does not delete them. Hosts that
replace the entire directory on deployment (such as Pages) must also receive
these older files. Remove them deliberately according to your retention policy.
Do not cache 404 responses for new indices.

Identical data keeps the same URL. Adding fonts can change every character index;
this is an accepted cost. There is still one file per character, without font
grouping. The browser downloads only indices for characters used in the search.

## CI and browser tests

GitHub Actions (`.github/workflows/ci.yml`) checks pull requests and changes to
`main`: installation from the lockfile, tests, types, asset integrity, license
generation, the static build, matching, and both OCR engines in Chromium and WebKit.
Chromium additionally checks the editor, cancellation, and preservation of manual
corrections. `pnpm test:ocr:dev` also checks both OCR engines on the Nuxt development
server to catch differences from the static build. The workflow does not deploy
the app. Actions are pinned to full SHAs with version comments; Dependabot proposes
updates.

To reproduce the automated tests without starting a server manually:

```sh
pnpm exec playwright install chromium webkit
pnpm build
BROWSER=chromium REPORT_DIR=.cache/browser-reports pnpm test:e2e
BROWSER=webkit REPORT_DIR=.cache/browser-reports pnpm test:e2e
```

Each OCR engine has a 120-second timeout covering initialization and recognition.
After an error or timeout, its worker is terminated and the next attempt starts
a new one. Automatic mode may then use Tesseract with a separate timeout.
Changing the image cancels the previous queue. The repository includes a small
Tesseract patch that allows its worker to be terminated during initialization;
pnpm applies it automatically. Do not remove the patch without checking the OCR
tests.

Google Fonts: https://github.com/google/fonts
PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
Tesseract.js: https://github.com/naptha/tesseract.js
