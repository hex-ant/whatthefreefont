<script setup lang="ts">
import { canvasToMask, cropImage, maskToCanvas } from './lib/browser-image'
import { automaticRotation, estimateAngle, samplePalette } from './lib/image'
import { rotationLayout, remapSelection, normalizedAngle } from './lib/rotation'
import { resetOCR } from './lib/ocr'
import type { Catalog, Mask, MatchResult, Progress, Recognition, Rect } from './lib/types'

const base = useRuntimeConfig().app.baseURL
const fileInput = ref<HTMLInputElement>(),
  source = ref(''),
  fileName = ref(''),
  image = shallowRef<HTMLImageElement>()
const cropEditor = ref<{ draw: () => void }>()
const imageOptions = ref(false),
  advancedOptions = ref(false)
const editorHeading = ref<HTMLElement>(),
  resultsHeading = ref<HTMLElement>(),
  errorNotice = ref<HTMLElement>()
function reveal(element?: HTMLElement) {
  if (!element) return
  element.focus({ preventScroll: true })
  element.scrollIntoView({
    block: 'start',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
}

const rect = ref<Rect>({ x: 0, y: 0, width: 1, height: 1 }),
  detections = ref<Recognition[]>([]),
  text = ref('')
const manualAngle = ref(0),
  autoApplied = ref(false),
  mode = ref<'auto' | 'dark' | 'light'>('auto'),
  threshold = ref(0),
  thorough = ref(false)
const background = ref('#fff')
const angle = computed(() => normalizedAngle(Number(manualAngle.value)))
const layout = computed(() =>
  rotationLayout(image.value?.width || 1, image.value?.height || 1, angle.value),
)
watch(
  angle,
  (next, previous) => {
    if (!image.value || imageBusy.value) return
    rect.value = remapSelection(rect.value, image.value.width, image.value.height, previous, next)
    autoApplied.value = false
    detections.value = []
    if (ocrBusy.value) ocrStatus.value = 'Image rotated. You can read the selection again.'
    resetOCR()
    ++ocrId
    ocrBusy.value = false
  },
  { flush: 'sync' },
)
function selectedCanvas(r = rect.value) {
  return cropImage(image.value!, r, angle.value, background.value)
}
const ocrEngine = ref<'auto' | 'paddle' | 'tesseract'>('auto'),
  ocrBusy = ref(false),
  ocrStatus = ref(''),
  ocrError = ref('')
const busy = ref(false),
  interrupted = ref(false),
  imageBusy = ref(false),
  error = ref(''),
  results = ref<MatchResult[]>([]),
  progress = ref<Progress>(),
  normalized = ref('')
const info = ref<{
    compared: number
    failed: number
    angle: number
    lowQuality: boolean
    indexed: number
  }>(),
  catalog = ref<{ families: number; variants: number }>(),
  stale = ref(false),
  dragging = ref(false),
  help = ref(false)
let worker: Worker | undefined,
  revision = 0,
  uploadId = 0,
  ocrId = 0,
  previewTimer: ReturnType<typeof setTimeout> | undefined
const lifecycle = new AbortController()
const currentText = computed(() => text.value.trim().replace(/\s+/g, ' '))
const percent = computed(() =>
  progress.value?.total
    ? Math.min(100, Math.round((progress.value.done / progress.value.total) * 100))
    : 0,
)
const canSearch = computed(
  () =>
    !!image.value &&
    currentText.value.length > 0 &&
    [...currentText.value].length <= 80 &&
    !imageBusy.value,
)
const resultsText = ref('')
const previewText = ref('')
watch(error, async (message) => {
  if (!message) return
  await nextTick()
  reveal(errorNotice.value)
})

function stopSearch() {
  interrupted.value = true
  cancel()
}

function cancel() {
  worker?.terminate()
  worker = undefined
  busy.value = false
  progress.value = undefined
}
watch(
  [rect, text, manualAngle, mode, threshold, thorough],
  () => {
    revision++
    if (busy.value) cancel()
    if (results.value.length) stale.value = true
  },
  { deep: true, flush: 'sync' },
)
watch(
  [rect, manualAngle, mode, threshold],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(updatePreview, 120)
  },
  { deep: true },
)
function updatePreview() {
  if (!image.value) return
  try {
    const canvas = selectedCanvas()
    const mask = canvasToMask(canvas, mode.value, threshold.value)
    normalized.value = maskToCanvas(mask).toDataURL()
  } catch {
    /* a pending replacement can invalidate a crop */
  }
}

async function loadFile(file: File) {
  if (!file.type.startsWith('image/')) {
    error.value = 'Choose a PNG, JPG, WebP or another image format supported by your browser.'
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    error.value = 'This file exceeds 40 MB. Choose a smaller image or crop.'
    return
  }
  const url = URL.createObjectURL(file)
  try {
    await loadSource(url, file.name)
  } finally {
    URL.revokeObjectURL(url)
  }
}
async function loadSource(url: string, name: string, sampleText?: string) {
  const id = ++uploadId
  interrupted.value = false
  imageOptions.value = false
  advancedOptions.value = false
  resetOCR()
  ++ocrId
  cancel()
  imageBusy.value = true
  error.value = ''
  ocrError.value = ''
  ocrBusy.value = false
  results.value = []
  info.value = undefined
  detections.value = []
  normalized.value = ''
  ocrStatus.value = ''
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (id !== uploadId) return
    if (img.naturalWidth * img.naturalHeight > 60000000)
      throw new Error('This image exceeds 60 megapixels. Choose a smaller crop.')
    const scale = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight)),
      canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const src = canvas.toDataURL('image/png'),
      processed = new Image()
    processed.src = src
    await processed.decode()
    if (id !== uploadId) return
    image.value = processed
    source.value = src
    fileName.value = name
    text.value = sampleText || ''
    manualAngle.value = 0
    const sample = document.createElement('canvas')
    sample.width = Math.min(256, processed.width)
    sample.height = Math.max(1, Math.round((processed.height * sample.width) / processed.width))
    const sampleContext = sample.getContext('2d')!
    sampleContext.drawImage(processed, 0, 0, sample.width, sample.height)
    background.value = samplePalette(
      sampleContext.getImageData(0, 0, sample.width, sample.height).data,
      sample.width,
      sample.height,
    ).background
    // Apply once before OCR, while the new image is still being initialized.
    // Later OCR/search results cannot override a manual correction or reset.
    const orientation = document.createElement('canvas')
    const orientationScale = Math.min(1, 1000 / Math.max(processed.width, processed.height))
    orientation.width = Math.max(1, Math.round(processed.width * orientationScale))
    orientation.height = Math.max(1, Math.round(processed.height * orientationScale))
    orientation.getContext('2d')!.drawImage(processed, 0, 0, orientation.width, orientation.height)
    manualAngle.value = automaticRotation(canvasToMask(orientation))
    autoApplied.value = angle.value !== 0
    rect.value = { ...layout.value.bounds }
    mode.value = 'auto'
    threshold.value = 0
    imageBusy.value = false
    updatePreview()
    await nextTick()
    if (id !== uploadId) return
    reveal(editorHeading.value)
    if (sampleText) {
      ocrStatus.value = 'Sample text filled in. Ready to search.'
    } else void runOCR(false)
  } catch (e) {
    if (id === uploadId) error.value = e instanceof Error ? e.message : 'Could not read the image.'
  } finally {
    if (id === uploadId) imageBusy.value = false
  }
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) void loadFile(f)
  input.value = ''
}
function drop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files[0]
  if (f) void loadFile(f)
}
function paste(e: ClipboardEvent) {
  const f = [...(e.clipboardData?.items || [])]
    .find((i) => i.type.startsWith('image/'))
    ?.getAsFile()
  if (f) {
    e.preventDefault()
    void loadFile(f)
  }
}
function selectDetection(d: Recognition) {
  rect.value = { ...d.box }
  text.value = d.text
  updatePreview()
}
function fullImage() {
  if (image.value) rect.value = { ...layout.value.bounds }
}
function straighten() {
  if (!image.value) return
  const m = canvasToMask(selectedCanvas(), mode.value, threshold.value)
  const previous = angle.value,
    selection = { ...rect.value }
  manualAngle.value = normalizedAngle(previous - estimateAngle(m))
  rect.value = remapSelection(
    selection,
    image.value.width,
    image.value.height,
    previous,
    angle.value,
    true,
  )
  updatePreview()
}
function resetRotation() {
  manualAngle.value = 0
  autoApplied.value = false
}
function flipImage() {
  manualAngle.value = normalizedAngle(angle.value + 180)
}

