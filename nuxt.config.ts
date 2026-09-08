import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync } from 'node:fs'
import { site, structuredData } from './config/site'

const paddleAssets = join(
  dirname(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js'))),
  'assets',
)
const paddleWorkers = readdirSync(paddleAssets).filter((name) => /^worker-entry-.*\.js$/.test(name))
if (paddleWorkers.length !== 1) throw new Error('Expected exactly one PaddleOCR worker asset')

export default defineNuxtConfig({
  alias: { 'paddle-ocr-worker-asset?url': join(paddleAssets, paddleWorkers[0]!) + '?url' },
  compatibilityDate: '2026-09-01',
  // Render the landing page at build time; deployment still contains only static files.
  ssr: true,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: site.title,
      htmlAttrs: { lang: 'en', prefix: 'og: https://ogp.me/ns#' },
      link: [
        { rel: 'canonical', href: site.url },
        { rel: 'icon', type: 'image/svg+xml', href: 'favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: 'favicon-32.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: 'apple-touch-icon.png' },
      ],
      meta: [
        { name: 'description', content: site.description },
        { name: 'robots', content: 'index, follow, max-image-preview:large' },
        { name: 'theme-color', content: '#f5f6f2' },
        { name: 'application-name', content: site.name },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: site.name },
        { property: 'og:locale', content: 'en_US' },
        { property: 'og:title', content: site.title },
        { property: 'og:description', content: site.description },
        { property: 'og:url', content: site.url },
        { property: 'og:image', content: site.image },
        { property: 'og:image:type', content: 'image/png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: site.imageAlt },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: site.title },
        { name: 'twitter:description', content: site.description },
        { name: 'twitter:image', content: site.image },
        { name: 'twitter:image:alt', content: site.imageAlt },
      ],
      script: [
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
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
