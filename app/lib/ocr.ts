import type { Recognition } from './types'

let paddle:
  | Promise<
      | import('@paddleocr/paddleocr-js').PaddleOCR
      | Awaited<ReturnType<typeof import('@paddleocr/paddleocr-js').PaddleOCR.create>>
    >
  | undefined
let tesseract: Promise<import('tesseract.js').Worker> | undefined
let queue: Promise<unknown> = Promise.resolve()

function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OCR timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Join neighbouring word boxes from the same horizontal text line. */
export function groupLines(input: Recognition[]): Recognition[] {
  const result: Recognition[] = []
  for (const item of [...input].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const match = result.find((r) => {
      const a = r.box,
        b = item.box,
        overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0)
      return (
        Math.abs(item.angle || 0) < 10 &&
        Math.abs(r.angle || 0) < 10 &&
        overlap > Math.min(a.height, b.height) * 0.6 &&
        Math.max(a.height, b.height) < Math.min(a.height, b.height) * 1.7 &&
        gap < Math.max(a.height, b.height) * 3
      )
    })
    if (!match) {
      result.push({ ...item, box: { ...item.box } })
      continue
    }
    const a = match.box,
      b = item.box,
      x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y)
    match.confidence =
      (match.confidence * match.text.length + item.confidence * item.text.length) /
      (match.text.length + item.text.length)
    match.text = b.x < a.x ? `${item.text} ${match.text}` : `${match.text} ${item.text}`
    match.box = {
      x,
      y,
      width: Math.max(a.x + a.width, b.x + b.width) - x,
      height: Math.max(a.y + a.height, b.y + b.height) - y,
    }
  }
  return result
}

export async function recognizePaddle(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
  assetBase = '/',
): Promise<Recognition[]> {
  onStatus(paddle ? 'Wykrywanie napisów…' : 'Pobieranie modelu OCR — tylko przy pierwszym użyciu…')
  const base = new URL(assetBase, location.origin).href
  paddle ||= import('@paddleocr/paddleocr-js')
    .then(({ PaddleOCR }) =>
      PaddleOCR.create({
        lang: 'pl',
        ocrVersion: 'PP-OCRv6',
        worker: true,
        textDetectionModelName: 'PP-OCRv6_small_det',
        textRecognitionModelName: 'PP-OCRv6_small_rec',
        textDetectionModelAsset: { url: `${base}models/PP-OCRv6_small_det.tar` },
        textRecognitionModelAsset: { url: `${base}models/PP-OCRv6_small_rec.tar` },
        ortOptions: {
          backend: 'wasm',
          numThreads: 1,
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',
        },
      }),
    )
    .catch((e) => {
      paddle = undefined
      throw e
    })
  const engine = await deadline(paddle, 90000)
  onStatus('Wykrywanie i odczytywanie napisów…')
  const [result] = await engine.predict(canvas, {
    textDetLimitSideLen: 1280,
    textRecScoreThresh: 0.15,
  })
  return groupLines(
    (result?.items || []).map((item) => {
      const xs = item.poly.map((p) => p[0]),
        ys = item.poly.map((p) => p[1])
      const x = Math.max(0, Math.min(...xs) - 4),
        y = Math.max(0, Math.min(...ys) - 4)
      const angle =
        (Math.atan2(item.poly[1]![1] - item.poly[0]![1], item.poly[1]![0] - item.poly[0]![0]) *
          180) /
        Math.PI
      return {
        text: item.text,
        confidence: item.score,
        angle,
        box: {
          x,
          y,
          width: Math.min(canvas.width - x, Math.max(...xs) - x + 4),
          height: Math.min(canvas.height - y, Math.max(...ys) - y + 4),
        },
      }
    }),
  )
}

export async function recognizeTesseract(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
): Promise<Recognition[]> {
  onStatus(tesseract ? 'Odczytywanie tekstu…' : 'Pobieranie alternatywnego modelu OCR…')
  tesseract ||= import('tesseract.js')
    .then(({ createWorker }) =>
      createWorker(['eng', 'pol'], 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: (m) => {
          if (m.status === 'recognizing text')
            onStatus(`Odczytywanie tekstu… ${Math.round(m.progress * 100)}%`)
        },
      }),
    )
    .catch((e) => {
      tesseract = undefined
      throw e
    })
  const engine = await tesseract
  const { data } = await engine.recognize(canvas, {}, { text: true, blocks: true })
  const lines = data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) || []
  return lines
    .map((l) => ({
      text: l.text.trim(),
      confidence: l.confidence / 100,
      box: {
        x: l.bbox.x0,
        y: l.bbox.y0,
        width: l.bbox.x1 - l.bbox.x0,
        height: l.bbox.y1 - l.bbox.y0,
      },
    }))
    .filter((l) => l.text)
}

async function recognizeNow(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
  engine: 'auto' | 'paddle' | 'tesseract' = 'auto',
  assetBase = '/',
) {
  if (engine === 'tesseract') return recognizeTesseract(canvas, onStatus)
  try {
    const found = await recognizePaddle(canvas, onStatus, assetBase)
    if (found.length || engine === 'paddle') return found
  } catch (e) {
    if (engine === 'paddle') throw e
    console.warn('PaddleOCR unavailable, trying Tesseract:', e)
  }
  return recognizeTesseract(canvas, onStatus)
}

export function recognize(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
  engine: 'auto' | 'paddle' | 'tesseract' = 'auto',
  assetBase = '/',
) {
  const job = queue
    .catch(() => {})
    .then(() => deadline(recognizeNow(canvas, onStatus, engine, assetBase), 120000))
  queue = job.catch(() => {})
  return job
}
