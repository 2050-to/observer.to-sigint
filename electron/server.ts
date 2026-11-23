import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Agent, RequestOptions } from 'node:https'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

export function listen(rootDir: string, apiOrigin: string, agent: Agent): Promise<{ port: number; close: () => Promise<void> }> {
  const root = resolve(rootDir)
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/api')) {
      proxy(req, res, apiOrigin, url, agent)
      return
    }
    serve(root, url.pathname, res)
  })
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolveListen({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function serve(root: string, pathname: string, res: ServerResponse): void {
  const decoded = decodeURIComponent(pathname)
  const requested = normalize(join(root, decoded))
  if (!requested.startsWith(root)) {
    res.writeHead(403)
    res.end()
    return
  }
  const file = existsSync(requested) && statSync(requested).isFile() ? requested : join(root, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

function proxy(req: IncomingMessage, res: ServerResponse, origin: string, url: URL, agent: Agent): void {
  const target = new URL(url.pathname + url.search, origin)
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = { ...req.headers, host: target.host }
    delete headers['transfer-encoding']
    const options: RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: target.pathname + target.search,
      headers,
      agent,
      ...(target.hostname === '127.0.0.1' || target.hostname === 'localhost' ? { servername: 'localhost' } : {}),
    }
    const outbound = (target.protocol === 'https:' ? httpsRequest : httpRequest)(options, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers)
      upstream.pipe(res)
    })
    outbound.on('error', (error: Error) => {
      if (res.headersSent) {
        res.end()
        return
      }
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    })
    outbound.end(body)
  })
}
