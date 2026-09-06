import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
await mkdir('docs/benchmarks/screenshots', { recursive: true })
const browserName = process.env.BROWSER || 'chrome'
const browser =
  browserName === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage(),
  errors: string[] = [],
  failures: string[] = [],
  mutations: string[] = []
page.on('pageerror', (e) => {
  errors.push(e.message)
  console.log('PAGEERROR', e.message)
})
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 350))
})
page.on('requestfailed', (r) => {
  failures.push(r.url())
  console.log('REQUESTFAIL', r.url().slice(0, 160), r.failure()?.errorText)
})
page.on('request', (r) => {
  if (!['GET', 'HEAD'].includes(r.method())) mutations.push(`${r.method()} ${r.url()}`)
})
await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
await page.screenshot({
  path: `docs/benchmarks/screenshots/${browserName}-desktop-empty.png`,
  fullPage: true,
})
const results = []
for (const [label, expected] of [
  ['Obrót i kolor', 'Montserrat'],
  ['Szeryfy i odstępy', 'Playfair Display'],
  ['Pismo odręczne', 'Lobster'],
]) {
  if (results.length)
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: new RegExp(label!) }).click()
  await page.getByRole('button', { name: 'Znajdź pasujące fonty' }).waitFor()
  const started = Date.now()
  await page.getByRole('button', { name: 'Znajdź pasujące fonty' }).click()
  await page.waitForFunction(
    () => !!document.querySelector('.comparison-count') || !!document.querySelector('[role=alert]'),
    {},
    { timeout: 300000 },
  )
  const error = await page.locator('[role=alert]').allTextContents()
  if (error.length) {
    console.log('SEARCH ERROR', error)
    throw new Error(error.join(' '))
  }
  const names = await page.locator('.result-heading h3').allTextContents()
  const percentages = await page.locator('.probability').allTextContents()
  const duration = (Date.now() - started) / 1000
  results.push({ label, expected, names, percentages, seconds: duration })
  console.log('RESULT', JSON.stringify(results.at(-1)))
  await page.screenshot({
    path: `docs/benchmarks/screenshots/${browserName}-${expected!.replaceAll(' ', '-')}.png`,
    fullPage: true,
  })
  assert(names.includes(expected!), `Missing ${expected}`)
  assert(names.length >= 3, 'Must show several options')
}
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({
  path: `docs/benchmarks/screenshots/${browserName}-mobile.png`,
  fullPage: true,
})
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  'Horizontal mobile overflow',
)
await writeFile(
  `docs/benchmarks/browser-${browserName}.json`,
  JSON.stringify({ browser: browserName, results, errors, failures, mutations }, null, 2),
)
assert.equal(errors.length, 0, 'Browser runtime errors')
assert.equal(mutations.length, 0, 'Runtime must only fetch static resources')
await browser.close()
