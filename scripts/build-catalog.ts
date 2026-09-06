import { APIv2 } from 'google-font-metadata'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { create as parseFont } from 'fontkit'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { descriptor, GLYPH_BYTES } from '../app/lib/image'
import type { Catalog, FontVariant } from '../app/lib/types'
import { buildCoverage } from './build-coverage'

// This is a build-time operation. No metadata API or font-generation service is used by the app.
const glyphs =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ĄĆĘŁŃÓŚŹŻąćęłńóśźżÄÖÜäöüßéèêàáâçñôúůýčřšžďťěîïåøæœÉÈÇÀÁÑÖÜÅØÆŒ!?&@#%.,:;()-+/'
await mkdir('.cache/fonts', { recursive: true })
await mkdir('public/catalog/glyphs', { recursive: true })
const variants: FontVariant[] = []
for (const f of Object.values(APIv2)) {
  for (const weight of f.weights)
    for (const style of f.styles) {
      const subset = f.variants[weight]?.[style]
      if (!subset) continue
      const url = (subset[f.defSubset] || Object.values(subset)[0])?.url?.truetype
      if (!url || !url.startsWith('https://fonts.gstatic.com/')) continue
      variants.push({
        id: variants.length,
        family: f.family,
        slug: f.id,
        category: f.category,
        weight,
        style,
        url,
        latin: subset.latin?.url.woff2,
        latinExt: subset['latin-ext']?.url.woff2,
        subsets: f.subsets,
      })
    }
}
const limit = Number(process.env.CATALOG_LIMIT || 0)
const chosen = limit
  ? variants
      .filter((v) =>
        [
          'Roboto',
          'Open Sans',
          'Lato',
          'Montserrat',
          'Oswald',
          'Playfair Display',
          'Merriweather',
          'Lora',
          'Poppins',
          'Raleway',
          'Bebas Neue',
          'Lobster',
          'Pacifico',
          'Dancing Script',
          'Source Sans 3',
          'Inter',
          'Nunito',
          'Fira Sans',
          'Roboto Slab',
          'PT Serif',
          'Anton',
          'Barlow',
          'Outfit',
          'DM Sans',
        ].includes(v.family),
      )
      .slice(0, limit)
  : variants
chosen.forEach((v, i) => (v.id = i))
const chars = [...new Set(glyphs)]
const buffers = new Map(chars.map((char) => [char, new Uint8Array(chosen.length * GLYPH_BYTES)]))
const repairIds = process.env.CATALOG_REPAIR?.split(',').map(Number)
if (repairIds)
  for (const char of chars)
    buffers.set(
      char,
      new Uint8Array(
        gunzipSync(
          await readFile(`public/catalog/glyphs/${char.codePointAt(0)!.toString(16)}.bin.gz`),
        ),
      ),
    )
const jobs = repairIds ? chosen.filter((v) => repairIds.includes(v.id)) : chosen
const failures: string[] = []
if (repairIds) {
  const previous: Catalog = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8'))
  if (
    previous.variants.length !== chosen.length ||
    previous.variants.some((v, i) => v.url !== chosen[i]!.url)
  )
    throw new Error('Repair requires the original metadata version. Run a full rebuild.')
  failures.push(...previous.failures.filter((f) => !repairIds.includes(Number(f.split(' ')[0]))))
}
let next = 0,
  done = 0
const start = Date.now()
async function processVariant(v: FontVariant) {
  const key = createHash('sha256').update(v.url).digest('hex').slice(0, 24)
  const path = `.cache/fonts/${key}.ttf`
  let bytes: Buffer
  try {
    bytes = await readFile(path)
    if (bytes.length < 100) throw new Error('Incomplete cache file')
  } catch {
    let last: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(v.url, { signal: AbortSignal.timeout(90000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        bytes = Buffer.from(await r.arrayBuffer())
        if (bytes.length < 100) throw new Error('Empty font response')
        await writeFile(path, bytes)
        break
      } catch (e) {
        last = e
      }
    }
    if (!bytes!) throw last
  }
  const font = parseFont(bytes!) as import('fontkit').Font
  const alias = `idx${v.id}`
  const registered = GlobalFonts.register(bytes!, alias)
  if (!registered) throw new Error('Cannot register font')
  const canvas = createCanvas(180, 180),
    ctx = canvas.getContext('2d')
  ctx.font = `${v.style} ${v.weight} 64px "${alias}"`
  ctx.fillStyle = '#fff'
  for (const char of chars) {
    if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) continue
    ctx.clearRect(0, 0, 180, 180)
    ctx.fillText(char, 32, 110)
    const rgba = ctx.getImageData(0, 0, 180, 180).data
    const data = new Uint8Array(180 * 180)
    for (let p = 0; p < data.length; p++) data[p] = rgba[p * 4 + 3]!
    buffers.get(char)!.set(descriptor({ width: 180, height: 180, data }), v.id * GLYPH_BYTES)
  }
  // Keep registrations alive until process exit: removing a Skia typeface while
  // its canvas is still awaiting GC can invalidate native reference counts.
}
await Promise.all(
  Array.from({ length: 12 }, async () => {
    while (next < jobs.length) {
      const v = jobs[next++]!
      try {
        await processVariant(v)
      } catch (e) {
        failures.push(`${v.id} ${v.family} ${v.weight} ${v.style}: ${String(e)}`)
        console.error(failures.at(-1))
      }
      done++
      if (done % 100 === 0)
        console.log(
          `${done}/${chosen.length} variants; ${Math.round((Date.now() - start) / 1000)}s; ${failures.length} failures`,
        )
    }
  }),
)
for (const [char, data] of buffers)
  await writeFile(
    `public/catalog/glyphs/${char.codePointAt(0)!.toString(16)}.bin.gz`,
    gzipSync(data, { level: 9 }),
  )
const catalog: Catalog = {
  version: 1,
  generated: new Date().toISOString(),
  source: 'google-font-metadata@6.0.8 / Google Fonts static TTF files',
  families: new Set(chosen.map((v) => v.family)).size,
  glyphs: chars.join(''),
  variants: chosen,
  failures,
  indexWidth: 16,
  indexHeight: 24,
}
await writeFile('public/catalog/catalog.json', JSON.stringify(catalog))
await writeFile(
  'public/catalog/build-report.json',
  JSON.stringify(
    {
      families: catalog.families,
      variants: chosen.length,
      glyphs: chars.length,
      seconds: (Date.now() - start) / 1000,
      failures,
    },
    null,
    2,
  ),
)
console.log(
  `Complete: ${catalog.families} families, ${chosen.length} variants, ${chars.length} glyph shards, ${failures.length} errors.`,
)
if (failures.length) process.exitCode = 1
else await buildCoverage(catalog)
