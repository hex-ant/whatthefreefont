import { readCatalogAsset } from './catalog-assets'
import { readFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { fromRGBA, trim, estimateAngle, rotate, segmentGlyphs } from '../app/lib/image'
import { rankIndex } from '../app/lib/ranking'
const [path, text, family] = process.argv.slice(2),
  c = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8')),
  shards = new Map()
for (const ch of new Set(text!.replace(/\s/g, '')))
  if (c.glyphs.includes(ch))
    shards.set(ch, await readCatalogAsset('public/catalog', c.glyphFiles[ch]))
const im = await loadImage(path!),
  canvas = createCanvas(im.width, im.height),
  ctx = canvas.getContext('2d')
ctx.drawImage(im, 0, 0)
const raw = trim(fromRGBA(ctx.getImageData(0, 0, im.width, im.height).data, im.width, im.height)),
  angle = estimateAngle(raw),
  m = rotate(raw, -angle),
  r = rankIndex(m, text!, c, shards)
console.log({ angle, glyphs: segmentGlyphs(m).length, expected: text!.replace(/\s/g, '').length })
console.log(
  r
    .map((v, i) => ({
      ...v,
      rank: i + 1,
      font: c.variants[v.id].family,
      weight: c.variants[v.id].weight,
    }))
    .filter((v, i) => v.font === family || i < 10),
)
