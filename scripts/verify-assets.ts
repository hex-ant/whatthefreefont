import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import type { Catalog, FontCoverage } from '../app/lib/types'
import { GLYPH_BYTES } from '../app/lib/image'

const catalog: Catalog = JSON.parse(await readFile('public/catalog/catalog.json', 'utf8'))
assert.equal(catalog.failures.length, 0, 'Catalog build has failures')
assert.equal(new Set(catalog.variants.map((v) => v.family)).size, catalog.families)
assert(
  catalog.variants.every((v, i) => v.id === i && v.url.startsWith('https://fonts.gstatic.com/')),
)
for (const char of catalog.glyphs) {
  const bytes = gunzipSync(
    await readFile(`public/catalog/glyphs/${char.codePointAt(0)!.toString(16)}.bin.gz`),
  )
  assert.equal(bytes.length, catalog.variants.length * GLYPH_BYTES, `Invalid index for ${char}`)
}
const coverage: FontCoverage = JSON.parse(
  gunzipSync(await readFile('public/catalog/coverage.json.gz')).toString(),
)
const hash = createHash('sha256')
  .update(catalog.variants.map((v) => v.url).join('\n'))
  .digest('hex')
assert.equal(coverage.catalogHash, hash)
assert.equal(catalog.coverageHash, hash)
assert.equal(coverage.fonts.length, catalog.variants.length)
assert(coverage.fonts.every((i) => Array.isArray(coverage.sets[i])))
for (const ranges of coverage.sets) {
  assert.equal(ranges.length % 2, 0)
  assert(
    ranges.every(
      (value, i) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 0x10ffff &&
        (i === 0 || value >= ranges[i - 1]!),
    ),
  )
}
for (const [name, expected] of [
  ['PP-OCRv6_small_det.tar', 'd218f6fbf0f1c23d2161bd6ac7f5eaa6104fa89955c09290497e31008e2618e4'],
  ['PP-OCRv6_small_rec.tar', 'd267ab077a44a0eedb1ea8f8c542d263f211de8e9d7a029bf9fcfff7e5a88fb1'],
])
  assert.equal(
    createHash('sha256')
      .update(await readFile(`public/models/${name}`))
      .digest('hex'),
    expected,
    name,
  )
console.log(
  `Verified ${catalog.families} families, ${catalog.variants.length} variants, ${[...catalog.glyphs].length} index shards, Unicode coverage and both OCR model hashes.`,
)
