import { afterEach, expect, it, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { imagePoint, remapSelection, rotationLayout } from '../app/lib/rotation'
import { cropImage } from '../app/lib/browser-image'

afterEach(() => vi.unstubAllGlobals())

it.each([0, 37, 90, -90, 180])(
  'keeps every source corner and extra crop space visible at %s°',
  (angle) => {
    const l = rotationLayout(800, 240, angle)
    for (const [x, y] of [
      [0, 0],
      [800, 0],
      [800, 240],
      [0, 240],
    ]) {
      const p = imagePoint(x!, y!, 800, 240, angle)
      expect(p.x).toBeGreaterThan(30)
      expect(p.y).toBeGreaterThan(30)
      expect(p.x).toBeLessThan(l.width - 30)
      expect(p.y).toBeLessThan(l.height - 30)
    }
  },
)

it('keeps the crop centered on the same part of the image when rotating', () => {
  const center = imagePoint(180, 100, 800, 240, 0)
  const r = { x: center.x - 20, y: center.y - 10, width: 40, height: 20 }
  const next = remapSelection(r, 800, 240, 0, 90)
  const expected = imagePoint(180, 100, 800, 240, 90)
  expect(next.x + next.width / 2).toBeCloseTo(expected.x)
  expect(next.y + next.height / 2).toBeCloseTo(expected.y)
  expect(remapSelection(rotationLayout(800, 240, 0).bounds, 800, 240, 0, 90)).toEqual(
    rotationLayout(800, 240, 90).bounds,
  )
})

it('crops the rotated image in editor coordinates, including padding on a dark image', () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) })
  const source = createCanvas(120, 60),
    ctx = source.getContext('2d')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, 120, 60)
  ctx.fillStyle = '#fff'
  ctx.fillRect(10, 10, 20, 20)
  const center = imagePoint(20, 20, 120, 60, 90)
  const selected = cropImage(
    source as unknown as HTMLImageElement,
    { x: center.x - 5, y: center.y - 5, width: 10, height: 10 },
    90,
    '#121212',
  )
  expect([...selected.getContext('2d')!.getImageData(5, 5, 1, 1).data]).toEqual([
    255, 255, 255, 255,
  ])
  const padding = cropImage(
    source as unknown as HTMLImageElement,
    { x: 0, y: 0, width: 10, height: 10 },
    90,
    '#121212',
  )
  expect([...padding.getContext('2d')!.getImageData(5, 5, 1, 1).data]).toEqual([18, 18, 18, 255])
})
