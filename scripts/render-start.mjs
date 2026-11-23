import { spawn } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicPort = Number(process.env.PORT || 3000)
const apiPort = 10001
const nextPort = 10002
const hsts = 'max-age=15552000; includeSubDomains'
const dmgUrlPath = '/release/Observer.to.dmg'
const dmgMissing = 'Observer.to.dmg is not available.'
const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

const children = []
let stopping = false

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (stopping) return
    if (signal || code) {
      console.error(`${command} exited`, signal || code)
      shutdown(1)
    }
  })
  return child
}

function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

function header(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function forwardedProto(req) {
  const value = header(req, 'x-forwarded-proto')
  return value ? value.split(',')[0].trim() : ''
}

function text(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Strict-Transport-Security': hsts,
    ...extra,
  })
  res.end(body)
}

function dmgFile() {
  const candidates = [
    process.env.MAC_DMG_PATH,
    '/var/observer/Observer.to.dmg',
    join(root, 'release', 'Observer.to.dmg'),
  ].filter((value) => typeof value === 'string' && value.length > 0)
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate)
      if (stat.isFile()) return { path: candidate, size: stat.size }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
  }
  return null
}

function serveDmg(req, res) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    text(res, 405, method === 'HEAD' ? undefined : 'Method not allowed.', { Allow: 'GET, HEAD' })
    return
  }
  let file
  try {
    file = dmgFile()
  } catch (error) {
    console.error(error)
    text(res, 500, method === 'HEAD' ? undefined : dmgMissing)
    return
  }
  if (!file) {
    text(res, 404, method === 'HEAD' ? undefined : dmgMissing)
    return
  }
  res.writeHead(200, {
    'Content-Type': 'application/x-apple-diskimage',
    'Content-Length': file.size,
    'Content-Disposition': 'attachment; filename="Observer.to.dmg"',
    'Strict-Transport-Security': hsts,
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file.path)
  stream.on('error', (error) => {
    console.error(error)
    res.destroy()
  })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

function handleRequest(req, res) {
  if (forwardedProto(req) === 'http') {
    const host = header(req, 'x-forwarded-host') || header(req, 'host') || 'observer.to'
    res.writeHead(301, {
      Location: `https://${host}${req.url || '/'}`,
      'Strict-Transport-Security': hsts,
    })
    res.end()
    return
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === dmgUrlPath) {
    serveDmg(req, res)
    return
  }
  const port = url.pathname === '/health' || url.pathname.startsWith('/api') ? apiPort : nextPort
  const headers = { ...req.headers }
  delete headers['transfer-encoding']
  delete headers.connection
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port,
    method: req.method,
    path: req.url,
    headers,
  }, (response) => {
    const outgoing = { ...response.headers }
    delete outgoing['transfer-encoding']
    delete outgoing.connection
    if (!outgoing['strict-transport-security']) outgoing['strict-transport-security'] = hsts
    if (!outgoing['content-security-policy']) outgoing['content-security-policy'] = 'upgrade-insecure-requests'
    res.writeHead(response.statusCode || 502, outgoing)
    response.pipe(res)
  })
  upstream.on('error', () => {
    if (res.headersSent) {
      res.end()
      return
    }
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'upstream unavailable' }))
  })
  req.pipe(upstream)
}

function waitFor(port, path) {
  return new Promise((resolvePromise, reject) => {
    let attempt = 0
    const tryOnce = () => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, timeout: 1000 }, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolvePromise()
          return
        }
        retry()
      })
      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
      req.end()
    }
    const retry = () => {
      attempt += 1
      if (attempt > 60) {
        reject(new Error(`timed out waiting for 127.0.0.1:${port}${path}`))
        return
      }
      setTimeout(tryOnce, 1000)
    }
    tryOnce()
  })
}

if (isDirectRun) {
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))

  const apiEnv = { ...process.env, PORT: String(apiPort), BIND_HOST: '127.0.0.1' }
  start(process.execPath, [join(root, 'server/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], join(root, 'server'), apiEnv)
  start(
    process.execPath,
    [join(root, 'site/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(nextPort)],
    join(root, 'site'),
    process.env,
  )

  try {
    await waitFor(apiPort, '/health')
    await waitFor(nextPort, '/')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    shutdown(1)
  }

  const server = createServer(handleRequest)
  server.listen(publicPort, '0.0.0.0', () => {
    console.log(`listening on ${publicPort}`)
  })
}

export { handleRequest }
