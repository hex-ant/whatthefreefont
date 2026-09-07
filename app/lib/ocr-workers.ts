export function createTesseractWorker() {
  const url = URL.createObjectURL(
    new Blob(
      ['importScripts("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js");'],
      { type: 'application/javascript' },
    ),
  )
  try {
    return new Worker(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
