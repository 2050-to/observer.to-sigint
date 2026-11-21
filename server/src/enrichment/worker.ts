import type { DeviceEnrichment } from '../types.js'
import type { Store } from '../store.js'
import type { EnrichmentInput } from './input.js'

export interface EnrichmentResearcher {
  enrich(input: EnrichmentInput): Promise<DeviceEnrichment>
}

export interface EnrichmentWorkerOptions {
  idleDelayMs?: number
  refreshDays?: number
  maxAttempts?: number
  backfillIntervalMs?: number
}

export class EnrichmentWorker {
  private running = false
  private loopPromise: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private wake: (() => void) | null = null
  private lastBackfill = 0
  private readonly idleDelayMs: number
  private readonly refreshDays: number
  private readonly maxAttempts: number
  private readonly backfillIntervalMs: number

  constructor(
    private readonly store: Store,
    private readonly researcher: EnrichmentResearcher,
    options: EnrichmentWorkerOptions = {},
  ) {
    this.idleDelayMs = finite(options.idleDelayMs, 3000, 250)
    this.refreshDays = finite(options.refreshDays, 30, 1)
    this.maxAttempts = finite(options.maxAttempts, 4, 1)
    this.backfillIntervalMs = finite(options.backfillIntervalMs, 6 * 60 * 60 * 1000, 60_000)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loopPromise = this.run()
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.wake?.()
    this.wake = null
    await this.loopPromise
    this.loopPromise = null
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        if (Date.now() - this.lastBackfill >= this.backfillIntervalMs) {
          await this.store.enqueueEnrichmentBackfill()
          this.lastBackfill = Date.now()
        }
        const job = await this.store.claimEnrichmentJob()
        if (!job) {
          await this.wait(this.idleDelayMs)
          continue
        }
        try {
          const enrichment = await this.researcher.enrich(job.input)
          await this.store.completeEnrichmentJob(job.lookupHmac, enrichment, this.refreshDays)
        } catch (error) {
          await this.store.failEnrichmentJob(job.lookupHmac, job.attempts, error, this.maxAttempts)
        }
      } catch {
        console.error('device enrichment worker failed')
        await this.wait(this.idleDelayMs)
      }
    }
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve
      this.timer = setTimeout(() => {
        this.timer = null
        this.wake = null
        resolve()
      }, milliseconds)
    })
  }
}

function finite(value: number | undefined, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Number(value)) : fallback
}
