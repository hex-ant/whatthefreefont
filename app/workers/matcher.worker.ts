/// <reference lib="webworker" />
import {
  descriptor,
  descriptorDistance,
  elasticDistance,
  estimateAngle,
  fromRGBA,
  GLYPH_BYTES,
  rotate,
  samplePalette,
  segmentGlyphs,
  trim,
} from '../lib/image'
import { probabilities, queryGlyphs, rankIndex } from '../lib/ranking'
import { readCatalogAsset } from '../lib/catalog-assets'
import { coversText, fontSources } from '../lib/font-sources'
import type { Catalog, FontCoverage, FontVariant, Mask, MatchResult } from '../lib/types'

declare const self: DedicatedWorkerGlobalScope & { fonts: FontFaceSet }
const cache = new Map<string, Uint8Array>(),
  faces = new Map<string, FontFace>()
let catalog: Catalog
let coverage: FontCoverage
let palette = { foreground: 'rgb(0,0,0)', background: 'rgb(255,255,255)' }
const send = (type: string, data: unknown) => self.postMessage({ type, data })
const progress = (stage: string, done: number, total: number) =>
  send('progress', { stage, done, total })
async function loadFont(v: FontVariant, text: string) {
  async function load(url: string) {
    const key = `${v.id}:${url}`
    if (faces.has(key)) return
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`${v.family}: HTTP ${response.status}`)
    const font = new FontFace(`match${v.id}`, await response.arrayBuffer(), {
      weight: String(v.weight),
      style: v.style,
    })
    await font.load()
    self.fonts.add(font)
    faces.set(key, font)
  }
  const sources = fontSources(v, text)
  try {
    for (const url of sources) await load(url)
  } catch (error) {
    if (sources.length === 1 && sources[0] === v.url) throw error
    await load(v.url)
  }
  return `match${v.id}`
}
function render(v: FontVariant, text: string, spaced = false, size = 64): Mask {
  let canvas = new OffscreenCanvas(1, 1),
    ctx = canvas.getContext('2d')!
  ctx.font = `${v.style} ${v.weight} ${size}px "match${v.id}"`
  const metrics = ctx.measureText(text),
    padding = Math.ceil(size * 1.25),
    spacing = size / 8
  canvas = new OffscreenCanvas(
    Math.ceil(
      Math.max(metrics.width, metrics.actualBoundingBoxRight + metrics.actualBoundingBoxLeft) +
        padding * 2 +
        text.length * (spaced ? spacing : 0),
    ),
    Math.ceil(size * 3.5),
  )
  ctx = canvas.getContext('2d')!
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = `${v.style} ${v.weight} ${size}px "match${v.id}"`
  ctx.fillStyle = palette.foreground
  if (spaced) {
    let x = padding
    for (const char of text) {
      ctx.fillText(char, x, size * 2)
      x += ctx.measureText(char).width + spacing
    }
  } else ctx.fillText(text, padding, size * 2)
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  return trim(fromRGBA(rgba, canvas.width, canvas.height))
}
async function search(input: {
  rgba: Uint8ClampedArray
  width: number
  height: number
  text: string
  base: string
  autoRotate: boolean
  manualAngle: number
  mode: 'auto' | 'dark' | 'light'
  threshold: number
  thorough: boolean
}) {
  const text = input.text.normalize('NFC').trim().replace(/\s+/g, ' ')
  palette = samplePalette(input.rgba, input.width, input.height)
  if (!text || [...text].length > 80)
    throw new Error('Wpisz od 1 do 80 znaków z jednej linii tekstu.')
  if (!catalog) {
    progress('Wczytywanie katalogu', 0, 1)
    const r = await fetch(`${input.base}catalog/catalog.json`, {
      cache: 'no-cache',
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) throw new Error('Nie udało się pobrać katalogu fontów.')
    catalog = await r.json()
    if (
      catalog.version !== 2 ||
      catalog.indexWidth !== 16 ||
      catalog.indexHeight !== 24 ||
      !catalog.variants.every((v, i) => v.id === i)
    ) {
      throw new Error('Katalog ma nieobsługiwaną wersję. Odśwież stronę lub przebuduj zasoby.')
    }
  }
  if (!coverage) {
    const bytes = await readCatalogAsset(input.base, catalog.coverageFile)
    const data = JSON.parse(new TextDecoder().decode(bytes)) as FontCoverage
    if (
      data.version !== 1 ||
      data.catalogHash !== catalog.coverageHash ||
      data.fonts.length !== catalog.variants.length ||
      !data.fonts.every((i) => Array.isArray(data.sets[i]))
    )
      throw new Error('Mapa znaków nie pasuje do katalogu. Odśwież stronę lub przebuduj zasoby.')
    coverage = data
  }
  const coveredSets = coverage.sets.map((ranges) => coversText(ranges, text))
  const eligible = new Set(
    catalog.variants.filter((v) => coveredSets[coverage.fonts[v.id]!]).map((v) => v.id),
  )
  if (!eligible.size)
    throw new Error('Katalog nie zawiera fontu obsługującego wszystkie wpisane znaki.')
  let mask = trim(fromRGBA(input.rgba, input.width, input.height, input.mode, input.threshold))
  if (
    mask.width < 3 ||
    mask.height < 3 ||
    mask.data.reduce((s, v) => s + (v > 128 ? 1 : 0), 0) < 12
  )
    throw new Error('W zaznaczeniu nie widać tekstu. Popraw ramkę lub kontrast.')
  if (input.manualAngle) mask = rotate(mask, input.manualAngle)
  const angle = input.autoRotate ? estimateAngle(mask) : 0
  if (Math.abs(angle) > 0.05) mask = rotate(mask, -angle)
  send('normalized', { mask, angle })
  const glyphs = queryGlyphs(mask, text).filter((g) => catalog.glyphs.includes(g.char))
  let loaded = 0
  await Promise.all(
    glyphs.map(async (g) => {
      if (!cache.has(g.char)) {
        cache.set(g.char, await readCatalogAsset(input.base, catalog.glyphFiles[g.char]!))
        if (cache.get(g.char)!.length !== catalog.variants.length * GLYPH_BYTES) {
          cache.delete(g.char)
          throw new Error(
            'Indeks znaków nie pasuje do katalogu. Odśwież stronę i spróbuj ponownie.',
          )
        }
      }
      progress('Wczytywanie kształtów znaków', ++loaded, glyphs.length)
    }),
  )
  const ranked = rankIndex(mask, text, catalog, cache).filter((r) => eligible.has(r.id)),
    byId = new Map(ranked.map((r) => [r.id, r]))
  if (!ranked.length) throw new Error('Katalog nie zawiera fontów obsługujących ten alfabet.')
  const shortlist = new Set<number>(),
    families = new Set<string>()
  const target = input.thorough ? 200 : 90
  for (const r of ranked) {
    if (families.size >= target) break
    const v = catalog.variants[r.id]!
    if (!families.has(v.family)) {
      families.add(v.family)
      shortlist.add(v.id)
    }
  }
  // More than one weight/style per shortlisted family avoids brittle early decisions.
  const counts = new Map<string, number>()
  for (const r of ranked) {
    const v = catalog.variants[r.id]!
    if (families.has(v.family) && (counts.get(v.family) || 0) < 2) {
      shortlist.add(v.id)
      counts.set(v.family, (counts.get(v.family) || 0) + 1)
    }
  }
  const segmentCount = segmentGlyphs(mask).length
  const touching = segmentCount < [...text.replace(/\s/g, '')].length
  const fallbackIds = new Set<number>()
  if (touching || !glyphs.length || ranked[0]!.score > 0.2) {
    const handwriting = new Map<string, FontVariant>()
    for (const v of catalog.variants)
      if (
        eligible.has(v.id) &&
        (v.category === 'handwriting' || v.category === 'display') &&
        v.style === 'normal'
      ) {
        const old = handwriting.get(v.family)
        if (!old || Math.abs(v.weight - 400) < Math.abs(old.weight - 400))
          handwriting.set(v.family, v)
      }
    for (const v of handwriting.values()) fallbackIds.add(v.id)
  }
  if (glyphs.length < Math.min(2, [...text.replace(/\s/g, '')].length)) {
    // Outside the precomputed Latin alphabet, compare every family with the relevant script.
    for (const v of catalog.variants) if (eligible.has(v.id)) shortlist.add(v.id)
  }
  const reverse = rotate(mask, 180),
    results: MatchResult[] = [],
    failed: string[] = []
  const count = [...text.replace(/\s/g, '')].length
  const queryParts = [segmentGlyphs(mask), segmentGlyphs(reverse)]
  const queryDescriptors = queryParts.map((parts) =>
    parts.length === count ? parts.map(descriptor) : null,
  )
  function scoreAgainst(query: Mask, target: Mask, flipped: boolean) {
    const elastic = elasticDistance(query, target)
    const descriptors = queryDescriptors[flipped ? 1 : 0]
    if (!descriptors) return elastic
    const parts = segmentGlyphs(target)
    if (parts.length !== count) return elastic
    const glyph =
      parts.reduce((s, p, i) => s + descriptorDistance(descriptors[i]!, descriptor(p)), 0) / count
    return elastic * 0.72 + glyph * 0.28 * 0.4
  }
  function signature(id: number): string | undefined {
    const chars = [...new Set(text.replace(/\s/g, ''))]
    if (chars.some((c) => !cache.has(c))) return
    let hash = 2166136261,
      hash2 = 5381
    for (const c of chars) {
      const data = cache.get(c)!,
        offset = id * GLYPH_BYTES
      if (!data[offset + GLYPH_BYTES - 1] && !data[offset + GLYPH_BYTES - 2]) return
      for (let i = 0; i < GLYPH_BYTES; i++) {
        hash = Math.imul(hash ^ data[offset + i]!, 16777619)
        hash2 = Math.imul(hash2, 33) ^ data[offset + i]!
      }
    }
    return `${hash >>> 0}:${hash2 >>> 0}`
  }
  let completed = 0
  async function compare(ids: number[], stage: string) {
    let next = 0
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < ids.length) {
          const id = ids[next++]!,
            v = catalog.variants[id]!
          try {
            await loadFont(v, text)
            const query = byId.get(id)?.flipped ? reverse : mask
            const normal = render(v, text),
              spaced = render(v, text, true)
            let flipped = !!byId.get(id)?.flipped
            let score = Math.min(
              scoreAgainst(query, normal, flipped),
              scoreAgainst(query, spaced, flipped),
            )
            if (!glyphs.length || touching || (byId.get(id)?.score || 1) > 0.25) {
              const other = byId.get(id)?.flipped ? mask : reverse
              const alternative = Math.min(
                scoreAgainst(other, normal, !flipped),
                scoreAgainst(other, spaced, !flipped),
              )
              if (alternative < score) {
                score = alternative
                flipped = !flipped
              }
            }
            results.push({
              font: v,
              score,
              probability: 0,
              source: 'refined',
              signature: signature(v.id),
              flipped,
            })
          } catch (e) {
            failed.push(`${v.family}: ${String(e)}`)
          }
          progress(stage, ++completed, ids.length)
          if (completed % 20 === 0) send('partial', probabilities(results, text.length))
        }
      }),
    )
  }
  await compare([...shortlist], 'Porównywanie fontów')
  const severelyConnected = segmentCount < count * 0.72
  if (
    fallbackIds.size &&
    (severelyConnected || !results.length || Math.min(...results.map((r) => r.score)) > 0.065)
  ) {
    const expanded = [...fallbackIds].filter((id) => !shortlist.has(id))
    for (const id of expanded) shortlist.add(id)
    completed = 0
    await compare(expanded, 'Sprawdzanie krojów pisankowych i ozdobnych')
  }
  const best = probabilities(results, text.length)
    .slice(0, input.thorough ? 8 : 5)
    .map((r) => r.font.family)
  const extra = catalog.variants
    .filter((v) => eligible.has(v.id) && best.includes(v.family) && !shortlist.has(v.id))
    .map((v) => v.id)
  completed = 0
  if (extra.length) await compare(extra, 'Dopasowywanie grubości i kursywy')
  // Hinting and antialiasing change with physical pixel size. Re-render strong
  // candidates near the source size instead of trusting one canonical size.
  const refineFamilies = new Set(probabilities(results, text.length).map((r) => r.font.family))
  for (const r of ranked.slice(0, 8)) refineFamilies.add(catalog.variants[r.id]!.family)
  const refinements = results.filter((r) => refineFamilies.has(r.font.family))
  let refined = 0
  for (const result of refinements) {
    const v = result.font,
      flip = !!byId.get(v.id)?.flipped,
      query = flip ? reverse : mask
    const reference = render(v, text),
      estimate = Math.max(16, Math.min(144, (64 * mask.height) / reference.height))
    for (const size of new Set([
      Math.round(estimate * 0.97),
      Math.round(estimate),
      Math.round(estimate * 1.03),
    ])) {
      if (Math.abs(size - 64) < 1) continue
      for (const separated of [false, true]) {
        const target = render(v, text, separated, size)
        const score = scoreAgainst(query, target, flip)
        if (score < result.score) {
          result.score = score
          result.flipped = flip
        }
        if (touching || (byId.get(v.id)?.score || 1) > 0.25) {
          const alternative = scoreAgainst(flip ? mask : reverse, target, !flip)
          if (alternative < result.score) {
            result.score = alternative
            result.flipped = !flip
          }
        }
      }
    }
    progress('Sprawdzanie szczegółów liter', ++refined, refinements.length)
  }
  if (!results.length)
    throw new Error(
      'Nie udało się pobrać plików fontów. Sprawdź połączenie z internetem i spróbuj ponownie.',
    )
  const bestOrientation = results.reduce((a, b) => (a.score < b.score ? a : b)).flipped
  send('normalized', { mask: bestOrientation ? reverse : mask, angle })
  send('result', {
    results: probabilities(results, text.length),
    compared: results.length,
    failed: failed.length,
    angle,
    indexed: glyphs.length,
    totalFamilies: catalog.families,
    lowQuality: results.reduce((m, r) => Math.min(m, r.score), 1) > 0.22,
  })
}
self.onmessage = async ({ data }) => {
  try {
    await search(data)
  } catch (e) {
    send('error', e instanceof Error ? e.message : String(e))
  }
}
