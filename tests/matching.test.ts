import { describe, it, expect } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import {
  fromRGBA,
  trim,
  rotate,
  estimateAngle,
  automaticRotation,
  elasticDistance,
  pixelDistance,
  segmentGlyphs,
  descriptor,
  descriptorDistance,
} from '../app/lib/image'
import { probabilities } from '../app/lib/ranking'
import type { Mask, MatchResult } from '../app/lib/types'
function sample(tracking = 0, colour = false): Mask {
  const c = createCanvas(500, 100),
    ctx = c.getContext('2d')
  ctx.fillStyle = colour ? '#1937ba' : '#fff'
  ctx.fillRect(0, 0, 500, 100)
  ctx.fillStyle = colour ? '#ffc81c' : '#111'
  ctx.font = '50px sans-serif'
  let x = 20
  for (const ch of 'Hamburge') {
    ctx.fillText(ch, x, 70)
    x += ctx.measureText(ch).width + tracking
  }
  return trim(fromRGBA(ctx.getImageData(0, 0, 500, 100).data, 500, 100))
}
describe('image normalization', () => {
  it('extracts identical geometry across colours, including similar luminance', () => {
    const masks = []
    for (const [fg, bg] of [
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      [
        [255, 20, 20],
        [20, 100, 20],
      ],
      [
        [255, 255, 255],
        [10, 20, 80],
      ],
    ]) {
      const rgba = new Uint8ClampedArray(40 * 20 * 4)
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 40; x++) {
          const inside =
              x >= 5 && x < 34 && y >= 4 && y < 16 && (x < 11 || x > 26 || (y > 8 && y < 12)),
            rgb = inside ? fg! : bg!
          rgba.set([...rgb, 255], (y * 40 + x) * 4)
        }
      masks.push(trim(fromRGBA(rgba, 40, 20)))
    }
    expect(pixelDistance(masks[0]!, masks[1]!)).toBe(0)
    expect(pixelDistance(masks[0]!, masks[2]!)).toBe(0)
  })
  it('preserves an empty image as empty', () => {
    const d = new Uint8ClampedArray(40 * 20 * 4).fill(255)
    expect(fromRGBA(d, 40, 20).data.some(Boolean)).toBe(false)
  })
  it('recovers the angle across quadrants modulo 180 degrees', () => {
    for (const a of [-74, -23, 17, 66, 137]) {
      const estimate = estimateAngle(rotate(sample(), a))
      const expected = a > 90 ? a - 180 : a
      expect(Math.abs(estimate - expected)).toBeLessThan(1)
    }
  })
  it.each([-74, -23, 17, 66])('automatically straightens upright text tilted by %s°', (angle) => {
    expect(automaticRotation(rotate(sample(), angle))).toBeCloseTo(-angle, 0)
  })
  it('leaves straight text, blank images and ambiguous noise alone', () => {
    expect(automaticRotation(sample())).toBe(0)
    expect(automaticRotation(rotate(sample(), 180))).toBe(0)
    expect(automaticRotation({ width: 100, height: 100, data: new Uint8Array(10000) })).toBe(0)
    let seed = 42
    const data = Uint8Array.from({ length: 10000 }, () => {
      seed = (1664525 * seed + 1013904223) >>> 0
      return seed % 3 === 0 ? 255 : 0
    })
    expect(automaticRotation({ width: 100, height: 100, data })).toBe(0)
  })
  it('makes local spacing changes less significant than pixel matching', () => {
    const a = sample(),
      b = sample(7)
    expect(elasticDistance(a, b)).toBeLessThan(0.025)
    expect(pixelDistance(a, b)).toBeGreaterThan(elasticDistance(a, b) * 3)
  })
  it('segments separated glyphs and retains shape identity', () => {
    const a = segmentGlyphs(sample(4), 8)
    expect(a).toHaveLength(8)
    expect(descriptorDistance(descriptor(a[0]!), descriptor(a[0]!))).toBe(0)
  })
})
describe('relative probabilities', () => {
  const make = (id: number, family: string, score: number) =>
    ({ font: { id, family }, score, probability: 0, source: 'refined' }) as MatchResult
  it('deduplicates families and normalizes finite probabilities', () => {
    const p = probabilities(
      [make(0, 'A', 0.02), make(1, 'A', 0.03), make(2, 'B', 0.06), make(3, 'C', 0.12)],
      10,
    )
    expect(p).toHaveLength(3)
    expect(p.reduce((s, v) => s + v.probability, 0)).toBeCloseTo(1)
    expect(p[0]!.probability).toBeGreaterThan(p[1]!.probability)
    expect(p.every((r) => Number.isFinite(r.probability))).toBe(true)
  })
  it('keeps identical scores ambiguous and handles no results', () => {
    const p = probabilities([make(0, 'A', 0.02), make(1, 'B', 0.02)], 1)
    expect(p.map((r) => r.probability)).toEqual([0.5, 0.5])
    expect(probabilities([], 5)).toEqual([])
  })
})
