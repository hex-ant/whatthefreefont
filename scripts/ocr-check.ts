import { chromium, webkit } from 'playwright'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browserName = process.env.BROWSER || 'chrome'
const browser =
  browserName === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text().slice(0, 500))
})
page.on('requestfailed', (r) =>
  console.log('FAILED', r.url().slice(0, 200), r.failure()?.errorText),
)
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
await page.getByRole('button', { name: /Szeryfy i odstępy/ }).click()
const results = []
for (const engine of ['paddle', 'tesseract']) {
  await page.getByRole('combobox', { name: 'Silnik OCR' }).selectOption(engine)
  await page.locator('#transcription').fill('')
  const start = Date.now()
  await page.getByRole('button', { name: 'Odczytaj zaznaczenie' }).click()
  await page.getByRole('button', { name: 'Odczytaj zaznaczenie' }).waitFor({ timeout: 240000 })
  const text = await page.locator('#transcription').inputValue(),
    status = await page.locator('.ocr-status').textContent()
  const result = { engine, seconds: (Date.now() - start) / 1000, text, status }
  results.push(result)
  console.log('OCR', JSON.stringify(result))
  assert(status?.startsWith('Odczytano'), `OCR failed: ${engine}`)
  assert.equal(text, 'Hamburge Fonts')
}
await writeFile(`docs/benchmarks/ocr-${browserName}.json`, JSON.stringify(results, null, 2))
await browser.close()
