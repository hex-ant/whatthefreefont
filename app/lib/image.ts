import type { Mask, Rect } from './types'

export const GRID_W = 16
export const GRID_H = 24
export const GLYPH_BYTES = GRID_W * GRID_H + 4

/** Recover solid source colours so candidate rasterization uses the same contrast. */
export function samplePalette(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): { foreground: string; background: string } {
  const histogram = new Map<number, { n: number; rgb: number[]; border: number }>()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4,
        a = rgba[p + 3]! / 255
      const rgb = [0, 1, 2].map((c) => rgba[p + c]! * a + 255 * (1 - a))
      const key =
        (Math.floor(rgb[0]! / 16) << 8) | (Math.floor(rgb[1]! / 16) << 4) | Math.floor(rgb[2]! / 16)
      const entry = histogram.get(key) || { n: 0, rgb: [0, 0, 0], border: 0 }
      entry.n++
      for (let c = 0; c < 3; c++) entry.rgb[c]! += rgb[c]!
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) entry.border++
      histogram.set(key, entry)
    }
  const entries = [...histogram.values()].map((e) => ({ ...e, rgb: e.rgb.map((v) => v / e.n) }))
  const bg = entries.sort((a, b) => b.border - a.border)[0] || {
    rgb: [255, 255, 255],
    n: 1,
    border: 1,
  }
  const fg = entries
    .filter(
      (e) => Math.hypot(...(e.rgb.map((v, i) => v - bg.rgb[i]!) as [number, number, number])) > 30,
    )
    .sort((a, b) => b.n - a.n)[0] || { rgb: [0, 0, 0] }
  const css = (rgb: number[]) => `rgb(${rgb.map(Math.round).join(',')})`
  return { foreground: css(fg.rgb), background: css(bg.rgb) }
}

export function otsu(values: Uint8Array): number {
  const hist = new Uint32Array(256)
  for (const v of values) hist[v]!++
  let total = 0
  for (let i = 0; i < 256; i++) total += i * hist[i]!
  let count = 0,
    sum = 0,
    best = 0,
    threshold = 127
  for (let i = 0; i < 255; i++) {
    count += hist[i]!
    if (!count) continue
    if (count === values.length) break
    sum += i * hist[i]!
    const d = sum / count - (total - sum) / (values.length - count)
    const score = count * (values.length - count) * d * d
    if (score > best) {
      best = score
      threshold = i
    }
  }
  return threshold
}

/** Colour-distance segmentation also works with equal-luminance foreground/background. */
export function fromRGBA(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  mode: 'auto' | 'dark' | 'light' = 'auto',
  adjustment = 0,
): Mask {
  const rgb = new Uint8Array(width * height * 3)
  const colours = new Map<number, number>()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        a = rgba[p * 4 + 3]! / 255
      for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(rgba[p * 4 + c]! * a + 255 * (1 - a))
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) {
        const key = (rgb[p * 3]! >> 4) * 256 + (rgb[p * 3 + 1]! >> 4) * 16 + (rgb[p * 3 + 2]! >> 4)
        colours.set(key, (colours.get(key) || 0) + 1)
      }
    }
  const key = [...colours].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 4095
  const bg = [(key >> 8) * 16 + 7.5, ((key >> 4) & 15) * 16 + 7.5, (key & 15) * 16 + 7.5]
  const contrast = new Uint8Array(width * height)
  for (let i = 0; i < contrast.length; i++) {
    const r = rgb[i * 3]!,
      g = rgb[i * 3 + 1]!,
      b = rgb[i * 3 + 2]!
    contrast[i] =
      mode === 'auto'
        ? Math.min(255, Math.hypot(r - bg[0]!, g - bg[1]!, b - bg[2]!) / Math.sqrt(3))
        : mode === 'dark'
          ? 255 - (r * 0.299 + g * 0.587 + b * 0.114)
          : r * 0.299 + g * 0.587 + b * 0.114
  }
  const threshold = Math.max(8, Math.min(245, otsu(contrast) + adjustment))
  return { width, height, data: contrast.map((v) => (v > threshold ? 255 : 0)) }
}

export function bounds(mask: Mask, threshold = 80): Rect {
  let left = mask.width,
    top = mask.height,
    right = -1,
    bottom = -1
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.data[y * mask.width + x]! > threshold) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
  return right < left
    ? { x: 0, y: 0, width: 1, height: 1 }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}
