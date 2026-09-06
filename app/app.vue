<script setup lang="ts">
import { canvasToMask, cropImage, maskToCanvas } from './lib/browser-image'
import { estimateAngle, rotate } from './lib/image'
import type { Catalog, Mask, MatchResult, Progress, Recognition, Rect } from './lib/types'

const base = useRuntimeConfig().app.baseURL
const fileInput = ref<HTMLInputElement>(),
  source = ref(''),
  fileName = ref(''),
  image = shallowRef<HTMLImageElement>()
const cropEditor = ref<{ draw: () => void }>()
const rect = ref<Rect>({ x: 0, y: 0, width: 1, height: 1 }),
  detections = ref<Recognition[]>([]),
  text = ref('')
const manualAngle = ref(0),
  autoRotate = ref(true),
  mode = ref<'auto' | 'dark' | 'light'>('auto'),
  threshold = ref(0),
  thorough = ref(false)
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
  [rect, text, manualAngle, autoRotate, mode, threshold, thorough],
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
    const canvas = cropImage(image.value, rect.value)
    let mask = canvasToMask(canvas, mode.value, threshold.value)
    if (manualAngle.value) mask = rotate(mask, manualAngle.value)
    normalized.value = maskToCanvas(mask).toDataURL()
  } catch {
    /* a pending replacement can invalidate a crop */
  }
}

async function loadFile(file: File) {
  if (!file.type.startsWith('image/')) {
    error.value = 'Wybierz obraz PNG, JPG, WebP lub inny format obsługiwany przez przeglądarkę.'
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    error.value = 'Ten plik ma ponad 40 MB. Wybierz mniejszy obraz lub wycinek.'
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
      throw new Error('Obraz ma ponad 60 megapikseli. Wybierz mniejszy wycinek.')
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
    rect.value = { x: 0, y: 0, width: processed.width, height: processed.height }
    text.value = sampleText || ''
    manualAngle.value = 0
    autoRotate.value = true
    mode.value = 'auto'
    threshold.value = 0
    imageBusy.value = false
    updatePreview()
    if (sampleText) {
      ocrStatus.value = 'Tekst przykładu jest już wpisany. Możesz go zmienić.'
    } else void runOCR(false)
  } catch (e) {
    if (id === uploadId)
      error.value = e instanceof Error ? e.message : 'Nie udało się odczytać obrazu.'
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
  manualAngle.value = 0
  autoRotate.value = true
  updatePreview()
}
function fullImage() {
  if (image.value) rect.value = { x: 0, y: 0, width: image.value.width, height: image.value.height }
}
function straighten() {
  if (!image.value) return
  const m = canvasToMask(cropImage(image.value, rect.value), mode.value, threshold.value)
  manualAngle.value = -estimateAngle(m)
  autoRotate.value = false
  updatePreview()
}
function flipImage() {
  manualAngle.value = manualAngle.value > 0 ? manualAngle.value - 180 : manualAngle.value + 180
  autoRotate.value = false
}

async function runOCR(selection: boolean) {
  if (!image.value || ocrBusy.value) return
  const id = ++ocrId,
    originalRevision = revision
  ocrBusy.value = true
  ocrError.value = ''
  try {
    let canvas = cropImage(
      image.value,
      selection ? rect.value : { x: 0, y: 0, width: image.value.width, height: image.value.height },
    )
    const scaleX = image.value.width / canvas.width,
      scaleY = image.value.height / canvas.height
    if (selection) {
      let m = canvasToMask(canvas, mode.value, threshold.value)
      m = rotate(m, manualAngle.value)
      if (autoRotate.value) m = rotate(m, -estimateAngle(m))
      canvas = maskToCanvas(m)
    }
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
          x: d.box.x * scaleX,
          y: d.box.y * scaleY,
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
      ocrStatus.value = `Odczytano ${found.length === 1 ? 'napis' : `${found.length} napisy`}. Sprawdź tekst i popraw ewentualne błędy.`
    } else ocrStatus.value = 'Nie udało się odczytać napisu. Zaznacz go i wpisz tekst ręcznie.'
  } catch (e) {
    if (id === ocrId) {
      console.error(e)
      ocrError.value = 'OCR jest niedostępny. Możesz ponowić odczyt albo wpisać tekst ręcznie.'
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
  if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
    error.value =
      'Rozpoznawanie wymaga aktualnej przeglądarki z OffscreenCanvas. Otwórz stronę w aktualnym Chrome, Edge, Firefox lub Safari.'
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
      error.value = `Nie udało się uruchomić analizy. ${e.message || 'Spróbuj ponownie.'}`
      cancel()
    }
    const canvas = cropImage(image.value, rect.value),
      rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    worker.postMessage(
      {
        rgba,
        width: canvas.width,
        height: canvas.height,
        text: currentText.value,
        base: new URL(base, location.origin).href,
        autoRotate: autoRotate.value,
        manualAngle: manualAngle.value,
        mode: mode.value,
        threshold: threshold.value,
        thorough: thorough.value,
      },
      [rgba.buffer],
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Nie udało się rozpocząć analizy.'
    cancel()
  }
}
const examples = [
  { file: 'montserrat-oblique.png', label: 'Obrót i kolor' },
  { file: 'playfair-display-tracking.png', label: 'Szeryfy i odstępy' },
  { file: 'lobster-clean.png', label: 'Pismo odręczne' },
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
              autoRotate.value = false
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
  ++ocrId
  ++uploadId
})
</script>

