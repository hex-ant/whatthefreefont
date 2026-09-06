export interface Mask {
  width: number
  height: number
  data: Uint8Array
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface FontVariant {
  id: number
  family: string
  slug: string
  category: string
  weight: number
  style: string
  url: string
  latin?: string
  latinExt?: string
  subsets: string[]
}
export interface Catalog {
  version: number
  generated: string
  source: string
  families: number
  glyphs: string
  variants: FontVariant[]
  failures: string[]
  indexWidth: number
  indexHeight: number
  coverageHash?: string
}
export interface FontCoverage {
  version: number
  catalogHash: string
  sets: number[][]
  fonts: number[]
}
export interface MatchResult {
  font: FontVariant
  score: number
  probability: number
  preview?: string
  signature?: string
  flipped?: boolean
  alternatives?: string[]
  source: 'refined' | 'index'
}
export interface Recognition {
  text: string
  confidence: number
  box: Rect
  angle?: number
}
export interface Progress {
  stage: string
  done: number
  total: number
}
