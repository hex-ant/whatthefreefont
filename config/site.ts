/** Build-time public URL. It must never be inferred from a local or preview request. */
const configuredURL =
  process.env.SITE_URL ||
  new URL(process.env.NUXT_APP_BASE_URL || '/', 'https://whatthefreefont.com').href
const url = new URL(configuredURL)
if (
  !['https:', 'http:'].includes(url.protocol) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error('SITE_URL must be an absolute HTTP(S) URL without credentials, query or fragment')
url.pathname = `${url.pathname.replace(/\/+$/, '')}/`

export const site = {
  url: url.href,
  name: 'What the Free Font',
  title: 'What the Free Font — Identify Google Fonts from Images',
  description:
    'Identify Google Fonts from a screenshot, logo or photo. Compare matching fonts for free, with private image analysis and OCR running entirely in your browser.',
  image: new URL('og-image.png', url).href,
  imageAlt:
    'What the Free Font identifies Google Fonts from images: a selected Good type sample is matched to Lobster. Free to use; images stay on your device.',
}
export const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${site.url}#website`,
      url: site.url,
      name: site.name,
      inLanguage: 'en',
    },
    {
      '@type': 'WebApplication',
      '@id': `${site.url}#app`,
      url: site.url,
      name: site.name,
      description: site.description,
      image: site.image,
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript, WebAssembly and a modern browser.',
      inLanguage: 'en',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Identify Google Fonts from images',
        'Automatic text recognition',
        'Adjustable text selection and rotation',
        'Private processing in your browser',
      ],
      isPartOf: { '@id': `${site.url}#website` },
    },
  ],
}
