import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { APIv2 } from 'google-font-metadata'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  descriptor,
  descriptorDistance,
  elasticDistance,
  estimateAngle,
  fromRGBA,
  pixelDistance,
  rotate,
  segmentGlyphs,
  trim,
  GLYPH_BYTES,
} from '../app/lib/image'
import type { Mask, FontVariant, Catalog } from '../app/lib/types'

await mkdir('.cache/fonts', { recursive: true })
await mkdir('public/examples', { recursive: true })
await mkdir('docs/benchmarks', { recursive: true })
const families = [
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
  'Inter',
  'Nunito',
  'Fira Sans',
  'Roboto Slab',
  'PT Serif',
  'Anton',
  'Barlow',
  'Outfit',
  'DM Sans',
]
const candidates: FontVariant[] = []
for (const f of Object.values(APIv2))
  if (families.includes(f.family))
    for (const weight of [
      ...new Set([
        f.weights.reduce((a, b) => (Math.abs(a - 400) < Math.abs(b - 400) ? a : b)),
        f.weights.reduce((a, b) => (Math.abs(a - 700) < Math.abs(b - 700) ? a : b)),
      ]),
    ])
      for (const style of f.styles) {
        const v = f.variants[weight]?.[style]
        const url = (v?.[f.defSubset] || Object.values(v || {})[0])?.url?.truetype
        if (url)
          candidates.push({
            id: candidates.length,
            family: f.family,
            slug: f.id,
            category: f.category,
            weight,
            style,
            url,
            subsets: f.subsets,
          })
      }
