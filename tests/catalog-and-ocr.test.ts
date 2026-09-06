import { describe, it, expect } from 'vitest'
import { coversText, fontSources, supportsScript } from '../app/lib/font-sources'
import { groupLines } from '../app/lib/ocr'
import { probabilities } from '../app/lib/ranking'
import type { FontVariant, MatchResult } from '../app/lib/types'
const font = {
  id: 0,
  family: 'Test',
  url: 'https://example.test/full.ttf',
  latin: 'https://example.test/latin.woff2',
  latinExt: 'https://example.test/ext.woff2',
  subsets: ['latin', 'latin-ext'],
} as FontVariant
describe('font coverage and static resources', () => {
  it('checks actual Unicode ranges and canonical decompositions, not just script labels', () => {
    const ranges = [32, 126, 0x301, 0x301, 0x410, 0x44f]
    expect(coversText(ranges, 'Hello Привет')).toBe(true)
    expect(coversText(ranges, 'Café')).toBe(true)
    expect(coversText(ranges, 'Zażółć')).toBe(false)
    expect(coversText(ranges, 'Hello\u200d')).toBe(true)
    expect(coversText([], 'A')).toBe(false)
    expect(coversText([0x1f600, 0x1f600], '😀')).toBe(true)
  })
  it('uses small subsets for English and Polish, complete fonts for other scripts', () => {
    expect(fontSources(font, 'Hello')).toEqual([font.latin])
    expect(fontSources(font, 'Zażółć')).toEqual([font.latin, font.latinExt])
    expect(fontSources(font, 'Привет')).toEqual([font.url])
  })
  it('prevents unsupported script fallbacks from being ranked as real matches', () => {
    expect(supportsScript(font, 'Hello')).toBe(true)
    expect(supportsScript(font, 'Привет')).toBe(false)
    expect(supportsScript({ ...font, subsets: ['latin', 'cyrillic'] }, 'Hello Привет')).toBe(true)
    expect(supportsScript(font, 'مرحبا')).toBe(false)
  })
})
describe('OCR line grouping', () => {
  it('groups adjacent words while keeping separate lines separate', () => {
    const result = groupLines([
      { text: 'Hello', confidence: 0.9, box: { x: 10, y: 10, width: 70, height: 25 } },
      { text: 'world', confidence: 0.8, box: { x: 92, y: 11, width: 70, height: 24 } },
      { text: 'Second', confidence: 0.95, box: { x: 10, y: 60, width: 85, height: 26 } },
    ])
    expect(result.map((r) => r.text)).toEqual(['Hello world', 'Second'])
    expect(result[0]!.box).toEqual({ x: 10, y: 10, width: 152, height: 25 })
  })
  it('does not merge independent distant or rotated labels', () => {
    const result = groupLines([
      { text: 'Left', confidence: 0.9, box: { x: 10, y: 10, width: 50, height: 20 } },
      { text: 'Right', confidence: 0.9, box: { x: 400, y: 10, width: 60, height: 20 } },
      { text: 'Tilt', confidence: 0.9, angle: 30, box: { x: 75, y: 10, width: 60, height: 20 } },
    ])
    expect(result).toHaveLength(3)
  })
})
describe('visually equivalent candidate groups', () => {
  it('groups matching glyph signatures without increasing their total likelihood by clone count', () => {
    const result = probabilities(
      [
        { font: { ...font, family: 'Noto Sans Extended' }, score: 0.05, signature: 'same' },
        { font: { ...font, id: 1, family: 'Noto Sans' }, score: 0.05, signature: 'same' },
        { font: { ...font, id: 2, family: 'Different' }, score: 0.05, signature: 'different' },
      ] as MatchResult[],
      10,
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.font.family).toBe('Noto Sans')
    expect(result[0]!.alternatives).toEqual(['Noto Sans Extended'])
    expect(result[0]!.probability).toBe(0.5)
  })
})
