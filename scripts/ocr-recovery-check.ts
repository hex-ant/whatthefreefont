import { chromium, type Route } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  channel: process.env.BROWSER === 'chromium' ? undefined : 'chrome',
  headless: true,
})
const results = []
try {
  for (const engine of ['paddle', 'tesseract']) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.clock.install()
      const pattern =
        engine === 'paddle'
          ? '**/models/PP-OCRv6_small_det.tar'
          : '**/tesseract.js@7.0.0/dist/worker.min.js'
      let held: Route | undefined
      await context.route(pattern, (route) => {
        held = route
      })
      await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
      await page.getByRole('button', { name: /Serifs and spacing/ }).click()
      await page.getByRole('combobox', { name: 'OCR engine' }).selectOption(engine)
      await page.locator('#transcription').fill('')
      await page.getByRole('button', { name: 'Read selection' }).click()
      for (let i = 0; !held && i < 600; i++) await setTimeout(100)
      assert(held, `${engine} did not request the intercepted initialization resource`)
      assert(page.workers().length > 0, 'OCR must own a real worker during initialization')
      await page.clock.fastForward(120001)
      await page.getByRole('button', { name: 'Read selection' }).waitFor()
      assert((await page.locator('.ocr-status').textContent())?.includes('You can retry'))
      for (let i = 0; page.workers().length && i < 100; i++) await setTimeout(50)
      assert.equal(page.workers().length, 0, `${engine} worker survived timeout`)
      await held.abort().catch(() => {})
      await context.unroute(pattern)
      await page.getByRole('button', { name: 'Read selection' }).click()
      await page.getByRole('button', { name: 'Read selection' }).waitFor({ timeout: 180000 })
      assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
      assert.deepEqual(errors, [])
      results.push({
        engine,
        stalledInitialization: true,
        workerTerminated: true,
        retrySucceeded: true,
      })
      console.log('OCR recovery', engine, 'passed')
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
const reportDir = process.env.REPORT_DIR || 'docs/benchmarks'
await mkdir(reportDir, { recursive: true })
await writeFile(`${reportDir}/ocr-recovery.json`, JSON.stringify(results, null, 2))
