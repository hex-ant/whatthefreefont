import { readCatalogAsset } from './catalog-assets'
import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { estimateAngle, fromRGBA, rotate, trim } from '../app/lib/image'
import { rankIndex, queryGlyphs } from '../app/lib/ranking'
import type { Catalog } from '../app/lib/types'
const catalog: Catalog = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8'))
const shards = new Map<string, Uint8Array>()
const text = 'Hamburge Fonts'
for (const char of new Set(text.replace(/\s/g, '')))
  shards.set(char, await readCatalogAsset('public/catalog', catalog.glyphFiles[char]!))
const results = []
for (const family of ['montserrat', 'playfair-display', 'lobster', 'poppins'])
  for (const condition of ['clean', 'colour', 'oblique', 'tracking']) {
    const im = await loadImage(`public/examples/${family}-${condition}.png`),
      c = createCanvas(im.width, im.height),
      ctx = c.getContext('2d')
    ctx.drawImage(im, 0, 0)
    const raw = trim(
        fromRGBA(ctx.getImageData(0, 0, im.width, im.height).data, im.width, im.height),
      ),
      mask = rotate(raw, -estimateAngle(raw))
    const rank = rankIndex(mask, text, catalog, shards),
      seen = new Set<string>(),
      families = rank.filter((r) => {
        const f = catalog.variants[r.id]!.slug
        if (seen.has(f)) return false
        seen.add(f)
        return true
      })
    const n = families.findIndex((r) => catalog.variants[r.id]!.slug === family) + 1
    const row = {
      family,
      condition,
      rank: n,
      score: families[n - 1]!.score,
      top: families
        .slice(0, 5)
        .map((r) => ({ family: catalog.variants[r.id]!.family, score: r.score })),
    }
    results.push(row)
    console.log(JSON.stringify(row))
  }
await writeFile(
  'docs/benchmarks/index.json',
  JSON.stringify(
    { families: catalog.families, variants: catalog.variants.length, results },
    null,
    2,
  ),
)
