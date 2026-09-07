import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeCatalogAsset, readCatalogAsset } from '../scripts/catalog-assets'
import { readCatalogAsset as download } from '../app/lib/catalog-assets'

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'font-assets-'))
  dirs.push(root)
  const payload = Buffer.from('a deterministic index payload')
  return { root, payload, asset: await writeCatalogAsset(root, 'glyphs/61', 'bin', payload) }
}
it('retains unchanged addresses and old files when another glyph changes', async () => {
  const { root, payload, asset } = await fixture()
  expect(await writeCatalogAsset(root, 'glyphs/61', 'bin', payload)).toEqual(asset)
  const changed = await writeCatalogAsset(root, 'glyphs/61', 'bin', Buffer.from('new glyph'))
  expect(changed.path).not.toBe(asset.path)
  expect(await readCatalogAsset(root, asset)).toEqual(payload)
})
it.each([false, true])(
  'verifies the decoded hash with CDN decompression=%s',
  async (decompressed) => {
    const { root, payload, asset } = await fixture()
    const body = decompressed ? payload : await readFile(join(root, asset.path))
    const fetch = vi.fn(async () => new Response(body))
    vi.stubGlobal('fetch', fetch)
    expect(await download('/demo/', asset)).toEqual(new Uint8Array(payload))
    expect(fetch.mock.calls[0]![0]).toBe(`/demo/catalog/${asset.path}`)
  },
)
it('rejects valid gzip containing wrong data of the same size', async () => {
  const { root, payload, asset } = await fixture()
  const bad = gzipSync(Buffer.alloc(payload.length))
  await writeFile(join(root, asset.path), bad)
  await expect(readCatalogAsset(root, asset)).rejects.toThrow('checksum')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bad)),
  )
  await expect(download('/', asset)).rejects.toThrow('checksum')
})