async function runOCR(selection: boolean) {
  if (!image.value || ocrBusy.value) return
  const id = ++ocrId,
    originalRevision = revision
  ocrBusy.value = true
  ocrError.value = ''
  try {
    const region = selection ? { ...rect.value } : { ...layout.value.bounds }
    let canvas = selectedCanvas(region)
    const scaleX = region.width / canvas.width,
      scaleY = region.height / canvas.height
    if (selection) canvas = maskToCanvas(canvasToMask(canvas, mode.value, threshold.value))
    const { recognize } = await import('./lib/ocr')
    const found = await recognize(
      canvas,
      (message) => {
        if (id === ocrId) ocrStatus.value = message
      },
      ocrEngine.value,
      base,
    )
    if (id !== ocrId) return
    if (!selection)
      detections.value = found.map((d) => ({
        ...d,
        box: {
          x: region.x + d.box.x * scaleX,
          y: region.y + d.box.y * scaleY,
          width: d.box.width * scaleX,
          height: d.box.height * scaleY,
        },
      }))
    if (found.length) {
      if (revision === originalRevision) {
        if (selection)
          text.value = found
            .map((d) => d.text)
            .join(' ')
            .trim()
        else {
          const best = [...detections.value].sort(
            (a, b) => b.text.length * b.confidence - a.text.length * a.confidence,
          )[0]!
          selectDetection(best)
        }
      }
      ocrStatus.value = `Read ${found.length === 1 ? 'one line' : `${found.length} lines`}. Check the text and correct any mistakes.`
    } else ocrStatus.value = 'Could not read the text. Select it and type it manually.'
  } catch (e) {
    if (id === ocrId) {
      console.error(e)
      ocrError.value = 'OCR is unavailable. You can retry or type the text manually.'
      ocrStatus.value = ''
    }
  } finally {
    if (id === ocrId) ocrBusy.value = false
  }
}

