import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { Catalog, CatalogAsset } from '../app/lib/types'

export async function writeCatalogAsset(
  root: string,
  stem: string,
  extension: 'bin' | 'json',
  payload: Uint8Array,
): Promise<CatalogAsset> {
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const path = `${stem}.${sha256}.${extension}.gz`
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), gzipSync(payload, { level: 9 }))
  return { path, sha256 }
}

export async function readCatalogAsset(root: string, asset: CatalogAsset) {
  if (
    !asset ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !new RegExp(`^(glyphs/[a-f0-9]+|coverage)\\.${asset.sha256}\\.(bin|json)\\.gz$`).test(
      asset.path,
    )
  )
    throw new Error('Invalid catalog asset path')
  const payload = gunzipSync(await readFile(join(root, asset.path)))
  if (createHash('sha256').update(payload).digest('hex') !== asset.sha256)
    throw new Error(`Invalid checksum: ${asset.path}`)
  return payload
}

export async function publishCatalog(catalog: Catalog, root = 'public/catalog') {
  // All immutable files must exist before replacing the only mutable entry point.
  const path = join(root, 'catalog.json')
  await writeFile(`${path}.tmp`, JSON.stringify(catalog))
  await rename(`${path}.tmp`, path)
}
