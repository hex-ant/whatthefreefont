import { chromium, webkit } from 'playwright'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const reportDir = process.env.REPORT_DIR || '.cache/rotation-reports'
await mkdir(reportDir, { recursive: true })
const original = await loadImage('public/examples/playfair-display-clean.png')
const fixture = createCanvas(original.height, original.width),
  ctx = fixture.getContext('2d')
ctx.translate(fixture.width, 0)
ctx.rotate(Math.PI / 2)
ctx.drawImage(original, 0, 0)
const fixturePath = `${reportDir}/sideways.png`
await writeFile(fixturePath, fixture.toBuffer('image/png'))
const browser =
  process.env.BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ channel: process.env.BROWSER === 'chrome' ? 'chrome' : undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const angle = page.getByRole('spinbutton', { name: 'Obrót w stopniach' })
  await angle.fill('-53')
  const bounds = await page.locator('.crop-svg').evaluate((svg) => {
    const root = svg as unknown as SVGSVGElement
    const image = root.querySelector('image')!
    const transform = root
      .getCTM()!
      .inverse()
      .multiply((image as SVGGraphicsElement).getCTM()!)
    const points = [
      [0, 0],
      [Number(image.getAttribute('width')), 0],
      [0, Number(image.getAttribute('height'))],
      [Number(image.getAttribute('width')), Number(image.getAttribute('height'))],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform))
    return {
      width: root.viewBox.baseVal.width,
      height: root.viewBox.baseVal.height,
      points: points.map((p) => ({ x: p.x, y: p.y })),
    }
  })
  assert(
    bounds.points.every(
      (p) => p.x > 10 && p.y > 10 && p.x < bounds.width - 10 && p.y < bounds.height - 10,
    ),
    'All rotated corners need visible padding',
  )
  await page.screenshot({ path: `${reportDir}/rotated-preview.png`, fullPage: true })
  await angle.fill('-90')
  await page.getByRole('button', { name: 'Nowa ramka' }).click()
  const positions = await page.locator('.crop-svg').evaluate((svg) => {
    const root = svg as unknown as SVGSVGElement,
      box = root.viewBox.baseVal
    return [
      [8, 8],
      [box.width - 8, box.height - 8],
    ].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(root.getScreenCTM()!)
      return { x: p.x, y: p.y }
    })
  })
  await page.mouse.move(positions[0]!.x, positions[0]!.y)
  await page.mouse.down()
  await page.mouse.move(positions[1]!.x, positions[1]!.y, { steps: 10 })
  await page.mouse.up()
  assert(
    Number(await page.locator('.selected-box').getAttribute('x')) < 12,
    'Crop must extend into padding',
  )
  await page.getByRole('button', { name: 'Odczytaj zaznaczenie' }).click()
  await page.getByRole('button', { name: 'Odczytaj zaznaczenie' }).waitFor({ timeout: 180000 })
  assert.equal(
    await page.locator('#transcription').inputValue(),
    'Hamburge Fonts',
    'OCR must receive the rotated crop',
  )
  await page.getByRole('button', { name: 'Znajdź pasujące fonty' }).click()
  await page.locator('.comparison-count').waitFor({ timeout: 300000 })
  assert.equal(
    await page.locator('.result-heading h3').first().textContent(),
    'Playfair Display',
    'Matcher must receive the rotated crop once',
  )
  await page.screenshot({ path: `${reportDir}/padded-crop-result.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${reportDir}/rotation-mobile.png`, fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('Rotation, padding, crop, OCR, matching and mobile checks passed')
} finally {
  await browser.close()
}
