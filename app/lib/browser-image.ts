import { rotationLayout } from './rotation'
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
/** Crop in the same padded, rotated coordinate space displayed by CropEditor. */
export function cropImage(
  image: HTMLImageElement,
  rect: Rect,
  angle = 0,
  background = '#fff',
): HTMLCanvasElement {
  const scale = Math.min(1, 2400 / Math.max(rect.width, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const layout = rotationLayout(image.width, image.height, angle)
  ctx.scale(canvas.width / rect.width, canvas.height / rect.height)
  ctx.translate(layout.width / 2 - rect.x, layout.height / 2 - rect.y)
  ctx.rotate((angle * Math.PI) / 180)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)
  return canvas
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
