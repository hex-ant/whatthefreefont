import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paddle: vi.fn(),
  tesseract: vi.fn(),
  workers: [] as { terminate: ReturnType<typeof vi.fn> }[],
}))
vi.mock('@paddleocr/paddleocr-js', () => ({ PaddleOCR: { create: mocks.paddle } }))
vi.mock('tesseract.js', () => ({ createWorker: mocks.tesseract }))
vi.mock('../app/lib/ocr-workers', () => {
  const create = () => {
    const worker = { terminate: vi.fn() }
    mocks.workers.push(worker)
    return worker
  }
  return { createPaddleWorker: create, createTesseractWorker: create }
})
vi.mock('../app/lib/paddle-worker', () => ({
  createPaddleWorker: () => {
    const worker = { terminate: vi.fn() }
    mocks.workers.push(worker)
    return worker
  },
}))
afterEach(async () => {
  const { resetOCR } = await import('../app/lib/ocr')
  resetOCR()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  mocks.paddle.mockReset()
  mocks.tesseract.mockReset()
  mocks.workers.length = 0
})
function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('location', { origin: 'http://localhost' })
}
const canvas = {} as HTMLCanvasElement

it.each(['paddle', 'tesseract'] as const)(
  'terminates %s during stuck initialization and allows a fresh retry',
  async (engine) => {
    setup()
    const create = engine === 'paddle' ? mocks.paddle : mocks.tesseract
    create.mockImplementation((...args) => {
      const options = engine === 'paddle' ? args[0].worker : args[2]
      options.createWorker()
      return new Promise(() => {})
    })
    const { recognize } = await import('../app/lib/ocr')
    const first = recognize(canvas, () => {}, engine).catch((e) => e.message)
    await vi.advanceTimersByTimeAsync(120001)
    expect(await first).toBe('OCR timeout')
    expect(mocks.workers[0]!.terminate).toHaveBeenCalledOnce()
    create.mockImplementation((...args) => {
      ;(engine === 'paddle' ? args[0].worker : args[2]).createWorker()
      return Promise.resolve({ predict: async () => [], recognize: async () => ({ data: {} }) })
    })
    expect(await recognize(canvas, () => {}, engine)).toEqual([])
    expect(create).toHaveBeenCalledTimes(2)
  },
)

it('ends timed-out inference before starting a queued job on a new worker', async () => {
  setup()
  let finish: (value: unknown[]) => void = () => {}
  const predict = vi.fn(
    () =>
      new Promise<unknown[]>((resolve) => {
        finish = resolve
      }),
  )
  mocks.paddle.mockImplementation(({ worker }) => {
    worker.createWorker()
    return Promise.resolve({ predict })
  })
  const { recognize } = await import('../app/lib/ocr')
  const first = recognize(canvas, () => {}, 'paddle').catch((e) => e.message)
  const status = vi.fn()
  const second = recognize(canvas, status, 'paddle')
  await vi.advanceTimersByTimeAsync(1)
  expect(predict).toHaveBeenCalledOnce()
  const lateFinish = finish
  await vi.advanceTimersByTimeAsync(120000)
  expect(await first).toBe('OCR timeout')
  expect(mocks.workers[0]!.terminate).toHaveBeenCalledOnce()
  expect(mocks.paddle).toHaveBeenCalledTimes(2)
  lateFinish([])
  finish([])
  expect(await second).toEqual([])
})

it('falls back after Paddle timeout and does not reuse its dead worker', async () => {
  setup()
  mocks.paddle.mockImplementation(({ worker }) => {
    worker.createWorker()
    return new Promise(() => {})
  })
  mocks.tesseract.mockImplementation((_langs, _oem, options) => {
    options.createWorker()
    return Promise.resolve({ recognize: async () => ({ data: {} }) })
  })
  const { recognize } = await import('../app/lib/ocr')
  const result = recognize(canvas, () => {})
  await vi.advanceTimersByTimeAsync(120001)
  expect(await result).toEqual([])
  expect(mocks.workers[0]!.terminate).toHaveBeenCalledOnce()
  expect(mocks.tesseract).toHaveBeenCalledOnce()
})

it('cancellation drops queued work and prevents automatic fallback', async () => {
  setup()
  mocks.paddle.mockImplementation(({ worker }) => {
    worker.createWorker()
    return new Promise(() => {})
  })
  const { recognize, resetOCR } = await import('../app/lib/ocr')
  const first = recognize(canvas, () => {}).catch((e) => e.message)
  const second = recognize(canvas, () => {}).catch((e) => e.message)
  await vi.advanceTimersByTimeAsync(1)
  resetOCR()
  expect(await first).toBe('OCR cancelled')
  expect(await second).toBe('OCR cancelled')
  expect(mocks.paddle).toHaveBeenCalledOnce()
  expect(mocks.tesseract).not.toHaveBeenCalled()
})

it('sends Tesseract progress to the current request when reusing the engine', async () => {
  setup()
  mocks.tesseract.mockImplementation((_langs, _oem, options) => {
    options.createWorker()
    return Promise.resolve({
      recognize: async () => {
        options.logger({ status: 'recognizing text', progress: 0.5 })
        return { data: {} }
      },
    })
  })
  const { recognize } = await import('../app/lib/ocr')
  const first = vi.fn(),
    second = vi.fn()
  await recognize(canvas, first, 'tesseract')
  first.mockClear()
  await recognize(canvas, second, 'tesseract')
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledWith('Odczytywanie tekstu… 50%')
  expect(mocks.tesseract).toHaveBeenCalledOnce()
})
