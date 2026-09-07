import type { Rect } from './types'

export function rotationLayout(width: number, height: number, angle: number) {
  const radians = (angle * Math.PI) / 180
  const c = Math.cos(radians),
    s = Math.sin(radians)
  const padding = Math.max(32, Math.max(width, height) * 0.15)
  const rotatedWidth = Math.abs(width * c) + Math.abs(height * s)
  const rotatedHeight = Math.abs(width * s) + Math.abs(height * c)
  return {
    width: rotatedWidth + 2 * padding,
    height: rotatedHeight + 2 * padding,
    bounds: { x: padding, y: padding, width: rotatedWidth, height: rotatedHeight },
    c,
    s,
  }
}

export function imagePoint(x: number, y: number, width: number, height: number, angle: number) {
  const l = rotationLayout(width, height, angle)
  return {
    x: l.width / 2 + (x - width / 2) * l.c - (y - height / 2) * l.s,
    y: l.height / 2 + (x - width / 2) * l.s + (y - height / 2) * l.c,
  }
}

export function remapSelection(
  rect: Rect,
  width: number,
  height: number,
  previous: number,
  next: number,
  enclose = false,
): Rect {
  const old = rotationLayout(width, height, previous),
    layout = rotationLayout(width, height, next)
  if (
    Object.keys(old.bounds).every(
      (key) => Math.abs(rect[key as keyof Rect] - old.bounds[key as keyof Rect]) < 0.01,
    )
  )
    return { ...layout.bounds }
  const dx = rect.x + rect.width / 2 - old.width / 2,
    dy = rect.y + rect.height / 2 - old.height / 2
  const center = imagePoint(
    width / 2 + dx * old.c + dy * old.s,
    height / 2 - dx * old.s + dy * old.c,
    width,
    height,
    next,
  )
  const delta = ((next - previous) * Math.PI) / 180
  const c = Math.abs(Math.cos(delta)),
    s = Math.abs(Math.sin(delta))
  const w = Math.min(enclose ? rect.width * c + rect.height * s : rect.width, layout.width),
    h = Math.min(enclose ? rect.width * s + rect.height * c : rect.height, layout.height)
  return {
    x: Math.max(0, Math.min(layout.width - w, center.x - w / 2)),
    y: Math.max(0, Math.min(layout.height - h, center.y - h / 2)),
    width: w,
    height: h,
  }
}

export function normalizedAngle(angle: number) {
  return Number.isFinite(angle) ? ((((angle + 180) % 360) + 360) % 360) - 180 : 0
}
