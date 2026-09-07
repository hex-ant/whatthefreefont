import { readCatalogAsset } from './catalog-assets'
import { chromium } from 'playwright'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { coversText } from '../app/lib/font-sources'
import type { Catalog, FontCoverage } from '../app/lib/types'
const catalog: Catalog = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8'))
const coverage: FontCoverage = JSON.parse(
  (await readCatalogAsset('public/catalog', catalog.coverageFile)).toString(),
)
const asset = (await readdir('.output/public/_nuxt')).find(
  (f) => f.startsWith('matcher.worker-') && f.endsWith('.js'),
)!
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  page = await browser.newPage()
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })
await mkdir('.cache/heldout', { recursive: true })
const names = [
  'Abril Fatface',
  'Alegreya',
  'Archivo',
  'Barlow Condensed',
  'Cormorant Garamond',
  'DM Serif Display',
  'Figtree',
  'Fraunces',
  'Josefin Sans',
  'Libre Baskerville',
  'Manrope',
  'Righteous',
  'Rubik',
  'Sora',
  'Space Mono',
  'Work Sans',
  'Caveat',
  'Satisfy',
  'Great Vibes',
  'Sacramento',
  'Cinzel',
  'Unbounded',
  'Roboto Mono',
  'Noto Sans',
  'League Spartan',
  'Urbanist',
  'Bitter',
  'Crimson Pro',
  'Quicksand',
  'Ubuntu',
  'Zilla Slab',
  'Vollkorn',
]
const conditions = [
  { size: 64, angle: 0, tracking: 0, fg: '#181818', bg: '#ffffff' },
  { size: 40, angle: 27, tracking: 4, fg: '#ffcb00', bg: '#3c248a' },
  { size: 80, angle: -68, tracking: -1.4, fg: '#eee', bg: '#161c2d' },
  { size: 26, angle: 0, tracking: 1, fg: '#172a55', bg: '#f6e9cc' },
  { size: 56, angle: 157, tracking: 3, fg: '#b82968', bg: '#fff' },
  { size: 48, angle: 90, tracking: 0, fg: '#202020', bg: '#fff', jpeg: true },
]
const texts = [
  'Sztuka Typografii',
  'Bright ideas 2026',
  'Creative Studio',
  'Zażółć gęślą jaźń',
  'Design matters',
  'Future / Type',
]
const results = []
for (let i = 0; i < names.length; i++) {
  if (process.env.HELDOUT_ONLY && !process.env.HELDOUT_ONLY.split(',').includes(names[i]!)) continue
  const family = names[i]!,
    all = catalog.variants.filter((v) => v.family === family),
    variants = all.filter((v) => v.style === (i % 7 === 0 ? 'italic' : 'normal')),
    v = (variants.length ? variants : all).reduce((a, b) =>
      Math.abs(a.weight - (i % 3 === 0 ? 700 : 400)) <
      Math.abs(b.weight - (i % 3 === 0 ? 700 : 400))
        ? a
        : b,
    )
  const condition = conditions[i % conditions.length]!,
    text = texts[i % texts.length]!
  assert(
    coversText(coverage.sets[coverage.fonts[v.id]!]!, text),
    `${family} must cover every fixture character without font fallback`,
  )
  const start = Date.now()
  const out = await page.evaluate(
    async ({ v, condition, text, asset }) => {
      const font = new FontFace('heldout', `url("${v.url}")`, {
        weight: String(v.weight),
        style: v.style,
      })
      await font.load()
      document.fonts.add(font)
      const s = condition.size,
        initial = document.createElement('canvas'),
        m = initial.getContext('2d')!
      m.font = `${v.style} ${v.weight} ${s}px heldout`
      const width = Math.ceil(
          m.measureText(text).width + Math.max(0, condition.tracking) * text.length + s * 2,
        ),
        height = Math.ceil(s * 3)
      const raw = document.createElement('canvas')
      raw.width = width
      raw.height = height
      const c = raw.getContext('2d')!
      c.fillStyle = condition.bg
      c.fillRect(0, 0, width, height)
      c.font = m.font
      c.fillStyle = condition.fg
      c.letterSpacing = `${condition.tracking}px`
      c.fillText(text, s, s * 1.8)
      const r = (condition.angle * Math.PI) / 180,
        canvas = document.createElement('canvas')
      canvas.width = Math.ceil(Math.abs(width * Math.cos(r)) + Math.abs(height * Math.sin(r)))
      canvas.height = Math.ceil(Math.abs(width * Math.sin(r)) + Math.abs(height * Math.cos(r)))
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = condition.bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(r)
      ctx.drawImage(raw, -width / 2, -height / 2)
      if (condition.jpeg) {
        const im = new Image()
        im.src = canvas.toDataURL('image/jpeg', 0.6)
        await im.decode()
        ctx.resetTransform()
        ctx.drawImage(im, 0, 0)
      }
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const png = canvas.toDataURL()
      const result = await new Promise<any>((resolve, reject) => {
        const worker = new Worker(`/_nuxt/${asset}`, { type: 'module' })
        const timer = setTimeout(() => {
          worker.terminate()
          reject(new Error('timeout'))
        }, 180000)
        worker.onmessage = ({ data }) => {
          if (data.type === 'result' || data.type === 'error') {
            clearTimeout(timer)
            worker.terminate()
            data.type === 'error' ? reject(new Error(data.data)) : resolve(data.data)
          }
        }
        worker.onerror = (e) => {
          clearTimeout(timer)
          worker.terminate()
          reject(new Error(e.message))
        }
        worker.postMessage(
          {
            rgba,
            width: canvas.width,
            height: canvas.height,
            text,
            base: location.origin + '/',
            autoRotate: true,
            manualAngle: 0,
            mode: 'auto',
            threshold: 0,
            thorough: false,
          },
          [rgba.buffer],
        )
      })
      document.fonts.delete(font)
      return { result, png }
    },
    { v, condition, text, asset },
  )
  const rank = out.result.results.findIndex((r: any) => r.font.family === family) + 1
  const row = {
    family,
    weight: v.weight,
    style: v.style,
    text,
    condition,
    rank: rank || null,
    seconds: (Date.now() - start) / 1000,
    compared: out.result.compared,
    failed: out.result.failed,
    top: out.result.results.map((r: any) => ({
      family: r.font.family,
      weight: r.font.weight,
      score: r.score,
      probability: r.probability,
    })),
  }
  results.push(row)
  console.log(JSON.stringify(row))
  await writeFile(
    `.cache/heldout/${i}-${v.slug}.png`,
    Buffer.from(out.png.split(',')[1]!, 'base64'),
  )
  await writeFile(
    process.env.REPORT_FILE || 'docs/benchmarks/heldout.json',
    JSON.stringify(
      {
        description:
          'Extended synthetic regression corpus: families and text differ from the initial PoC; subsequently used for tuning. Browser Canvas against the full catalog. Correct transcription supplied; OCR evaluated separately.',
        cases: results.length,
        top1: results.filter((r) => r.rank === 1).length / results.length,
        top3: results.filter((r) => r.rank && r.rank <= 3).length / results.length,
        top8: results.filter((r) => r.rank).length / results.length,
        results,
      },
      null,
      2,
    ),
  )
}
await browser.close()
assert(
  results.every((r) => r.rank && r.rank <= 8),
  'A fixture font is missing from the first eight results; inspect the saved report',
)
