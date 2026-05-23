import { promises as fsp, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelPricing } from './types'
import { config } from '../config'

export type { ModelPricing } from './types'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const CACHE_FILENAME = 'models-dev.json'

interface CacheState {
  byModel: Record<string, ModelPricing>
  fetchedAt: number
}

let memCache: CacheState | null = null
let inFlight: Promise<Record<string, ModelPricing>> | null = null

function cachePath(): string {
  return join(config.dataDir, CACHE_FILENAME)
}

/**
 * Returns a model-id → pricing map covering every provider models.dev
 * exposes (anthropic, openai, etc.). Cached for 24 hours, with the
 * raw api.json persisted to `${dataDir}/models-dev.json` so a fresh
 * server start can serve pricing without a network round-trip.
 *
 * Resolution order:
 *   1. In-memory cache if fresh (< 24h).
 *   2. Disk cache if fresh.
 *   3. Fetch from models.dev → write disk → in-memory.
 *   4. On fetch failure: stale disk cache if any.
 *   5. Empty map (never throws).
 */
export async function getModelsPricing(): Promise<Record<string, ModelPricing>> {
  const now = Date.now()
  if (memCache && now - memCache.fetchedAt < TTL_MS) {
    return memCache.byModel
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    // Try disk first — survives process restarts cheaply.
    const fromDisk = await readDiskCache()
    if (fromDisk && now - fromDisk.fetchedAt < TTL_MS) {
      memCache = fromDisk
      return fromDisk.byModel
    }

    // Stale or missing — refetch.
    try {
      const res = await fetch(MODELS_DEV_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      await writeDiskCache(body)
      const byModel = extractAllPricing(body)
      memCache = { byModel, fetchedAt: Date.now() }
      return byModel
    } catch (err) {
      console.warn('[models-pricing] fetch failed:', err)
      // Fall back to whatever's on disk, even if stale.
      if (fromDisk) {
        memCache = fromDisk
        return fromDisk.byModel
      }
      // Or whatever we had in memory before this attempt.
      return memCache?.byModel ?? {}
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function readDiskCache(): Promise<CacheState | null> {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const stat = await fsp.stat(path)
    const raw = await fsp.readFile(path, 'utf8')
    const body = JSON.parse(raw)
    return { byModel: extractAllPricing(body), fetchedAt: stat.mtimeMs }
  } catch (err) {
    console.warn('[models-pricing] disk cache read failed:', err)
    return null
  }
}

async function writeDiskCache(body: unknown): Promise<void> {
  const path = cachePath()
  try {
    await fsp.mkdir(config.dataDir, { recursive: true })
    await fsp.writeFile(path, JSON.stringify(body), 'utf8')
  } catch (err) {
    // Disk write is best-effort — pricing still works from memory if
    // the data dir isn't writable for some reason.
    console.warn('[models-pricing] disk cache write failed:', err)
  }
}

/**
 * Walk every top-level provider in the api.json response and extract
 * pricing for any model that has a `cost` block. Claude allows
 * third-party model providers, and codex uses openai — so we don't
 * filter by provider name, just by presence of cost data.
 *
 * The api.json shape: `{ <providerSlug>: { models: { <modelId>: { cost: { input, output, cache_read?, cache_write? } } } } }`.
 *
 * **Provider priority matters.** models.dev lists the same model id
 * under many providers (anthropic, plus resellers like helicone /
 * 302ai / qihang-ai / etc.). Reseller prices vary wildly. To avoid
 * an arbitrary reseller's price clobbering the canonical one, we
 * iterate `anthropic` and `openai` first and use first-write-wins;
 * other providers fill in models the canonicals don't list.
 *
 * Cache write / 5m / 1h: models.dev currently exposes one rate
 * (`cache_write` or `cache_creation`); we copy it into both 5m and 1h
 * fields. Providers without a cache_write rate get 0. OpenAI never
 * bills cache_write.
 */
export function extractAllPricing(body: unknown): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {}
  if (!body || typeof body !== 'object') return out

  const root = body as Record<string, unknown>
  const allProviders = Object.keys(root)
  // Canonical-first ordering: anthropic + openai (the providers we
  // ship support for) win when the same model id appears in multiple
  // sections. Everything else fills in remaining ids.
  const ordered = [
    ...['anthropic', 'openai'].filter((p) => p in root),
    ...allProviders.filter((p) => p !== 'anthropic' && p !== 'openai'),
  ]

  for (const providerKey of ordered) {
    const provider = root[providerKey]
    if (!provider || typeof provider !== 'object') continue
    const models = (provider as Record<string, unknown>).models
    if (!models || typeof models !== 'object') continue
    for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
      if (typeof id !== 'string' || !id) continue
      if (id in out) continue // first-write-wins
      const cost = (raw as any)?.cost
      if (!cost) continue
      const inputPerM = Number(cost.input ?? 0)
      const outputPerM = Number(cost.output ?? 0)
      const cacheReadPerM = Number(cost.cache_read ?? 0)
      const cacheWritePerM = Number(cost.cache_write ?? cost.cache_creation ?? 0)
      out[id] = {
        inputPerM,
        outputPerM,
        cacheReadPerM,
        cacheCreate5mPerM: cacheWritePerM,
        cacheCreate1hPerM: cacheWritePerM,
      }
    }
  }
  return out
}

/** Test-only: force the next call to re-resolve (disk + network). */
export function _testForceExpiry(): void {
  if (memCache) memCache.fetchedAt = 0
}

/** Test-only: reset everything (in-memory + in-flight). Does NOT touch disk. */
export function _testReset(): void {
  memCache = null
  inFlight = null
}
