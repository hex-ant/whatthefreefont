import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync } from 'node:fs'

const paddleAssets = join(
  dirname(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js'))),
  'assets',
)
const paddleWorkers = readdirSync(paddleAssets).filter((name) => /^worker-entry-.*\.js$/.test(name))
if (paddleWorkers.length !== 1) throw new Error('Expected exactly one PaddleOCR worker asset')

export default defineNuxtConfig({
  alias: { 'paddle-ocr-worker-asset?url': join(paddleAssets, paddleWorkers[0]!) + '?url' },
  compatibilityDate: '2026-09-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'What the Free Font — rozpoznaj font z obrazu',
      htmlAttrs: { lang: 'pl' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: 'favicon.svg' }],
      meta: [
        {
          name: 'description',
          content:
            'Znajdź pasujące kroje Google Fonts. Analiza obrazu i OCR lokalnie w Twojej przeglądarce.',
        },
      ],
    },
  },
  typescript: { strict: true },
  vite: {
    worker: { format: 'es' },
    optimizeDeps: {
      include: ['@paddleocr/paddleocr-js', 'tesseract.js'],
      exclude: ['paddle-ocr-worker-asset?url'],
    },
  },
})
