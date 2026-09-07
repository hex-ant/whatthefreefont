import paddleWorkerUrl from 'paddle-ocr-worker-asset?url'

export function createPaddleWorker() {
  return new Worker(paddleWorkerUrl, { type: 'module' })
}