async function search() {
  if (!canSearch.value || !image.value) return
  cancel()
  error.value = ''
  info.value = undefined
  busy.value = true
  interrupted.value = false
  stale.value = false
  results.value = []
  resultsText.value = currentText.value
  previewText.value = resultsText.value
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
    error.value =
      'Font recognition requires a browser with OffscreenCanvas support. Open this page in an up-to-date version of Chrome, Edge, Firefox or Safari.'
    busy.value = false
    return
  }
  try {
    worker = new Worker(new URL('./workers/matcher.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress.value = data.data
      else if (data.type === 'normalized')
        normalized.value = maskToCanvas(data.data.mask as Mask).toDataURL()
      else if (data.type === 'partial') results.value = data.data
      else if (data.type === 'result') {
        results.value = data.data.results
        info.value = data.data
        busy.value = false
        progress.value = undefined
        worker?.terminate()
        worker = undefined
      } else if (data.type === 'error') {
        error.value = data.data
        cancel()
      }
    }
    worker.onerror = (e) => {
      error.value = `Could not start the search. ${e.message || 'Please try again.'}`
      cancel()
    }
    const canvas = selectedCanvas(),
      rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    worker.postMessage(
      {
        rgba,
        width: canvas.width,
        height: canvas.height,
        text: currentText.value,
        base: new URL(base, location.origin).href,
        autoRotate: false,
        manualAngle: 0,
        mode: mode.value,
        threshold: threshold.value,
        thorough: thorough.value,
      },
      [rgba.buffer],
    )
    await nextTick()
    reveal(resultsHeading.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not start the search.'
    cancel()
  }
}
const examples = [
  { file: 'montserrat-oblique.png', label: 'Rotation and color' },
  { file: 'playfair-display-tracking.png', label: 'Serifs and spacing' },
  { file: 'lobster-clean.png', label: 'Script lettering' },
]
onMounted(async () => {
  window.addEventListener('paste', paste)
  try {
    const r = await fetch(`${base}catalog/catalog.json`)
    if (r.ok) {
      const c: Catalog = await r.json()
      catalog.value = { families: c.families, variants: c.variants.length }
    }
  } catch {
    /* search reports a recoverable catalog error */
  }
  const context = (
    document as Document & {
      modelContext?: { registerTool: (tool: unknown, options: unknown) => void }
    }
  ).modelContext
  if (context)
    try {
      context.registerTool(
        {
          name: 'configure_font_search',
          description:
            'Set transcription and rotation of the currently loaded image. Does not upload an image or start searching.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 80 },
              rotation: { type: 'number', minimum: -180, maximum: 180 },
            },
            required: ['text'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute(input: unknown) {
            const v = input as { text?: unknown; rotation?: unknown }
            if (!image.value) throw new Error('Load an image first')
            if (typeof v.text !== 'string' || !v.text.trim() || [...v.text].length > 80)
              throw new Error('Invalid text')
            if (
              v.rotation !== undefined &&
              (typeof v.rotation !== 'number' ||
                !Number.isFinite(v.rotation) ||
                Math.abs(v.rotation) > 180)
            )
              throw new Error('Invalid rotation')
            text.value = v.text
            if (typeof v.rotation === 'number') {
              manualAngle.value = v.rotation
            }
            return { text: text.value, rotation: manualAngle.value }
          },
        },
        { signal: lifecycle.signal },
      )
    } catch (e) {
      console.warn('WebMCP unavailable', e)
    }
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', paste)
  clearTimeout(previewTimer)
  cancel()
  lifecycle.abort()
  resetOCR()
  ++ocrId
  ++uploadId
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'has-image': source }"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="drop"
  >
    <header class="topbar">
      <a class="brand" :href="base" aria-label="What the Free Font — home">
        <span class="brand-what">what</span><span class="brand-the">the</span
        ><span class="brand-free">free</span><span class="brand-font">font</span
        ><span class="brand-dot" aria-hidden="true">.</span>
      </a>
      <div class="topbar-right">
        <button
          class="text-button"
          :aria-expanded="help"
          aria-controls="help-panel"
          @click="help = !help"
        >
          How does it work?
        </button>
        <div class="privacy"><span class="status-dot" /> Your image stays on your device</div>
      </div>
    </header>
    <main>
      <div v-if="!source" class="intro">
        <div>
          <p class="eyebrow">GOOGLE FONTS · IMAGE SEARCH</p>
          <h1>What <em>font</em> is this?</h1>
          <p>
            Find matching Google Fonts from an image.<br />Free to use. Your images stay on your
            device.
          </p>
        </div>
      </div>
      <div v-if="help" id="help-panel" class="help-panel">
        <strong>From an image to a free font</strong>
        <p>
          Select a single line in one font. OCR fills in the text for you — correct any mistakes,
          preserving capitalization and special characters. We compare the shapes with Google Fonts,
          accounting for rotation, size, weight and spacing.
        </p>
        <p>
          Percentages are relative likelihoods among the suggestions, estimated from visual
          similarity. They do not guarantee identification. Very short text, blur, perspective
          distortion or fonts outside the catalog can make matches less accurate.
        </p>
        <p>
          Your images stay on this device. The first search downloads static indexes, models and
          font files, so it may take longer.
        </p>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        hidden
        aria-label="Choose an image"
        @change="onFile"
      />
      <div v-if="error" ref="errorNotice" class="message error" role="alert" tabindex="-1">
        {{ error
        }}<button class="text-button" @click="error = ''" aria-label="Dismiss message">×</button>
      </div>
      <template v-if="!source">
        <section class="upload-panel" :class="{ dragging }">
          <div class="upload-symbol">Aa<span>↗</span></div>
          <h2>{{ imageBusy ? 'Opening image…' : 'Drop an image here' }}</h2>
          <p>A logo, screenshot or photo — PNG, JPG, WebP.</p>
          <button class="primary" :disabled="imageBusy" @click="fileInput?.click()">
            Choose an image <span>↗</span></button
          ><span class="paste-hint">or paste from your clipboard <kbd>⌘ / Ctrl V</kbd></span>
        </section>
        <div class="examples">
          <span class="examples-label">TRY AN EXAMPLE</span
          ><button
            v-for="example in examples"
            :key="example.file"
            class="example"
            :disabled="imageBusy"
            @click="loadSource(`${base}examples/${example.file}`, example.label, 'Hamburge Fonts')"
          >
            <img :src="`${base}examples/${example.file}`" alt="" /><span
              >{{ example.label }} <b>↗</b></span
            >
          </button>
        </div>
        <p class="catalog-note">
          <span class="status-dot" />
          {{
            catalog
              ? `${catalog.families.toLocaleString('en-US')} Google Fonts families`
              : 'Google Fonts only'
          }}
          · No account needed
        </p>
      </template>
      <template v-else>
        <nav class="journey" aria-label="Font identification steps">
          <span class="journey-done"><span>✓</span> Image</span><i aria-hidden="true">/</i>
          <span :aria-current="!busy && !results.length ? 'step' : undefined"
            ><span>2</span> Check text</span
          ><i aria-hidden="true">/</i>
          <button
            v-if="busy || results.length || interrupted"
            class="text-button"
            :aria-current="!stale ? 'step' : undefined"
            @click="reveal(resultsHeading)"
          >
            <span>3</span> Matches
          </button>
          <span v-else class="journey-next"><span>3</span> Matches</span>
        </nav>
        <div class="workspace">
          <section class="editor-panel">
            <div class="panel-heading">
              <div>
                <span class="step">01</span>
                <h2 ref="editorHeading" tabindex="-1">Select one line of text</h2>
              </div>
              <button class="text-button" :disabled="imageBusy" @click="fileInput?.click()">
                Change image ↗
              </button>
            </div>
            <CropEditor
              v-if="image"
              ref="cropEditor"
              v-model="rect"
              :src="source"
              :width="layout.width"
              :height="layout.height"
              :image-width="image.width"
              :image-height="image.height"
              :angle="angle"
              :background="background"
              :detections="detections"
              @select="selectDetection"
            />
            <div v-if="detections.length > 1" class="detected-lines">
              <span>Choose a detected line:</span>
              <button v-for="(d, i) in detections" :key="i" @click="selectDetection(d)">
                {{ d.text }}
              </button>
            </div>
            <div class="editor-toolbar">
              <button class="text-button" @click="cropEditor?.draw()">New selection</button>
              <div v-if="angle !== 0" class="rotation-summary">
                <span v-if="autoApplied" class="rotation-note" role="status"
                  >Auto-straightened</span
                >
                <span v-else class="rotation-value">{{ angle }}°</span>
                <button class="text-button" @click="resetRotation">Reset rotation</button>
              </div>
            </div>
            <details
              class="image-options disclosure"
              :open="imageOptions"
              @toggle="imageOptions = ($event.target as HTMLDetailsElement).open"
            >
              <summary>Adjust image <span aria-hidden="true">+</span></summary>
              <div class="image-options-body">
                <div class="rotation-control">
                  <label for="angle">Rotation</label>
                  <input
                    id="angle"
                    v-model.number="manualAngle"
                    type="range"
                    min="-180"
                    max="180"
                    step=".1"
                  />
                  <input
                    v-model.number="manualAngle"
                    class="angle-number"
                    type="number"
                    min="-180"
                    max="180"
                    step=".1"
                    aria-label="Rotation in degrees"
                  /><span>°</span>
                </div>
                <div class="image-actions">
                  <button class="text-button" @click="straighten">Straighten ↻</button>
                  <button
                    class="text-button"
                    aria-label="Rotate image by 180 degrees"
                    @click="flipImage"
                  >
                    Rotate 180°
                  </button>
                  <button class="text-button" @click="fullImage">Full image</button>
                </div>
                <p class="selection-tip">
                  The selection can extend beyond the image. Use arrow keys to move it, Alt + arrows
                  to resize, and Shift for larger steps.
                </p>
                <div class="image-facts">
                  <span class="filename" :title="fileName">{{ fileName }}</span
                  ><span>{{ Math.round(rect.width) }} × {{ Math.round(rect.height) }} px</span>
                </div>
              </div>
            </details>
          </section>
          <section class="settings-panel">
            <div class="panel-heading">
              <div>
                <span class="step">02</span>
                <h2>Check the text</h2>
              </div>
            </div>
            <div class="transcription-label">
              <label class="field-label" for="transcription">Does this match the image?</label>
              <button class="text-button read-selection" :disabled="ocrBusy" @click="runOCR(true)">
                <span :class="{ spinner: ocrBusy }">{{ ocrBusy ? '' : '↻' }}</span
                >{{ ocrBusy ? 'Reading…' : 'Read selection' }}
              </button>
            </div>
            <textarea
              id="transcription"
              v-model="text"
              rows="1"
              maxlength="80"
              placeholder="Type the text from your image…"
              spellcheck="false"
            />
            <p class="field-hint">Correct any letters or spaces. Keep the same capitalization.</p>
            <p
              v-if="ocrStatus || ocrError || ocrBusy"
              class="ocr-status"
              :class="{ warning: ocrError }"
              role="status"
            >
              {{ ocrError || ocrStatus || 'Reading text from your image…' }}
            </p>
            <div class="search-action">
              <button
                v-if="!busy"
                class="primary search-button"
                :disabled="!canSearch"
                @click="search"
              >
                Find matching fonts <span>→</span>
              </button>
              <button v-else class="text-button view-progress" @click="reveal(resultsHeading)">
                <i class="spinner" /> View search progress ↓
              </button>
              <p v-if="!currentText" class="empty-text-hint">
                {{
                  ocrBusy
                    ? 'Wait for the text, or type it yourself above.'
                    : 'Enter the text above to start your search.'
                }}
              </p>
              <span class="local-note">Google Fonts only · Free, private, no sign-up</span>
            </div>
            <details
              class="advanced disclosure"
              :open="advancedOptions"
              @toggle="advancedOptions = ($event.target as HTMLDetailsElement).open"
            >
              <summary>Advanced options <span aria-hidden="true">+</span></summary>
              <div class="advanced-fields">
                <p class="advanced-intro">
                  Usually, automatic settings are enough. Try these if text is hard to read or
                  matches look wrong.
                </p>
                <label
                  ><input v-model="thorough" type="checkbox" /> Thorough search (more fonts)</label
                >
                <label for="ocr-engine"
                  >Text recognition<select
                    id="ocr-engine"
                    v-model="ocrEngine"
                    aria-label="OCR engine"
                  >
                    <option value="auto">Automatic (recommended)</option>
                    <option value="paddle">PaddleOCR</option>
                    <option value="tesseract">Tesseract</option>
                  </select></label
                >
                <p class="setting-hint">After changing the engine, use “Read selection” above.</p>
                <label for="polarity"
                  >Text and background<select id="polarity" v-model="mode">
                    <option value="auto">Automatic, based on color</option>
                    <option value="dark">Dark text</option>
                    <option value="light">Light text</option>
                  </select></label
                >
                <label for="threshold"
                  >Contrast threshold <span>{{ threshold }}</span
                  ><input id="threshold" v-model.number="threshold" type="range" min="-80" max="80"
                /></label>
                <div class="preview-heading">
                  <span class="field-label">Shapes used for matching</span>
                </div>
                <div class="normalized-preview">
                  <img
                    v-if="normalized"
                    :src="normalized"
                    alt="Isolated text shapes used for matching"
                  />
                </div>
                <p class="setting-hint">
                  The letters should be clear, with as little background noise as possible.
                </p>
              </div>
            </details>
          </section>
        </div>
        <section
          v-if="busy || results.length || interrupted"
          class="results-section"
          aria-label="Search results"
          :data-status="busy ? 'searching' : 'complete'"
        >
          <div class="results-title">
            <div>
              <p class="eyebrow">CLOSEST MATCHES</p>
              <h2 ref="resultsHeading" tabindex="-1">
                {{
                  busy
                    ? 'Finding your font…'
                    : interrupted && !results.length
                      ? 'Search stopped'
                      : 'Your closest matches'
                }}
              </h2>
              <p class="results-transcription">For “{{ resultsText }}”</p>
            </div>
            <div class="results-controls">
              <button class="text-button" @click="reveal(editorHeading)">Edit selection ↑</button>
              <button v-if="busy" class="cancel-button" @click="stopSearch">
                Stop search <span>×</span>
              </button>
            </div>
          </div>
          <div v-if="busy" class="progress-panel" role="status">
            <div>
              <span><i class="spinner" /> {{ progress?.stage || 'Preparing search' }}</span
              ><span>{{ progress?.done || 0 }} / {{ progress?.total || '…' }}</span>
            </div>
            <progress :value="percent" max="100" aria-label="Search progress" />
            <p>
              The first search downloads the index and font files. Results appear as the search
              progresses.
            </p>
          </div>
          <p v-if="stale" class="message warning">
            The selection or settings have changed. Search again to update the results.
          </p>
          <p v-if="info?.lowQuality" class="message warning">
            These matches have low similarity. Check the selection and text — the font may also be
            outside Google Fonts.
          </p>
          <p v-if="info?.failed" class="message warning">
            Could not download {{ info.failed }} font variants. Results are incomplete; try again
            with a better connection.
          </p>
          <p v-if="interrupted" class="message warning">
            {{
              results.length
                ? 'Search stopped. Partial results are shown below.'
                : 'Search stopped before any matches were found. You can edit the selection or search again.'
            }}
          </p>
          <div class="results-grid" :class="{ stale }">
            <ResultCard
              v-for="(r, i) in results"
              :key="r.font.id"
              :result="r"
              :index="i"
              v-model:text="previewText"
              :original-text="resultsText"
            />
            <ResultSkeleton
              v-for="slot in busy ? Math.max(0, 8 - results.length) : 0"
              :key="`loading-${slot}`"
            />
          </div>
          <details v-if="results.length" class="results-explainer disclosure">
            <summary>About these results <span aria-hidden="true">+</span></summary>
            <p class="probability-note">
              Percentages show relative likelihood among these {{ results.length }} suggestions.
              They estimate similarity, not certainty of identification. The font may be outside
              Google Fonts.
            </p>
            <p v-if="info" class="comparison-count">Compared {{ info.compared }} font variants</p>
          </details>
        </section>
      </template>
      <footer>
        <div class="footer-primary">
          <span>Free fonts. Free discovery.</span><span>NO ACCOUNT · NO IMAGE UPLOADS</span>
        </div>
        <div class="footer-credits">
          <a
            href="https://github.com/hex-ant/whatthefreefont"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source on GitHub
          </a>
          <span>
            Made with <span class="footer-heart" role="img" aria-label="love">♥</span> by
            <a href="https://arturrosa.pl" target="_blank" rel="noopener noreferrer">Artur Rosa</a>
            © 2026
          </span>
        </div>
      </footer>
    </main>
  </div>
</template>