export function crop(mask: Mask, rect: Rect): Mask {
  const x = Math.max(0, Math.floor(rect.x)),
    y = Math.max(0, Math.floor(rect.y))
  const width = Math.max(1, Math.min(mask.width - x, Math.round(rect.width))),
    height = Math.max(1, Math.min(mask.height - y, Math.round(rect.height)))
  const data = new Uint8Array(width * height)
  for (let row = 0; row < height; row++)
    data.set(
      mask.data.subarray((y + row) * mask.width + x, (y + row) * mask.width + x + width),
      row * width,
    )
  return { width, height, data }
}
export const trim = (mask: Mask) => crop(mask, bounds(mask))

/** Area sampling retains thin strokes when a large glyph is reduced. */
export function resize(mask: Mask, width: number, height: number): Mask {
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  const data = new Uint8Array(width * height)
  const sx = mask.width / width,
    sy = mask.height / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0,
        area = 0
      for (let iy = Math.floor(y * sy); iy < Math.ceil((y + 1) * sy); iy++)
        for (let ix = Math.floor(x * sx); ix < Math.ceil((x + 1) * sx); ix++) {
          if (ix >= mask.width || iy >= mask.height) continue
          const a =
            (Math.min((x + 1) * sx, ix + 1) - Math.max(x * sx, ix)) *
            (Math.min((y + 1) * sy, iy + 1) - Math.max(y * sy, iy))
          sum += mask.data[iy * mask.width + ix]! * a
          area += a
        }
      data[y * width + x] = Math.round(sum / (area || 1))
    }
  return { width, height, data }
}

export function rotate(mask: Mask, degrees: number): Mask {
  const r = (degrees * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r)
  const width = Math.ceil(Math.abs(mask.width * c) + Math.abs(mask.height * s)),
    height = Math.ceil(Math.abs(mask.width * s) + Math.abs(mask.height * c))
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dx = x - (width - 1) / 2,
        dy = y - (height - 1) / 2
      const ix = c * dx + s * dy + (mask.width - 1) / 2,
        iy = -s * dx + c * dy + (mask.height - 1) / 2
      const x0 = Math.floor(ix),
        y0 = Math.floor(iy),
        fx = ix - x0,
        fy = iy - y0
      let value = 0
      for (let yy = 0; yy < 2; yy++)
        for (let xx = 0; xx < 2; xx++)
          if (x0 + xx >= 0 && y0 + yy >= 0 && x0 + xx < mask.width && y0 + yy < mask.height) {
            value +=
              mask.data[(y0 + yy) * mask.width + x0 + xx]! * (xx ? fx : 1 - fx) * (yy ? fy : 1 - fy)
          }
      data[y * width + x] = Math.round(value)
    }
  return trim({ width, height, data })
}

/** Search projection concentration, first globally and then at sub-degree resolution. */
export function estimateAngle(input: Mask): number {
  const m = resize(
    input,
    Math.min(700, input.width),
    Math.max(1, input.height * Math.min(1, 700 / input.width)),
  )
  const points: number[] = []
  const stride = Math.max(1, Math.floor(m.data.reduce((n, v) => n + (v > 128 ? 1 : 0), 0) / 10000))
  let n = 0
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++)
      if (m.data[y * m.width + x]! > 128 && n++ % stride === 0) points.push(x, y)
  if (points.length < 30) return 0
  const size = Math.ceil(Math.hypot(m.width, m.height)) * 2 + 8
  const score = (angle: number) => {
    const hist = new Float32Array(size),
      r = (angle * Math.PI) / 180,
      s = Math.sin(r),
      c = Math.cos(r)
    for (let i = 0; i < points.length; i += 2) {
      const p = (-points[i]! * s + points[i + 1]! * c) / 2 + size / 2
      const k = Math.floor(p),
        f = p - k
      hist[k]! += 1 - f
      hist[k + 1]! += f
    }
    return hist.reduce((sum, v) => sum + v * v, 0)
  }
  let best = 0,
    max = score(0)
  for (let a = -90; a < 90; a += 3) {
    const v = score(a)
    if (v > max) {
      best = a
      max = v
    }
  }
  const coarse = best
  for (let a = coarse - 3; a <= coarse + 3; a += 0.15) {
    const v = score(a)
    if (v > max) {
      best = a
      max = v
    }
  }
  return Math.round(best * 100) / 100
}

export function projection(mask: Mask): Float32Array {
  const out = new Float32Array(mask.width)
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++) out[x]! += mask.data[y * mask.width + x]! / 255
  return out
}

