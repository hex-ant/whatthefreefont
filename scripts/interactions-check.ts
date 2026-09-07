import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const reportDir = process.env.REPORT_DIR || 'docs/benchmarks'
await mkdir(`${reportDir}/screenshots`, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.BROWSER === 'chromium' ? undefined : 'chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
  mutations: string[] = [],
  errors: string[] = []
page.on('request', (r) => {
  if (!['GET', 'HEAD'].includes(r.method())) mutations.push(`${r.method()} ${r.url()}`)
})
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool(tool: any) {
        ;(window as any).__fontTools ||= {}
        ;(window as any).__fontTools[tool.name] = tool
      },
    },
  })
})
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Obrót i kolor/ }).click()
await page.getByRole('button', { name: 'Nowa ramka' }).click()
const svg = page.locator('.crop-svg'),
  box = await svg.boundingBox()
assert(box)
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, { steps: 12 })
await page.mouse.up()
const rect = page.locator('.selected-box'),
  before = {
    x: Number(await rect.getAttribute('x')),
    width: Number(await rect.getAttribute('width')),
  }
assert(before.x > 0)
await rect.focus()
await page.keyboard.press('ArrowRight')
assert.equal(Number(await rect.getAttribute('x')), before.x + 1)
await page.keyboard.press('Alt+ArrowRight')
assert.equal(Number(await rect.getAttribute('width')), before.width + 1)
await page.getByRole('button', { name: 'Cały obraz' }).click()
const toolResult = await page.evaluate(async () => {
  const tool = (window as any).__fontTools.configure_font_search
  let invalid = false
  try {
    await tool.execute({ text: 'x', rotation: 400 })
  } catch {
    invalid = true
  }
  const valid = await tool.execute({ text: 'Hamburge Fonts', rotation: 0 })
  return { invalid, valid }
})
assert(toolResult.invalid)
assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
await page.getByRole('button', { name: 'Znajdź pasujące fonty' }).click()
await page.getByRole('button', { name: 'Zatrzymaj analizę' }).click()
assert.equal(await page.locator('.progress-panel').count(), 0)
await page.locator('input[type=file]').setInputFiles('public/examples/playfair-display-clean.png')
await page.waitForFunction(
  () => document.querySelector('.ocr-status')?.textContent?.startsWith('Odczytano'),
  {},
  { timeout: 120000 },
)
assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
assert((await page.locator('.detected-box').count()) > 0)
await page.locator('input[type=file]').setInputFiles('public/examples/poppins-clean.png')
await page.locator('#transcription').fill('Moja ręczna korekta')
await page.waitForFunction(
  () => document.querySelector('.ocr-status')?.textContent?.startsWith('Odczytano'),
  {},
  { timeout: 120000 },
)
assert.equal(
  await page.locator('#transcription').inputValue(),
  'Moja ręczna korekta',
  'Late OCR must preserve manual corrections',
)
await page.setViewportSize({ width: 390, height: 844 })
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  'Mobile overflow',
)
await page.screenshot({ path: `${reportDir}/screenshots/mobile-editor.png`, fullPage: true })
assert.deepEqual(mutations, [])
assert.deepEqual(errors, [])
await writeFile(
  `${reportDir}/interactions.json`,
  JSON.stringify(
    {
      cropDraw: true,
      keyboardMove: true,
      keyboardResize: true,
      cancel: true,
      uploadDetection: true,
      prefill: true,
      manualCorrectionPreserved: true,
      mobileNoOverflow: true,
      webMCPContractMock: toolResult,
      mutations,
      errors,
    },
    null,
    2,
  ),
)
console.log('Interaction checks passed')
await browser.close()
