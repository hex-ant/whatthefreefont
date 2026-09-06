import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { create as parseFont } from 'fontkit'
import type { Catalog } from '../app/lib/types'

export async function buildCoverage(catalog: Catalog) {
  const sets: number[][] = [],
    fonts: number[] = [],
    unique = new Map<string, number>()
  for (const variant of catalog.variants) {
    const hash = createHash('sha256').update(variant.url).digest('hex').slice(0, 24)
    const font = parseFont(await readFile(`.cache/fonts/${hash}.ttf`)) as import('fontkit').Font
    const chars = [...font.characterSet].sort((a, b) => a - b)
    const ranges: number[] = []
    for (const char of chars) {
      if (ranges.length && char <= ranges[ranges.length - 1]! + 1) ranges[ranges.length - 1] = char
      else ranges.push(char, char)
    }
    const key = JSON.stringify(ranges)
    if (!unique.has(key)) {
      unique.set(key, sets.length)
      sets.push(ranges)
    }
    fonts.push(unique.get(key)!)
  }
  const catalogHash = createHash('sha256')
    .update(catalog.variants.map((v) => v.url).join('\n'))
    .digest('hex')
  catalog.coverageHash = catalogHash
  const data = gzipSync(JSON.stringify({ version: 1, catalogHash, sets, fonts }), { level: 9 })
  await writeFile('public/catalog/coverage.json.gz', data)
  await writeFile('public/catalog/catalog.json', JSON.stringify(catalog))
  console.log(
    `Character coverage: ${fonts.length} variants, ${sets.length} distinct maps, ${Math.round(data.length / 1024)} KiB compressed`,
  )
}
if (process.argv[1]?.endsWith('build-coverage.ts')) {
  await buildCoverage(JSON.parse(await readFile('public/catalog/catalog.json', 'utf8')))
}
