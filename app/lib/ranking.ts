import { descriptor, descriptorDistance, GLYPH_BYTES, rotate, segmentGlyphs } from './image'
import type { Catalog, Mask, MatchResult } from './types'

export interface IndexedCandidate {
  id: number
  score: number
  flipped: boolean
}
export function queryGlyphs(mask: Mask, text: string) {
  const chars = [...text.normalize('NFC').replace(/\s/g, '')]
  const glyphs = segmentGlyphs(mask, chars.length)
  if (glyphs.length !== chars.length) return []
  const seen = new Set<string>()
  return chars
    .map((char, i) => ({ char, data: descriptor(glyphs[i]!) }))
    .filter(({ char }) => {
      if (seen.has(char)) return false
      seen.add(char)
      return true
    })
    .sort((a, b) => Number(/[Il1.,:;'!|]/.test(a.char)) - Number(/[Il1.,:;'!|]/.test(b.char)))
    .slice(0, 14)
}
export function rankIndex(
  mask: Mask,
  text: string,
  catalog: Catalog,
  shards: Map<string, Uint8Array>,
): IndexedCandidate[] {
  const forward = queryGlyphs(mask, text).filter((g) => shards.has(g.char))
  const reverse = queryGlyphs(rotate(mask, 180), text).filter((g) => shards.has(g.char))
  const rank: IndexedCandidate[] = []
  for (const v of catalog.variants) {
    let score = Infinity,
      flipped = false
    for (const [i, glyphs] of [forward, reverse].entries()) {
      if (!glyphs.length) continue
      const distances = glyphs
        .map((g) => descriptorDistance(g.data, shards.get(g.char)!, v.id * GLYPH_BYTES))
        .sort((a, b) => a - b)
      // Trim the worst glyph on longer strings; one bad split must not remove a family.
      const n = Math.max(1, distances.length - (distances.length > 5 ? 1 : 0))
      const d = distances.slice(0, n).reduce((a, b) => a + b, 0) / n
      if (d < score) {
        score = d
        flipped = i === 1
      }
    }
    rank.push({ id: v.id, score, flipped })
  }
  return rank.sort((a, b) => a.score - b.score)
}

/** Relative likelihoods among the displayed families, not calibrated identification confidence. */
export function probabilities(results: MatchResult[], textLength: number): MatchResult[] {
  if (!results.length) return []
  const sorted = [...results].sort((a, b) => a.score - b.score)
  const seen = new Set<string>()
  const families = sorted.filter((r) => {
    if (seen.has(r.font.family)) return false
    seen.add(r.font.family)
    return true
  })
  const groups = new Map<string, MatchResult>()
  for (const r of families) {
    const key = r.signature || r.font.family,
      group = groups.get(key)
    if (group && Math.abs(group.score - r.score) < 0.025) {
      const names = [...new Set([group.font.family, ...(group.alternatives || []), r.font.family])]
      const font = r.font.family.length < group.font.family.length ? r.font : group.font
      groups.set(key, {
        ...group,
        font,
        alternatives: names.filter((n) => n !== font.family).sort(),
      })
    } else groups.set(group ? `${key}:${r.font.family}` : key, { ...r })
  }
  const distinct = [...groups.values()].sort((a, b) => a.score - b.score).slice(0, 8)
  const temperature =
    0.018 + 0.07 / Math.sqrt(Math.max(1, textLength)) + Math.min(0.04, sorted[0]!.score * 0.12)
  const weights = distinct.map((r) => Math.exp(-(r.score - distinct[0]!.score) / temperature))
  const sum = weights.reduce((a, b) => a + b, 0)
  return distinct.map((r, i) => ({ ...r, probability: weights[i]! / sum }))
}
