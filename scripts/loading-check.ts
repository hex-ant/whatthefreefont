import { chromium, webkit } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { Catalog } from '../app/lib/types'

const reportDir = `${process.env.REPORT_DIR || '.cache/loading-reports'}/loading`
await mkdir(reportDir, { recursive: true })
const catalog: Catalog = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8'))
const matches = ['Playfair Display', 'Montserrat'].map((family, i) => ({
  font: catalog.variants.find((font) => font.family === family && font.weight === 400)!,
  score: 0.02 + i * 0.01,
  probability: 0.6 - i * 0.2,
  source: 'refined',
}))
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch()
try {
  for (const width of [390, 1440]) {
    for (const reducedMotion of ['reduce', 'no-preference'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      // Hold the matcher at deterministic stages, including slow start and partial results.
      // Real matching and OCR remain covered by browser-check and ocr-check.
      await page.addInitScript(() => {
        const NativeWorker = window.Worker
        window.Worker = class {
          onmessage?: (event: { data: unknown }) => void
          constructor(url: string | URL, options?: WorkerOptions) {
            if (!String(url).includes('matcher.worker')) return new NativeWorker(url, options)
            ;(window as any).__deliverMatch = (data: unknown) => this.onmessage?.({ data })
          }
          postMessage() {}
          terminate() {
            ;(window as any).__deliverMatch = undefined
          }
        } as unknown as typeof Worker
      })
      await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForFunction(() =>
        document.querySelector('.catalog-note')?.textContent?.includes('families'),
      )
      await page.getByRole('button', { name: /Serifs and spacing/ }).click()
      await page.getByRole('button', { name: 'Find matching fonts' }).click()
      await page.waitForFunction(() => {
        const heading = document.querySelector('.results-title h2')!
        return Math.abs(heading.getBoundingClientRect().top - 24) < 2
      })
      assert.equal(await page.locator('.result-skeleton').count(), 8)
      assert.equal(await page.locator('.result-heading h3').count(), 0)
      assert(await page.getByRole('button', { name: 'Stop search' }).isVisible())
      const card = await page.locator('.result-skeleton').first().boundingBox()
      assert(card && card.y >= 0 && card.y + card.height < 900, 'First card fits in viewport')
      assert.equal(
        await page.locator('.result-skeleton').first().getAttribute('aria-hidden'),
        'true',
      )
      const animation = await page
        .locator('.skeleton-block')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName)
      assert.equal(animation, reducedMotion === 'reduce' ? 'none' : 'skeleton-pulse')
      await page.screenshot({ path: `${reportDir}/initial-${width}-${reducedMotion}.png` })
      await page.evaluate(() => window.scrollBy(0, 120))
      const position = await page.evaluate(() => scrollY)
      await page.evaluate(
        (data) => (window as any).__deliverMatch({ type: 'partial', data }),
        matches,
      )
      await page.waitForFunction(() => document.querySelectorAll('.result-skeleton').length === 6)
      assert.equal(await page.locator('.results-grid > .result-card').count(), 8)
      assert.equal(await page.locator('.result-heading h3').count(), 2)
      assert(
        Math.abs((await page.evaluate(() => scrollY)) - position) < 2,
        'Partial results must not scroll back',
      )
      await page.evaluate(
        (results) =>
          (window as any).__deliverMatch({
            type: 'result',
            data: { results, compared: 2, failed: 0, lowQuality: false },
          }),
        matches,
      )
      await page.waitForFunction(() => document.querySelectorAll('.result-skeleton').length === 0)
      assert.equal(await page.locator('.result-heading h3').count(), 2)
      assert.equal(await page.locator('.progress-panel').count(), 0)
      await page.getByRole('button', { name: 'Edit selection' }).click()
      await page.getByRole('button', { name: 'Find matching fonts' }).click()
      await page.getByRole('button', { name: 'Stop search' }).click()
      assert.equal(await page.locator('.result-skeleton').count(), 0)
      assert.equal(await page.locator('.results-title h2').textContent(), 'Search stopped')
      await page.getByRole('button', { name: 'Find matching fonts' }).click()
      await page.evaluate(() =>
        (window as any).__deliverMatch({ type: 'error', data: 'Test download failure' }),
      )
      await page.getByRole('alert').waitFor()
      assert.equal(await page.locator('.result-skeleton').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  }
  console.log(
    'Loading placeholders, top-aligned scrolling, partial replacement, completion, cancellation, errors and reduced motion passed',
  )
} finally {
  await browser.close()
}
