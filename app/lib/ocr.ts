import type { Recognition } from './types'
import { OcrSession } from './ocr-session'

type Paddle = Awaited<ReturnType<typeof import('@paddleocr/paddleocr-js').PaddleOCR.create>>
type Tesseract = import('tesseract.js').Worker
let paddle: OcrSession<Paddle> | undefined
let tesseract: OcrSession<Tesseract> | undefined
let queue: Promise<unknown> = Promise.resolve()
let generation = 0

export function resetOCR() {
  generation++
  paddle?.close()
  tesseract?.close()
  paddle = undefined
  tesseract = undefined
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

async function recognizePaddle(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
  assetBase: string,
) {
  onStatus(paddle ? 'Detecting text…' : 'Downloading the OCR model — first use only…')
  paddle ||= new OcrSession(async (own) => {
    const [{ PaddleOCR }, { createPaddleWorker }] = await Promise.all([
      import('@paddleocr/paddleocr-js'),
      import('./paddle-worker'),
    ])
    const base = new URL(assetBase, location.origin).href
    return PaddleOCR.create({
      lang: 'pl',
      ocrVersion: 'PP-OCRv6',
      worker: { createWorker: () => own(createPaddleWorker()) },
      textDetectionModelName: 'PP-OCRv6_small_det',
      textRecognitionModelName: 'PP-OCRv6_small_rec',
      textDetectionModelAsset: { url: `${base}models/PP-OCRv6_small_det.tar` },
      textRecognitionModelAsset: { url: `${base}models/PP-OCRv6_small_rec.tar` },
      // This SDK's prebundled worker embeds ORT 1.24.3, independently of the npm dependency.
      ortOptions: {
        backend: 'wasm',
        numThreads: 1,
        wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',
      },
    })
  })
  const session = paddle
  try {
    return await session.run(async (engine) => {
      onStatus('Detecting and reading text…')
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
          return {
            text: item.text,
            confidence: item.score,
            angle:
              (Math.atan2(
                item.poly[1]![1] - item.poly[0]![1],
                item.poly[1]![0] - item.poly[0]![0],
              ) *
                180) /
              Math.PI,
            box: {
              x,
              y,
              width: Math.min(canvas.width - x, Math.max(...xs) - x + 4),
              height: Math.min(canvas.height - y, Math.max(...ys) - y + 4),
            },
          }
        }),
      )
    }, onStatus)
  } catch (error) {
    if (paddle === session) paddle = undefined
    throw error
  }
}

async function recognizeTesseract(canvas: HTMLCanvasElement, onStatus: (message: string) => void) {
  onStatus(tesseract ? 'Reading text…' : 'Downloading the alternative OCR model…')
  tesseract ||= new OcrSession(async (own, status) => {
    const [{ createWorker }, { createTesseractWorker }] = await Promise.all([
      import('tesseract.js'),
      import('./ocr-workers'),
    ])
    // The committed pnpm patch exposes ownership before createWorker finishes initialization.
    const options = {
      createWorker: () => own(createTesseractWorker()),
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text')
          status(`Reading text… ${Math.round(m.progress * 100)}%`)
      },
    }
    return createWorker(['eng', 'pol'], 1, options)
  })
  const session = tesseract
  try {
    return await session.run(async (engine) => {
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
    }, onStatus)
  } catch (error) {
    if (tesseract === session) tesseract = undefined
    throw error
  }
}

export function recognize(
  canvas: HTMLCanvasElement,
  onStatus: (message: string) => void,
  engine: 'auto' | 'paddle' | 'tesseract' = 'auto',
  assetBase = '/',
) {
  const requestedGeneration = generation
  const job = queue
    .catch(() => {})
    .then(async () => {
      if (requestedGeneration !== generation) throw new Error('OCR cancelled')
      if (engine === 'tesseract') return recognizeTesseract(canvas, onStatus)
      try {
        const found = await recognizePaddle(canvas, onStatus, assetBase)
        if (found.length || engine === 'paddle') return found
      } catch (error) {
        if (engine === 'paddle' || requestedGeneration !== generation) throw error
        console.warn('PaddleOCR unavailable, trying Tesseract:', error)
      }
      if (requestedGeneration !== generation) throw new Error('OCR cancelled')
      return recognizeTesseract(canvas, onStatus)
    })
  queue = job.catch(() => {})
  return job
}
