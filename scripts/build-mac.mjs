import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npx', ['tsc', '-p', 'electron', '--noEmit'])

await esbuild.build({
  entryPoints: [join(root, 'electron/main.ts')],
  outfile: join(root, 'electron/dist/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
})

await esbuild.build({
  entryPoints: [join(root, 'electron/preload.ts')],
  outfile: join(root, 'electron/dist/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
})

const resources = join(root, 'build-resources')
mkdirSync(resources, { recursive: true })
const ca = join(root, 'certs/ca.crt')
if (existsSync(ca)) cpSync(ca, join(resources, 'ca.crt'))

if (!existsSync(join(root, 'macos/addon/node_modules/node-addon-api'))) {
  run('npm', ['install', '--prefix', 'macos/addon'])
}
rmSync(join(root, 'macos/addon/build'), { recursive: true, force: true })
run('npx', ['@electron/rebuild', '--module-dir', 'macos/addon', '-w', 'scanner'])
const canNotarize = Boolean(process.env.APPLE_TEAM_ID && (
  process.env.APPLE_API_KEY || process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID
))
const builderArgs = ['electron-builder', '--mac', 'dir']
if (canNotarize) {
  const override = join(root, 'release', 'notarize-config.json')
  mkdirSync(join(root, 'release'), { recursive: true })
  writeFileSync(override, JSON.stringify({
    mac: {
      identity: null,
      hardenedRuntime: true,
      entitlements: 'build-resources/entitlements.mac.plist',
      entitlementsInherit: 'build-resources/entitlements.mac.plist',
      notarize: { teamId: process.env.APPLE_TEAM_ID },
    },
  }))
  builderArgs.push('--config', override)
}
run('npx', builderArgs)

const release = join(root, 'release')
const macDir = readdirSync(release).find((name) => name.startsWith('mac'))
if (!macDir) throw new Error('electron-builder did not write a mac app directory')
const app = join(release, macDir, 'Observer.to.app')
const packed = spawnSync('npx', ['@electron/asar', 'list', join(app, 'Contents/Resources/app.asar')], { cwd: root, encoding: 'utf8' })
const packedFiles = new Set((packed.stdout || '').split('\n'))
if (packed.status !== 0 || !packedFiles.has('/dist/index.html')) {
  console.error(packed.stderr || 'The packaged app is missing dist/index.html')
  process.exit(1)
}

const staging = join(release, 'dmg-staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging)
// ditto keeps the framework symlinks relative. fs.cp turns them into absolute
// paths back to the build folder, and the packaged app then crashes on open.
run('ditto', [app, join(staging, 'Observer.to.app')])
symlinkSync('/Applications', join(staging, 'Applications'))
const dmg = join(release, 'Observer.to.dmg')
run('hdiutil', ['create', '-volname', 'Observer.to', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg])
rmSync(staging, { recursive: true, force: true })
console.log(dmg)