for (const v of candidates) {
  const path = `.cache/fonts/${createHash('sha256').update(v.url).digest('hex').slice(0, 24)}.ttf`
  let data: Buffer
  try {
    data = await readFile(path)
  } catch {
    const r = await fetch(v.url)
    if (!r.ok) throw new Error(v.url)
    data = Buffer.from(await r.arrayBuffer())
    await writeFile(path, data)
  }
  if (!GlobalFonts.register(data, `bench${v.id}`)) throw new Error(v.family)
}
type Options = {
  size?: number
  tracking?: number
  wordSpacing?: number
  angle?: number
  fg?: string
  bg?: string
  jpeg?: boolean
  blur?: boolean
}
function render(v: FontVariant, text: string, options: Options = {}) {
  const {
    size = 64,
    tracking = 0,
    wordSpacing = 0,
    angle = 0,
    fg = '#202020',
    bg = '#ffffff',
  } = options
  let canvas = createCanvas(1600, 240),
    ctx = canvas.getContext('2d')
  ctx.font = `${v.style} ${v.weight} ${size}px "bench${v.id}"`
  const width = Math.ceil(
    ctx.measureText(text).width +
      (text.length - 1) * tracking +
      (text.split(' ').length - 1) * wordSpacing +
      size,
  )
  canvas = createCanvas(width, Math.ceil(size * 2.8))
  ctx = canvas.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, canvas.height)
  ctx.font = `${v.style} ${v.weight} ${size}px "bench${v.id}"`
  ctx.fillStyle = fg
  if (tracking || wordSpacing) {
    let x = size / 2
    for (const c of text) {
      ctx.fillText(c, x, size * 1.65)
      x += ctx.measureText(c).width + tracking + (c === ' ' ? wordSpacing : 0)
    }
  } else ctx.fillText(text, size / 2, size * 1.65)
  if (angle) {
    const r = (angle * Math.PI) / 180,
      w = Math.ceil(Math.abs(canvas.width * Math.cos(r)) + Math.abs(canvas.height * Math.sin(r))),
      h = Math.ceil(Math.abs(canvas.width * Math.sin(r)) + Math.abs(canvas.height * Math.cos(r)))
    const out = createCanvas(w, h),
      c = out.getContext('2d')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)
    c.translate(w / 2, h / 2)
    c.rotate(r)
    c.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    canvas = out
  }
  return canvas
}
function mask(canvas: ReturnType<typeof createCanvas>): Mask {
  const c = canvas.getContext('2d')
  return trim(
    fromRGBA(c.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height),
  )
}
function glyphScore(a: Mask, b: Mask, text: string) {
  const n = [...text.replace(/\s/g, '')].length,
    aa = segmentGlyphs(a, n),
    bb = segmentGlyphs(b, n)
  if (aa.length !== n || bb.length !== n) return 1
  return (
    aa.reduce((sum, m, i) => sum + descriptorDistance(descriptor(m), descriptor(bb[i]!)), 0) / n
  )
}
const text = 'Hamburge Fonts'
const templates = candidates.map((v) => mask(render(v, text)))
const conditions: Record<string, Options> = {
  clean: {},
  colour: { fg: '#ffc83d', bg: '#3043a0' },
  rotation: { angle: 23, fg: '#ffffff', bg: '#143b31' },
  tracking: { tracking: 7, wordSpacing: 26 },
  small: { size: 25 },
  oblique: { angle: -37, tracking: 3, fg: '#dc174e', bg: '#f0e0bb' },
  upside: { angle: 137, tracking: 5 },
  jpeg: { size: 41, jpeg: true },
}
const selected = [
  'Roboto',
  'Montserrat',
  'Playfair Display',
  'Poppins',
  'Lora',
  'Oswald',
  'Lobster',
  'Pacifico',
  'Inter',
  'Bebas Neue',
  'PT Serif',
  'Dancing Script',
]
const cases = []
let count = 0
for (const family of selected) {
  const v = candidates.find((c) => c.family === family && c.style === 'normal')!
  for (const [condition, options] of Object.entries(conditions)) {
    let c = render(v, text, options)
    if (options.jpeg) {
      const im = await loadImage(c.toBuffer('image/jpeg', 60))
      c = createCanvas(im.width, im.height)
      c.getContext('2d').drawImage(im, 0, 0)
    }
    const raw = mask(c),
      angle = estimateAngle(raw),
      query = rotate(raw, -angle)
    const flipped = rotate(query, 180)
    const methods: Record<string, Array<{ family: string; score: number }>> = {
      pixels: [],
      glyphs: [],
      elastic: [],
      hybrid: [],
    }
    for (let i = 0; i < candidates.length; i++) {
      const t = templates[i]!,
        p = pixelDistance(query, t),
        g = Math.min(glyphScore(query, t, text), glyphScore(flipped, t, text)),
        e = Math.min(elasticDistance(query, t), elasticDistance(flipped, t))
      methods.pixels!.push({ family: candidates[i]!.family, score: p })
      methods.glyphs!.push({ family: candidates[i]!.family, score: g })
      methods.elastic!.push({ family: candidates[i]!.family, score: e })
      methods.hybrid!.push({ family: candidates[i]!.family, score: e * 0.65 + g * 0.35 })
    }
    const rankings = Object.fromEntries(
      Object.entries(methods).map(([method, scores]) => {
        const seen = new Set<string>()
        const sorted = scores
          .sort((a, b) => a.score - b.score)
          .filter((s) => {
            if (seen.has(s.family)) return false
            seen.add(s.family)
            return true
          })
        return [
          method,
          { rank: sorted.findIndex((s) => s.family === family) + 1, top: sorted.slice(0, 3) },
        ]
      }),
    )
    cases.push({ family, condition, expectedAngle: options.angle || 0, angle, rankings })
    if (
      ['Montserrat', 'Playfair Display', 'Lobster', 'Poppins'].includes(family) &&
      ['colour', 'oblique', 'tracking', 'clean'].includes(condition)
    )
      await writeFile(`public/examples/${v.slug}-${condition}.png`, c.toBuffer('image/png'))
    console.log(
      `${++count} ${family} ${condition}: ${Object.entries(rankings)
        .map(([k, v]) => `${k}=${v.rank}`)
        .join(' ')} angle=${angle}`,
    )
  }
}
const summary = Object.fromEntries(
  ['pixels', 'glyphs', 'elastic', 'hybrid'].map((method) => [
    method,
    {
      top1: cases.filter((c) => c.rankings[method]!.rank === 1).length / cases.length,
      top3: cases.filter((c) => c.rankings[method]!.rank <= 3).length / cases.length,
    },
  ]),
)
await writeFile(
  'docs/benchmarks/poc.json',
  JSON.stringify(
    {
      description:
        'Synthetic same-rasterizer development comparison; 23 families, all selected weights/styles. Not a real-photo accuracy claim.',
      candidateVariants: candidates.length,
      cases: cases.length,
      summary,
      results: cases,
    },
    null,
    2,
  ),
)
console.log(JSON.stringify(summary, null, 2))
