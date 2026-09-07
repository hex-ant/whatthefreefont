import { chromium, webkit } from 'playwright'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const reportDir = process.env.REPORT_DIR || '.cache/auto-rotation-reports'
await mkdir(reportDir, { recursive: true })
const source = await loadImage('public/examples/playfair-display-clean.png')
const radians = (17 * Math.PI) / 180
const fixture = createCanvas(
  Math.ceil(source.width * Math.cos(radians) + source.height * Math.sin(radians)) + 40,
  Math.ceil(source.width * Math.sin(radians) + source.height * Math.cos(radians)) + 40,
)
const ctx = fixture.getContext('2d')
ctx.fillStyle = '#fff'
ctx.fillRect(0, 0, fixture.width, fixture.height)
ctx.translate(fixture.width / 2, fixture.height / 2)
ctx.rotate(radians)
ctx.drawImage(source, -source.width / 2, -source.height / 2)
const fixturePath = `${reportDir}/tilted.png`
await writeFile(fixturePath, fixture.toBuffer('image/png'))
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const angle = page.getByRole('spinbutton', { name: 'Rotation in degrees' })
  const reset = page.getByRole('button', { name: 'Reset rotation' })
  await reset.waitFor()
  assert(Math.abs(Number(await angle.inputValue()) + 17) < 1, 'Straighten on upload')
  assert(await page.locator('.rotation-note').isVisible())
  assert((await page.locator('.rotated-image').getAttribute('transform'))?.includes('rotate(-17'))
  await page.waitForFunction(
    () => document.querySelector('.ocr-status')?.textContent?.startsWith('Read '),
    undefined,
    { timeout: 180000 },
  )
  assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
  await page.screenshot({ path: `${reportDir}/automatic.png`, fullPage: true })
  await reset.click()
  assert.equal(await angle.inputValue(), '0')
  assert.equal(await reset.count(), 0)
  assert.equal(await page.locator('.rotation-note').count(), 0)
  // Searching must not silently reapply the correction that was just reset.
  await page.getByRole('button', { name: 'Find matching fonts' }).click()
  assert.equal(await angle.inputValue(), '0')
  await page.getByRole('button', { name: 'Stop search' }).click()
  await page.getByRole('button', { name: 'Rotate image by 180 degrees' }).click()
  assert.equal(await angle.inputValue(), '-180')
  assert(await reset.isVisible())
  await reset.click()
  await angle.fill('12')
  assert(await reset.isVisible())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${reportDir}/mobile.png`, fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await reset.click()
  // Reset while a fresh OCR pass is running; its completion cannot restore the angle.
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await reset.waitFor()
  await reset.click()
  await page.getByRole('button', { name: 'Read selection' }).waitFor()
  assert.equal(await angle.inputValue(), '0')
  await page.locator('input[type=file]').setInputFiles('public/examples/playfair-display-clean.png')
  await page.locator('.filename').filter({ hasText: 'playfair-display-clean.png' }).waitFor()
  assert.equal(await angle.inputValue(), '0', 'Keep upright input unchanged')
  assert.equal(await reset.count(), 0)
  assert.deepEqual(errors, [])
  console.log('Automatic deskew, OCR, reset, manual rotation and mobile checks passed')
} finally {
  await browser.close()
}
