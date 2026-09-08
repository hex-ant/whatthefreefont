import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const reportDir = process.env.REPORT_DIR || '.cache/ux-reports'
await mkdir(`${reportDir}/ux`, { recursive: true })
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch()
const metrics: object[] = []
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: width < 500 ? 844 : 900 },
      reducedMotion: 'reduce',
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${reportDir}/ux/home-${width}.png`, fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: /Serifs and spacing/ }).click()
    await page.locator('#transcription').waitFor()
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Select one line of text',
    )
    const search = page.getByRole('button', { name: 'Find matching fonts' })
    const bounds = await search.boundingBox()
    assert(bounds)
    if (width === 390 || width === 1440)
      assert(
        bounds.y >= 0 && bounds.y + bounds.height <= (width === 390 ? 844 : 900),
        `Primary action should fit at ${width}px: ${JSON.stringify(bounds)}`,
      )
    metrics.push({
      width,
      buttonY: bounds.y,
      buttonBottom: bounds.y + bounds.height,
      ...(await page.evaluate(() => ({
        scrollY,
        documentHeight: document.documentElement.scrollHeight,
      }))),
    })
    const angle = page.getByRole('spinbutton', { name: 'Rotation in degrees', includeHidden: true })
    const engine = page.getByRole('combobox', { name: 'OCR engine', includeHidden: true })
    assert.equal(await angle.isVisible(), false)
    assert.equal(await engine.isVisible(), false)
    assert.equal(await page.locator('.normalized-preview').isVisible(), false)
    assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
    await page.screenshot({ path: `${reportDir}/ux/editor-${width}.png`, fullPage: true })
    // Native disclosures must work with a keyboard and preserve values when closed.
    const imageSummary = page.locator('.image-options > summary')
    await imageSummary.focus()
    await imageSummary.press('Enter')
    await angle.waitFor()
    await angle.fill('12')
    await imageSummary.focus()
    await imageSummary.press('Enter')
    assert.equal(await angle.isVisible(), false)
    assert(await page.getByRole('button', { name: 'Reset rotation' }).isVisible())
    assert.equal(await angle.inputValue(), '12')
    await page.getByRole('button', { name: 'Reset rotation' }).click()
    assert.equal(await angle.inputValue(), '0')
    const advancedSummary = page.locator('.advanced > summary')
    await advancedSummary.focus()
    await advancedSummary.press('Enter')
    await engine.selectOption('tesseract')
    const thorough = page.getByRole('checkbox', { name: 'Thorough search (more fonts)' })
    await thorough.check()
    await advancedSummary.press('Enter')
    assert.equal(await engine.isVisible(), false)
    await advancedSummary.press('Enter')
    assert.equal(await engine.inputValue(), 'tesseract')
    assert(await thorough.isChecked())
    assert(await page.locator('.normalized-preview').isVisible())
    await imageSummary.click()
    assert(await page.getByRole('button', { name: 'Full image' }).isVisible())
    assert(await page.getByRole('button', { name: 'Rotate image by 180 degrees' }).isVisible())
    assert(await page.getByRole('button', { name: 'Straighten' }).isVisible())
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${reportDir}/ux/expanded-${width}.png`, fullPage: true })
    await thorough.uncheck()
    await engine.selectOption('auto')
    await imageSummary.click()
    await advancedSummary.click()
    if (width === 1440) {
      await search.click()
      await page.waitForFunction(
        () => document.activeElement === document.querySelector('.results-title h2'),
      )
      await page.locator('.results-section[data-status="complete"]').waitFor({ timeout: 300000 })
      assert(
        (await page.locator('.result-heading h3').allTextContents()).includes('Playfair Display'),
      )
      assert.equal(await page.locator('.result-skeleton').count(), 0)
      const firstResult = await page.locator('.result-card').first().boundingBox()
      assert(
        firstResult && firstResult.y >= 0 && firstResult.y + firstResult.height <= 900,
        'Completed results should be visible without another scroll',
      )
      await page.screenshot({ path: `${reportDir}/ux/results.png`, fullPage: true })
      await page.getByRole('button', { name: 'Edit selection' }).click()
      await page.waitForFunction(
        () => document.activeElement?.textContent === 'Select one line of text',
      )
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  await writeFile(`${reportDir}/ux/metrics.json`, JSON.stringify(metrics, null, 2))
  console.log(
    'UX hierarchy, keyboard disclosures, preserved controls, reset, results navigation and responsive checks passed',
    JSON.stringify(metrics),
  )
} finally {
  await browser.close()
}
