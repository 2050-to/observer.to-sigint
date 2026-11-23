import { cpSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const pub = join(root, 'site', 'public')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html is missing. Run npm run build first.')
  process.exit(1)
}

for (const name of readdirSync(dist)) {
  if (name === 'index.html') continue
  cpSync(join(dist, name), join(pub, name), { recursive: true })
}
