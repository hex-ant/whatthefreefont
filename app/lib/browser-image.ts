import { fromRGBA, trim } from './image'
import type { Mask, Rect } from './types'

export function maskToCanvas(mask: Mask): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = mask.width
  canvas.height = mask.height
  const ctx = canvas.getContext('2d')!,
    image = ctx.createImageData(mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i++) {
    const v = 255 - mask.data[i]!
    image.data[i * 4] = v
    image.data[i * 4 + 1] = v
    image.data[i * 4 + 2] = v
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
export function cropImage(image: HTMLImageElement, rect: Rect, angle = 0): HTMLCanvasElement {
  const scale = Math.min(1, 2400 / Math.max(rect.width, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
  if (!angle) return canvas
  const r = (angle * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r),
    out = document.createElement('canvas')
  out.width = Math.ceil(Math.abs(canvas.width * c) + Math.abs(canvas.height * s))
  out.height = Math.ceil(Math.abs(canvas.width * s) + Math.abs(canvas.height * c))
  const o = out.getContext('2d')!
  o.fillStyle = '#fff'
  o.fillRect(0, 0, out.width, out.height)
  o.translate(out.width / 2, out.height / 2)
  o.rotate(r)
  o.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}
export function canvasToMask(
  canvas: HTMLCanvasElement,
  mode: 'auto' | 'dark' | 'light' = 'auto',
  threshold = 0,
) {
  return trim(
    fromRGBA(
      canvas
        .getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      mode,
      threshold,
    ),
  )
}
