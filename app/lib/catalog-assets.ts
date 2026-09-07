import type { CatalogAsset } from './types'

export async function readCatalogAsset(base: string, asset: CatalogAsset): Promise<Uint8Array> {
  if (
    !asset ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !new RegExp(`^(glyphs/[a-f0-9]+|coverage)\\.${asset.sha256}\\.(bin|json)\\.gz$`).test(
      asset.path,
    )
  ) {
    throw new Error('Nieprawidłowy adres zasobu katalogu.')
  }
  const response = await fetch(`${base}catalog/${asset.path}`, {
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok)
    throw new Error(`Nie udało się pobrać zasobu katalogu (HTTP ${response.status}).`)
  const buffer = await response.arrayBuffer(),
    header = new Uint8Array(buffer)
  // Hash the decoded payload: CDNs may transparently decompress .gz files.
  const decoded =
    header[0] === 31 && header[1] === 139
      ? await new Response(
          new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer()
      : buffer
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', decoded))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  if (hash !== asset.sha256)
    throw new Error('Zasób katalogu ma nieprawidłową sumę kontrolną. Spróbuj ponownie.')
  return new Uint8Array(decoded)
}
