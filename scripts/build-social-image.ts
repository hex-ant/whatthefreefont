/** Rebuild the committed social card; it is served as a plain PNG, never generated at runtime. */
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { APIv2 } from 'google-font-metadata'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

await mkdir('.cache/fonts', { recursive: true })
async function font(family: string, weight: number, alias: string) {
  const f = Object.values(APIv2).find((f) => f.family === family)!
  const variants = f.variants[weight]?.normal
  const url = (variants?.latin || variants?.[f.defSubset])?.url.truetype
  if (!url) throw new Error(`Missing font: ${family} ${weight}`)
  const path = `.cache/fonts/${createHash('sha256').update(url).digest('hex').slice(0, 24)}.ttf`
  let data: Buffer
  try {
    data = await readFile(path)
  } catch {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Font download failed: ${response.status}`)
    data = Buffer.from(await response.arrayBuffer())
    await writeFile(path, data)
  }
  if (!GlobalFonts.register(data, alias)) throw new Error(`Cannot load ${family}`)
}
await font('DM Sans', 400, 'Social Sans')
await font('DM Sans', 700, 'Social Sans Bold')
await font('DM Sans', 200, 'Social Sans Light')
await font('Lobster', 400, 'Social Specimen')
// Match the app's accepted Georgia wordmark. Font files are never copied into the output.
const georgiaDir = process.env.GEORGIA_FONT_DIR || '/System/Library/Fonts/Supplemental'
for (const name of ['Georgia', 'Georgia Bold', 'Georgia Bold Italic']) {
  const path = join(georgiaDir, `${name}.ttf`)
  if (!existsSync(path) || !GlobalFonts.registerFromPath(path, name))
    throw new Error(`Install Georgia or set GEORGIA_FONT_DIR to its directory: ${path}`)
}
const canvas = createCanvas(1200, 630),
  ctx = canvas.getContext('2d')
const ink = '#f5f6f2',
  muted = '#b6beaf',
  accent = '#d3f86b'
function text(value: string, x: number, y: number, font: string, color = ink) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}
function box(x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}
ctx.fillStyle = '#141811'
ctx.fillRect(0, 0, 1200, 630)
const glow = ctx.createRadialGradient(1050, 100, 0, 1050, 100, 650)
glow.addColorStop(0, '#28351b')
glow.addColorStop(1, '#14181100')
ctx.fillStyle = glow
ctx.fillRect(0, 0, 1200, 630)
let logoX = 64
for (const [word, fontSpec, color] of [
  ['what', '700 33px "Georgia Bold"', ink],
  ['the', '200 33px "Social Sans Light"', ink],
  ['free', '33px "Social Sans"', ink],
  ['font', 'italic 700 33px "Georgia Bold Italic"', ink],
  ['.', '700 33px "Georgia Bold"', accent],
]) {
  text(word!, logoX, 94, fontSpec!, color!)
  logoX += ctx.measureText(word!).width - 1
}
text('Find the font.', 64, 238, '700 68px "Social Sans Bold"')
text('Keep it free.', 64, 315, 'italic 700 68px "Georgia Bold Italic"', accent)
text('Identify Google Fonts', 66, 378, '29px "Social Sans"', muted)
text('from a screenshot, logo or photo.', 66, 418, '25px "Social Sans"', muted)
box(64, 458, 263, 42, 21, '#25301c')
const pillLabel = 'FREE · NO SIGN-UP'
const pillFont = '700 17px "Social Sans Bold"'
ctx.font = pillFont
const pillMetrics = ctx.measureText(pillLabel)
text(
  pillLabel,
  64 + (263 - pillMetrics.width) / 2,
  458 + 42 / 2 + (pillMetrics.actualBoundingBoxAscent - pillMetrics.actualBoundingBoxDescent) / 2,
  pillFont,
  accent,
)

// A concise demonstration: selected image sample → named, downloadable Google Font.
box(696, 100, 440, 406, 26, '#1c2218', '#424c38')
text('YOUR IMAGE', 724, 138, '700 15px "Social Sans Bold"', muted)
box(726, 159, 380, 140, 12, '#eee8d6')
ctx.save()
ctx.translate(916, 229)
ctx.rotate(-0.065)
text('Good type', -139, 21, '62px "Social Specimen"', '#252b20')
ctx.strokeStyle = '#789d36'
ctx.lineWidth = 2
ctx.setLineDash([6, 5])
ctx.strokeRect(-161, -49, 322, 88)
ctx.setLineDash([])
for (const [x, y] of [
  [-161, -49],
  [161, -49],
  [-161, 39],
  [161, 39],
])
  box(x! - 4, y! - 4, 8, 8, 0, accent, '#789d36')
ctx.restore()
ctx.strokeStyle = accent
ctx.lineWidth = 3
ctx.lineCap = 'round'
ctx.lineJoin = 'round'
ctx.beginPath()
ctx.moveTo(916, 315)
ctx.lineTo(916, 340)
ctx.moveTo(907, 331)
ctx.lineTo(916, 340)
ctx.lineTo(925, 331)
ctx.stroke()
box(726, 357, 380, 120, 14, '#d3f86b')
text('MATCHING GOOGLE FONT', 746, 386, '700 13px "Social Sans Bold"', '#43552d')
text('Lobster', 746, 445, '51px "Social Specimen"', '#20291b')
ctx.strokeStyle = '#344d13'
ctx.lineWidth = 3
ctx.beginPath()
ctx.moveTo(1054, 416)
ctx.lineTo(1064, 426)
ctx.lineTo(1081, 407)
ctx.stroke()
ctx.strokeStyle = '#35402c'
ctx.lineWidth = 1
ctx.beginPath()
ctx.moveTo(64, 542)
ctx.lineTo(1136, 542)
ctx.stroke()
// Simple lock icon, in the same position as the reference's privacy assurance.
ctx.strokeStyle = accent
ctx.lineWidth = 2
ctx.beginPath()
ctx.roundRect(367, 568, 14, 12, 2)
ctx.stroke()
ctx.beginPath()
ctx.arc(374, 568, 4.5, Math.PI, 0)
ctx.stroke()
text('Your images never leave your device.', 396, 581, '21px "Social Sans"', muted)
await writeFile('public/og-image.png', canvas.toBuffer('image/png'))
// Raster fallbacks for browsers and iOS, matching the existing SVG favicon.
const icon = await loadImage(await readFile('public/favicon.svg'))
for (const [size, name] of [
  [32, 'favicon-32.png'],
  [180, 'apple-touch-icon.png'],
] as const) {
  const c = createCanvas(size, size)
  c.getContext('2d').drawImage(icon, 0, 0, size, size)
  await writeFile(`public/${name}`, c.toBuffer('image/png'))
}
console.log('Generated 1200×630 social image and PNG icons')
