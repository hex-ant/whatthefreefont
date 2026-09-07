import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout } from 'node:timers/promises'

const devOCR = process.argv.includes('--dev-ocr')
const port = devOCR ? 4188 : 4187
const base = `http://127.0.0.1:${port}/`
const server = spawn(
  process.execPath,
  devOCR
    ? ['node_modules/nuxt/bin/nuxt.mjs', 'dev', '--host', '127.0.0.1', '--port', String(port)]
    : ['node_modules/serve/build/main.js', '.output/public', '--listen', `tcp://127.0.0.1:${port}`],
  { stdio: 'inherit' },
)
let serverError: Error | undefined
server.on('error', (error) => {
  serverError = error
})
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (serverError || server.exitCode !== null)
      throw serverError || new Error('Static server exited')
    try {
      ready = (await fetch(base, { signal: AbortSignal.timeout(500) })).ok
    } catch {}
    if (ready) break
    await setTimeout(200)
  }
  if (!ready) throw new Error('Static server did not start')
  const scripts = devOCR
    ? ['ocr-check']
    : ['browser-check', 'ocr-check', 'rotation-check', 'auto-rotation-check']
  if (!devOCR && process.env.BROWSER !== 'webkit')
    scripts.push('interactions-check', 'ocr-recovery-check')
  for (const script of scripts) {
    const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${script}.ts`], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: base },
    })
    const [code] = await once(child, 'exit')
    if (code !== 0) throw new Error(`${script} exited with ${code}`)
  }
} finally {
  server.kill()
}
