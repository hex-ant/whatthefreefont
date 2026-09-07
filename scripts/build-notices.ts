import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface PackageLicense {
  name: string
  versions: string[]
  paths: string[]
  license: string
  homepage?: string
}
const licenses = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
) as Record<string, PackageLicense[]>
const overrides = JSON.parse(await readFile('licenses/upstream/sources.json', 'utf8')) as Record<
  string,
  { source: string; packages: string[] }
>
// Metadata is a build-only dependency, but its derived catalog is shipped with the site.
const metadata = JSON.parse(
  await readFile('node_modules/google-font-metadata/package.json', 'utf8'),
)
licenses.MIT ||= []
licenses.MIT.push({
  name: metadata.name,
  versions: [metadata.version],
  paths: ['node_modules/google-font-metadata'],
  license: metadata.license,
  homepage: 'https://github.com/fontsource/google-font-metadata',
})
const inventory = []
const texts = new Map<string, string[]>()
for (const pkg of Object.values(licenses)
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
  const root = pkg.paths[0]!
  const files = (await readdir(root))
    .filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))
    .sort()
  const content: string[] = []
  for (const file of files) {
    try {
      content.push(await readFile(join(root, file), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EISDIR') throw error
    }
  }
  let source: string | undefined
  if (!content.length) {
    const override = Object.entries(overrides).find(([, value]) =>
      value.packages.some((pattern) =>
        pattern.endsWith('*') ? pkg.name.startsWith(pattern.slice(0, -1)) : pkg.name === pattern,
      ),
    )
    if (override) {
      content.push(await readFile(`licenses/upstream/${override[0]}.txt`, 'utf8'))
      source = override[1].source
    } else {
      // Some older npm packages ship their full license only in the README.
      for (const file of (await readdir(root)).filter((name) => /^readme/i.test(name))) {
        const readme = await readFile(join(root, file), 'utf8')
        if (/Permission is hereby granted|Permission to use, copy/.test(readme))
          content.push(readme)
      }
    }
  }
  if (!content.length)
    throw new Error(
      `Missing license text for ${pkg.name}; add a reviewed upstream license before publishing`,
    )
  inventory.push({
    name: pkg.name,
    versions: pkg.versions,
    license: pkg.license,
    homepage: pkg.homepage,
    supplementalSource: source,
  })
  const text = content.join('\n\n')
  texts.set(text, [...(texts.get(text) || []), `${pkg.name}@${pkg.versions.join(', ')}`])
}
for (const [key, item] of Object.entries(overrides).filter(([, value]) => !value.packages.length)) {
  const text = await readFile(`licenses/upstream/${key}.txt`, 'utf8')
  texts.set(text, [
    ...(texts.get(text) || []),
    `${key} (additional runtime resource; ${item.source})`,
  ])
}
await mkdir('public/licenses', { recursive: true })
await writeFile('public/licenses/dependencies.json', JSON.stringify(inventory, null, 2) + '\n')
await writeFile(
  'public/licenses/THIRD_PARTY_LICENSES.txt',
  'Generated from the installed production dependency graph, including build tooling.\n' +
    'This is deliberately broader than the modules shipped to the browser.\n' +
    'Package inventory: dependencies.json. Resource provenance: THIRD_PARTY_NOTICES.md.\n\n' +
    [...texts.entries()]
      .map(
        ([text, names]) => `${'='.repeat(80)}\n${names.join('\n')}\n${'='.repeat(80)}\n\n${text}`,
      )
      .join('\n\n'),
)
await copyFile('LICENSE', 'public/licenses/LICENSE')
await copyFile('THIRD_PARTY_NOTICES.md', 'public/licenses/THIRD_PARTY_NOTICES.md')
console.log(
  `Prepared license texts for ${inventory.length} installed packages and additional runtime resources`,
)