export function segmentGlyphs(mask: Mask, count?: number): Mask[] {
  const m = trim(mask),
    p = projection(m),
    spans: Array<[number, number]> = []
  let start = -1
  for (let x = 0; x <= m.width; x++) {
    const ink = (p[x] || 0) > 0.35
    if (ink && start < 0) start = x
    if (!ink && start >= 0) {
      spans.push([start, x])
      start = -1
    }
  }
  // A touching pair is split only when the transcription requires more glyphs.
  if (count && spans.length < count) {
    while (spans.length < count) {
      let best = -1,
        split = 0,
        cost = Infinity
      for (let i = 0; i < spans.length; i++) {
        const [a, b] = spans[i]!,
          min = Math.max(2, Math.floor(m.height * 0.1))
        if (b - a < min * 2) continue
        for (let x = a + min; x < b - min; x++) {
          const edge = Math.min(x - a, b - x) / (b - a)
          const v = p[x]! / m.height + 0.04 / edge + (0.08 * m.height) / (b - a)
          if (v < cost) {
            cost = v
            best = i
            split = x
          }
        }
      }
      if (best < 0) break
      const [a, b] = spans[best]!
      spans.splice(best, 1, [a, split], [split, b])
    }
  }
  if (count && spans.length > count) {
    while (spans.length > count) {
      let best = 0,
        gap = Infinity
      for (let i = 0; i < spans.length - 1; i++) {
        const g = spans[i + 1]![0] - spans[i]![1]
        if (g < gap) {
          gap = g
          best = i
        }
      }
      spans.splice(best, 2, [spans[best]![0], spans[best + 1]![1]])
    }
  }
  return spans.map(([a, b]) => trim(crop(m, { x: a, y: 0, width: b - a, height: m.height })))
}

export function descriptor(mask: Mask): Uint8Array {
  const m = trim(mask),
    result = new Uint8Array(GLYPH_BYTES)
  result.set(resize(m, GRID_W, GRID_H).data)
  const view = new DataView(result.buffer)
  view.setUint16(GRID_W * GRID_H, Math.min(65535, Math.round((m.width / m.height) * 10000)), true)
  view.setUint16(GRID_W * GRID_H + 2, m.height, true)
  return result
}

export function descriptorDistance(a: Uint8Array, b: Uint8Array, offset = 0): number {
  let intersection = 0,
    union = 0
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    intersection += Math.min(a[i]!, b[offset + i]!)
    union += Math.max(a[i]!, b[offset + i]!)
  }
  if (!union) return 1
  const k = GRID_W * GRID_H
  const ar = a[k]! + a[k + 1]! * 256,
    br = b[offset + k]! + b[offset + k + 1]! * 256
  if (!br) return 1
  return (1 - intersection / union) * 0.88 + Math.min(1, Math.abs(Math.log(ar / br))) * 0.12
}

export function removeSpacing(input: Mask): Mask {
  const m = trim(input),
    p = projection(m),
    cols: number[] = []
  for (let x = 0; x < m.width; x++) if (p[x]! > 0.35) cols.push(x)
  const data = new Uint8Array(Math.max(1, cols.length) * m.height)
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < cols.length; x++)
      data[y * cols.length + x] = m.data[y * m.width + cols[x]!]!
  return { width: Math.max(1, cols.length), height: m.height, data }
}

export function pixelDistance(a: Mask, b: Mask): number {
  const aa = resize(trim(a), 256, 40),
    bb = resize(trim(b), 256, 40)
  let intersection = 0,
    union = 0
  for (let i = 0; i < aa.data.length; i++) {
    intersection += Math.min(aa.data[i]!, bb.data[i]!)
    union += Math.max(aa.data[i]!, bb.data[i]!)
  }
  return union ? 1 - intersection / union : 1
}

/** DTW aligns columns, preserving vertical shape while tolerating local tracking/kerning. */
export function elasticDistance(a: Mask, b: Mask): number {
  const aa = removeSpacing(a),
    bb = removeSpacing(b)
  const height = 24,
    width = Math.min(
      340,
      Math.max(30, Math.round(((aa.width / aa.height + bb.width / bb.height) * height) / 2)),
    )
  const x = resize(aa, width, height),
    y = resize(bb, width, height)
  let prev = new Float32Array(width + 1).fill(Infinity),
    curr = new Float32Array(width + 1)
  prev[0] = 0
  const band = Math.max(4, Math.round(width * 0.09))
  for (let i = 1; i <= width; i++) {
    curr.fill(Infinity)
    for (let j = Math.max(1, i - band); j <= Math.min(width, i + band); j++) {
      let sum = 0
      for (let k = 0; k < height; k++)
        sum += Math.abs(x.data[k * width + i - 1]! - y.data[k * width + j - 1]!)
      const cost = sum / (height * 255)
      curr[j] = cost + Math.min(prev[j - 1]!, prev[j]! + 0.025, curr[j - 1]! + 0.025)
    }
    ;[prev, curr] = [curr, prev]
  }
  const ratio = Math.abs(Math.log(aa.width / aa.height / (bb.width / bb.height)))
  return prev[width]! / width + Math.min(1, ratio) * 0.025
}