<template>
  <div
    class="app-shell"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="drop"
  >
    <header class="topbar">
      <a class="brand" :href="base">what<span>the</span>freefont<span class="brand-dot">.</span></a>
      <div class="topbar-right">
        <button class="text-button" @click="help = !help">Jak to działa?</button>
        <div class="privacy"><span class="status-dot" /> Obraz zostaje u Ciebie</div>
      </div>
    </header>
    <main>
      <div class="intro">
        <div>
          <p class="eyebrow">GOOGLE FONTS · IMAGE SEARCH</p>
          <h1>Jaki to <em>font?</em></h1>
          <p>Dodaj obraz. Zaznacz napis. Znajdź darmowy krój.</p>
        </div>
        <div class="catalog-count">
          <strong>{{ catalog?.families?.toLocaleString('pl-PL') || '…' }}</strong
          ><span>rodzin Google Fonts<br />do porównania</span>
        </div>
      </div>
      <div v-if="help" class="help-panel">
        <strong>Od obrazu do darmowego fontu</strong>
        <p>
          Zaznacz jedną linię z jednego kroju pisma. OCR wpisze tekst za Ciebie — popraw go,
          zachowując wielkość liter i znaki. Porównujemy kształt napisu z Google Fonts,
          uwzględniając obrót, rozmiar, grubość i odstępy.
        </p>
        <p>
          Procenty to względne prawdopodobieństwa wśród wyświetlonych propozycji, oszacowane z
          podobieństwa. Nie są gwarancją identyfikacji. Bardzo krótki napis, rozmycie, perspektywa
          lub font spoza katalogu mogą dać słabsze wyniki.
        </p>
        <p>
          Zdjęcia pozostają na tym urządzeniu. Pierwsza analiza pobiera statyczne indeksy, modele i
          pliki fontów; może to potrwać dłużej.
        </p>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        hidden
        aria-label="Wybierz obraz"
        @change="onFile"
      />
      <div v-if="error" class="message error" role="alert">
        {{ error
        }}<button class="text-button" @click="error = ''" aria-label="Zamknij komunikat">×</button>
      </div>
      <template v-if="!source">
        <section class="upload-panel" :class="{ dragging }">
          <div class="upload-symbol">Aa<span>↗</span></div>
          <h2>{{ imageBusy ? 'Otwieranie obrazu…' : 'Przeciągnij tu obraz' }}</h2>
          <p>Logo, zrzut ekranu lub zdjęcie — PNG, JPG, WebP.</p>
          <button class="primary" :disabled="imageBusy" @click="fileInput?.click()">
            Wybierz obraz <span>↗</span></button
          ><span class="paste-hint">lub wklej ze schowka <kbd>⌘ / Ctrl V</kbd></span>
        </section>
        <div class="examples">
          <span class="examples-label">SPRAWDŹ NA PRZYKŁADZIE</span
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
      </template>
      <template v-else>
        <div class="workspace">
          <section class="editor-panel">
            <div class="panel-heading">
              <div>
                <span class="step">01</span>
                <h2>Zaznacz napis</h2>
              </div>
              <button class="text-button" :disabled="imageBusy" @click="fileInput?.click()">
                Zmień obraz ↗
              </button>
            </div>
            <CropEditor
              v-if="image"
              ref="cropEditor"
              v-model="rect"
              :src="source"
              :width="image.width"
              :height="image.height"
              :detections="detections"
              @select="selectDetection"
            />
            <div class="editor-toolbar">
              <span class="filename" :title="fileName">{{ fileName }}</span
              ><button class="text-button" @click="cropEditor?.draw()">Nowa ramka</button
              ><button class="text-button" @click="fullImage">Cały obraz</button
              ><button class="text-button" @click="straighten">Wyprostuj ↻</button>
            </div>
            <div class="rotation-control">
              <label for="angle">Obrót</label
              ><input
                id="angle"
                v-model.number="manualAngle"
                type="range"
                min="-180"
                max="180"
                step=".1"
                @input="autoRotate = false"
              /><input
                v-model.number="manualAngle"
                class="angle-number"
                type="number"
                min="-180"
                max="180"
                step=".1"
                aria-label="Obrót w stopniach"
                @input="autoRotate = false"
              /><span>°</span
              ><button
                class="text-button"
                aria-label="Odwróć obraz o 180 stopni"
                @click="flipImage"
              >
                180°
              </button>
            </div>
            <div v-if="detections.length > 1" class="detected-lines">
              <span>Wykryte napisy:</span
              ><button v-for="(d, i) in detections" :key="i" @click="selectDetection(d)">
                {{ d.text }}
              </button>
            </div>
          </section>
          <section class="settings-panel">
            <div class="panel-heading">
              <div>
                <span class="step">02</span>
                <h2>Sprawdź tekst</h2>
              </div>
              <span class="small-tag">OCR + TY</span>
            </div>
            <label class="field-label" for="transcription">Tekst w zaznaczeniu</label
            ><textarea
              id="transcription"
              v-model="text"
              rows="2"
              maxlength="80"
              placeholder="Wpisz dokładnie to, co widzisz…"
              spellcheck="false"
            />
            <p class="field-hint">
              Zachowaj wielkość liter i polskie znaki. Wystarczy jedna linia.
            </p>
            <div class="ocr-row">
              <button class="text-button" :disabled="ocrBusy" @click="runOCR(true)">
                <span :class="{ spinner: ocrBusy }">{{ ocrBusy ? '' : '↻' }}</span>
                {{ ocrBusy ? 'Odczytywanie…' : 'Odczytaj zaznaczenie' }}</button
              ><select v-model="ocrEngine" aria-label="Silnik OCR">
                <option value="auto">OCR: auto</option>
                <option value="paddle">PaddleOCR</option>
                <option value="tesseract">Tesseract</option>
              </select>
            </div>
            <p
              v-if="ocrStatus || ocrError"
              class="ocr-status"
              :class="{ warning: ocrError }"
              role="status"
            >
              {{ ocrError || ocrStatus }}
            </p>
            <div class="preview-heading">
              <span class="field-label">Tak porównujemy kształt</span
              ><span class="preview-tag">BEZ KOLORU I TŁA</span>
            </div>
            <div class="normalized-preview">
              <img
                v-if="normalized"
                :src="normalized"
                alt="Wyizolowany kształt tekstu używany do porównania"
              />
            </div>
            <details class="advanced">
              <summary>Ustawienia dopasowania <span>+</span></summary>
              <div class="advanced-fields">
                <label
                  ><input v-model="autoRotate" type="checkbox" /> Automatycznie wykryj obrót</label
                ><label
                  ><input v-model="thorough" type="checkbox" /> Dokładniejsze szukanie (więcej
                  fontów)</label
                ><label for="polarity"
                  >Tekst i tło<select id="polarity" v-model="mode">
                    <option value="auto">Automatycznie, według koloru</option>
                    <option value="dark">Ciemny tekst</option>
                    <option value="light">Jasny tekst</option>
                  </select></label
                ><label for="threshold"
                  >Próg kontrastu <span>{{ threshold }}</span
                  ><input id="threshold" v-model.number="threshold" type="range" min="-80" max="80"
                /></label>
              </div>
            </details>
            <button
              v-if="!busy"
              class="primary search-button"
              :disabled="!canSearch"
              @click="search"
            >
              Znajdź pasujące fonty <span>→</span></button
            ><button v-else class="cancel-button" @click="stopSearch">
              Zatrzymaj analizę <span>×</span>
            </button>
            <span class="local-note"
              ><span class="status-dot" /> Analiza lokalna · wyłącznie Google Fonts</span
            >
          </section>
        </div>
        <section
          v-if="busy || results.length"
          class="results-section"
          aria-label="Wyniki wyszukiwania"
        >
          <div class="results-title">
            <div>
              <p class="eyebrow">NAJBLIŻSZE DOPASOWANIA</p>
              <h2>{{ busy ? 'Szukamy Twojego fontu…' : 'Kilka dobrych tropów.' }}</h2>
            </div>
            <span v-if="info" class="comparison-count">Porównano {{ info.compared }} odmian</span>
          </div>
          <div v-if="busy" class="progress-panel" role="status">
            <div>
              <span><i class="spinner" /> {{ progress?.stage || 'Przygotowywanie analizy' }}</span
              ><span>{{ progress?.done || 0 }} / {{ progress?.total || '…' }}</span>
            </div>
            <progress :value="percent" max="100" aria-label="Postęp analizy" />
            <p>
              Pierwsze wyszukiwanie pobiera indeks i pliki fontów. Wyniki uzupełniają się na
              bieżąco.
            </p>
          </div>
          <p v-if="stale" class="message warning">
            Zaznaczenie lub ustawienia się zmieniły. Wyszukaj ponownie, aby odświeżyć wyniki.
          </p>
          <p v-if="info?.lowQuality" class="message warning">
            Podobieństwo jest niewielkie. Sprawdź zaznaczenie i tekst — szukany font może też być
            spoza Google Fonts.
          </p>
          <p v-if="info?.failed" class="message warning">
            Nie udało się pobrać {{ info.failed }} odmian. Wynik jest częściowy; ponów analizę przy
            lepszym połączeniu.
          </p>
          <p v-if="interrupted && results.length" class="message warning">
            Analiza została zatrzymana. Poniżej są częściowe wyniki.
          </p>
          <div class="results-grid" :class="{ stale }">
            <ResultCard
              v-for="(r, i) in results"
              :key="r.font.id"
              :result="r"
              :index="i"
              :text="resultsText"
            />
          </div>
          <p v-if="results.length" class="probability-note">
            Procenty określają względne prawdopodobieństwo wśród tych
            {{ results.length }} propozycji. To szacunek podobieństwa, nie pewność rozpoznania.
          </p>
        </section>
      </template>
      <footer>
        <span>Fonty są darmowe. Odkrywanie też.</span><span>BEZ KONTA · BEZ WYSYŁANIA ZDJĘĆ</span>
      </footer>
    </main>
  </div>
</template>
