import { readFile, writeFile } from 'node:fs/promises'
import { site } from '../config/site'

const output = '.output/public'
const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  )
await writeFile(
  `${output}/robots.txt`,
  `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', site.url).href}\n`,
)
await writeFile(
  `${output}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xml(site.url)}</loc></url></urlset>\n`,
)
// Nuxt generates fallback documents in addition to the real landing page.
for (const file of ['200.html', '404.html']) {
  const path = `${output}/${file}`
  let html: string
  try {
    html = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
    throw e
  }
  html = html.replace(/<meta\b[^>]*\bname=["']robots["'][^>]*>/gi, '')
  await writeFile(
    path,
    html.replace('</head>', '<meta name="robots" content="noindex, follow"></head>'),
  )
}
console.log(`Generated static crawl assets for ${site.url}`)
