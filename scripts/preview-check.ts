import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const reportDir = `${process.env.REPORT_DIR || '.cache/preview-reports'}/preview`
await mkdir(reportDir, { recursive: true })
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/')
  await page.waitForFunction(() =>
    document.querySelector('.catalog-note')?.textContent?.includes('families'),
  )
  await page.getByRole('button', { name: /Serifs and spacing/ }).click()
  await page.getByRole('button', { name: 'Find matching fonts' }).click()
  await page.locator('.results-section[data-status="complete"]').waitFor({ timeout: 300000 })
  const inputs = page.locator('.specimen-input')
  const first = inputs.first()
  const reset = page.getByRole('button', { name: 'Reset preview text in all cards' })
  await page.waitForFunction(() => !document.querySelector('.font-pending'))
  const count = await inputs.count()
  assert(count > 1)
  const ranking = await page.locator('.result-heading').allTextContents()
  assert.equal(await reset.count(), 0)
  await first.fill('My own sample')
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.specimen-input')].every(
      (el) => (el as HTMLTextAreaElement).value === 'My own sample',
    ),
  )
  assert.equal(await reset.count(), count)
  // Editing within the existing subset must keep the font and caret stable.
  await first.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(3, 3))
  await first.pressSequentially('new ')
  assert.equal(await first.inputValue(), 'My new own sample')
  assert.equal(await first.evaluate((el) => (el as HTMLTextAreaElement).selectionStart), 7)
  assert.equal(await page.locator('.font-pending').count(), 0)
  assert.deepEqual(await page.locator('.result-heading').allTextContents(), ranking)
  assert.equal(await page.locator('#transcription').inputValue(), 'Hamburge Fonts')
  assert.equal(await page.locator('.results-grid.stale').count(), 0)
  assert.equal(await page.locator('.progress-panel').count(), 0)
  // Additional subsets can load without replacing the editor or losing its text.
  await first.fill('Zażółć gęślą jaźń')
  await page.waitForFunction(() => !document.querySelector('.font-pending'), undefined, {
    timeout: 60000,
  })
  assert.equal(await first.inputValue(), 'Zażółć gęślą jaźń')
  assert(await first.evaluate((el) => document.activeElement === el))
  await reset.nth(1).click()
  assert.equal(await reset.count(), 0)
  assert(
    (await inputs.evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))).every(
      (text) => text === 'Hamburge Fonts',
    ),
  )
  await first.fill('')
  assert.equal(await reset.count(), count, 'Empty preview remains resettable')
  await reset.first().click()
  await page.setViewportSize({ width: 390, height: 844 })
  await first.fill('A longer sample\nwith a second line')
  await page.waitForFunction(() => {
    const input = document.querySelector('.specimen-input') as HTMLTextAreaElement
    return input.scrollHeight <= input.clientHeight + 1
  })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await first.scrollIntoViewIfNeeded()
  const inputBox = await first.boundingBox(),
    resetBox = await reset.first().boundingBox()
  assert(
    inputBox && resetBox && resetBox.x >= inputBox.x + inputBox.width,
    'Reset sits beside the text',
  )
  await page.screenshot({ path: `${reportDir}/mobile.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await first.fill('Free to explore')
  await first.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${reportDir}/desktop.png` })
  // A new search gets its own original preview; no edited text leaks into matching.
  await page.getByRole('button', { name: 'Edit selection' }).click()
  await page.getByRole('button', { name: 'Find matching fonts' }).click()
  await page.locator('.specimen-input').first().waitFor({ timeout: 300000 })
  assert.equal(await page.locator('.specimen-input').first().inputValue(), 'Hamburge Fonts')
  assert.equal(await reset.count(), 0)
  const stop = page.getByRole('button', { name: 'Stop search' })
  if (await stop.count()) await stop.click()
  assert.deepEqual(errors, [])
  console.log(
    'Shared editable previews, per-card reset, caret, additional subsets, empty and multiline text, mobile layout and new-search reset passed',
  )
} finally {
  await browser.close()
}
