import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dnsCaptureFilter, fromThisHost, localIpv4, parseDnsLine } from '../shared/dns.js'

interface DnsItem {
  observedAt: string
  name: string
  type: string
  rcode: null
}

export class DnsCapture {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private queue: DnsItem[] = []
  private local: string[] = []
  private apiUrl = ''
  private token = ''
  private ca: string | null = null
  running = false
  message = 'DNS recording is stopped.'

  start(options: { apiUrl: string; token: string; ca: string | null }): { running: boolean; message: string } {
    this.stop()
    this.apiUrl = options.apiUrl
    this.token = options.token
    this.ca = options.ca
    this.local = localIpv4(networkInterfaces())
    let filter = ''
    try {
      filter = dnsCaptureFilter(this.local)
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'DNS recording could not start.'
      return this.status()
    }
    const child = spawn('tcpdump', ['-n', '-l', '-p', '-tt', ...filter.split(' ')], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.running = true
    this.message = 'Recording this Mac\'s own DNS lookups. Encrypted DNS is not visible.'
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) this.take(line)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (/permission|operation not permitted|cannot open|You don.t have permission/i.test(chunk)) {
        this.message = 'DNS recording needs permission to read this Mac\'s own packets. Encrypted DNS is not recorded.'
        this.running = false
      }
    })
    child.on('error', () => {
      this.running = false
      this.child = null
      this.message = 'tcpdump is not available, so this Mac\'s DNS lookups are not being recorded.'
    })
    child.on('exit', () => {
      if (this.child === child) {
        this.child = null
        this.running = false
      }
    })
    this.timer = setInterval(() => {
      void this.flush()
    }, 2000)
    return this.status()
  }

  stop(): { running: boolean; message: string } {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.child?.kill('SIGTERM')
    this.child = null
    this.running = false
    this.queue = []
    this.message = 'DNS recording is stopped.'
    return this.status()
  }

  status(): { running: boolean; message: string } {
    return { running: this.running, message: this.message }
  }

  private take(line: string): void {
    const parsed = parseDnsLine(line)
    if (!parsed || !fromThisHost(parsed.src, this.local)) return
    this.queue.push({ observedAt: new Date().toISOString(), name: parsed.name, type: parsed.type, rcode: null })
    if (this.queue.length >= 50) void this.flush()
  }

  private flush(): Promise<void> {
    const batch = this.queue.splice(0, 50)
    if (batch.length === 0 || !this.token) return Promise.resolve()
    let target: URL
    try {
      target = new URL('/api/dns', this.apiUrl)
    } catch {
      return Promise.resolve()
    }
    const payload = Buffer.from(JSON.stringify({ queries: batch }))
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve) => {
      const req = transport({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
        servername: 'localhost',
        ca: this.ca ? readFileSync(this.ca) : undefined,
        rejectUnauthorized: true,
        timeout: 15000,
      }, (res) => {
        res.resume()
        if ((res.statusCode ?? 500) >= 300 && this.running) {
          this.message = 'DNS lookups were seen, but they could not be saved yet.'
        }
        resolve()
      })
      req.on('error', () => resolve())
      req.on('timeout', () => {
        req.destroy()
        resolve()
      })
      req.end(payload)
    })
  }
}
