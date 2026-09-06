export default defineNuxtConfig({
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
    optimizeDeps: { include: ['@paddleocr/paddleocr-js', 'tesseract.js'] },
  },
})
