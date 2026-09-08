/** Inspect the shipped HTML as a crawler would: without executing JavaScript. */
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { site } from '../config/site'

const output = '.output/public'
const html = await readFile(`${output}/index.html`, 'utf8')
const attributes = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map((m) => [m[1], m[2]]))
const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => attributes(m[0]))
function meta(key: string) {
  const found = metas.filter((m) => m.name === key || m.property === key)
  assert.equal(found.length, 1, `Expected one ${key}`)
  return found[0]!.content
}
assert.match(html, /<html[^>]*lang="en"/)
assert.match(
  html,
  /<h1[^>]*>What <em>font<\/em> is this\?<\/h1>/,
  'Landing content must be prerendered',
)
assert.match(html, /Drop an image here/)
assert.equal([...html.matchAll(/<title>/g)].length, 1)
assert(html.includes(`<title>${site.title}</title>`))
const canonical = [...html.matchAll(/<link\b[^>]*>/g)]
  .map((m) => attributes(m[0]))
  .filter((m) => m.rel === 'canonical')
assert.equal(canonical.length, 1)
assert.equal(canonical[0]!.href, site.url)
assert.equal(meta('description'), site.description)
assert.equal(meta('og:url'), site.url)
assert.equal(meta('og:type'), 'website')
assert.equal(meta('og:site_name'), site.name)
assert.equal(meta('og:locale'), 'en_US')
assert.equal(meta('twitter:card'), 'summary_large_image')
for (const prefix of ['og', 'twitter']) {
  assert.equal(meta(`${prefix}:title`), site.title)
  assert.equal(meta(`${prefix}:description`), site.description)
  assert.equal(meta(`${prefix}:image`), site.image)
  assert.equal(meta(`${prefix}:image:alt`), site.imageAlt)
}
assert.equal(meta('og:image:width'), '1200')
assert.equal(meta('og:image:height'), '630')
assert.equal(meta('og:image:type'), 'image/png')
assert.equal(meta('robots'), 'index, follow, max-image-preview:large')
const jsonld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)
assert(jsonld, 'Missing structured data')
const data = JSON.parse(jsonld[1]!)
const app = data['@graph'].find((node: { '@type': string }) => node['@type'] === 'WebApplication')
assert.equal(app.url, site.url)
assert.equal(app.offers.price, '0')
assert(!app.aggregateRating, 'Do not publish invented ratings')
for (const [name, width, height] of [
  ['og-image.png', 1200, 630],
  ['favicon-32.png', 32, 32],
  ['apple-touch-icon.png', 180, 180],
] as const) {
  const image = await readFile(`${output}/${name}`)
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(image.readUInt32BE(16), width)
  assert.equal(image.readUInt32BE(20), height)
}
assert(
  (await stat(`${output}/og-image.png`)).size < 1024 * 1024,
  'Keep the social image under 1 MB',
)
const robots = await readFile(`${output}/robots.txt`, 'utf8')
assert(robots.includes(`Sitemap: ${new URL('sitemap.xml', site.url).href}`))
const sitemap = await readFile(`${output}/sitemap.xml`, 'utf8')
assert(sitemap.includes(`<loc>${site.url}</loc>`))
for (const file of ['200.html', '404.html']) {
  const fallback = await readFile(`${output}/${file}`, 'utf8')
  assert.match(fallback, /name="robots" content="noindex, follow"/)
}
console.log(
  'Static HTML, canonical, Open Graph, Twitter, structured data, crawl files and images passed',
)
