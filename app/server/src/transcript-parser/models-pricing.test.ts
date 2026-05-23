import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODELS_DEV_FIXTURE = {
  anthropic: {
    models: {
      'claude-opus-4-7': {
        id: 'claude-opus-4-7',
        cost: { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
      },
    },
  },
  openai: {
    models: {
      'gpt-5.4': {
        id: 'gpt-5.4',
        cost: { input: 5, output: 15, cache_read: 0.5 },
      },
      'gpt-4o': {
        id: 'gpt-4o',
        cost: { input: 5, output: 15 },
      },
    },
  },
  // Defensive: providers without `models` or without `cost` get skipped.
  'no-models-provider': {},
}

let tmpDir = ''

beforeEach(async () => {
  vi.resetModules()
  // Isolate the on-disk cache to a fresh tmp dir per test.
  tmpDir = mkdtempSync(join(tmpdir(), 'models-pricing-'))
  process.env.AGENTS_OBSERVE_DATA_DIR = tmpDir
})

afterEach(() => {
  delete process.env.AGENTS_OBSERVE_DATA_DIR
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

describe('getModelsPricing', () => {
  test('extracts models from every provider, not just anthropic', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toBeDefined()
    expect(map['claude-haiku-4-5']).toBeDefined()
    // GPT models now appear too — codex sessions use them.
    expect(map['gpt-5.4']).toBeDefined()
    expect(map['gpt-4o']).toBeDefined()
  })

  test('parses per-million-token rates correctly (claude with cache_write)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toEqual({
      inputPerM: 15,
      outputPerM: 75,
      cacheReadPerM: 1.5,
      cacheCreate5mPerM: 18.75,
      cacheCreate1hPerM: 18.75,
    })
  })

  test('non-anthropic providers without cache_write get 0 for cache write fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['gpt-5.4']).toEqual({
      inputPerM: 5,
      outputPerM: 15,
      cacheReadPerM: 0.5,
      cacheCreate5mPerM: 0,
      cacheCreate1hPerM: 0,
    })
    expect(map['gpt-4o']).toEqual({
      inputPerM: 5,
      outputPerM: 15,
      cacheReadPerM: 0,
      cacheCreate5mPerM: 0,
      cacheCreate1hPerM: 0,
    })
  })

  test('writes raw api.json to disk for reuse across restarts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    const { getModelsPricing } = await import('./models-pricing')
    await getModelsPricing()
    const cacheFile = join(tmpDir, 'models-dev.json')
    expect(existsSync(cacheFile)).toBe(true)
    const written = JSON.parse(readFileSync(cacheFile, 'utf8'))
    expect(written).toEqual(MODELS_DEV_FIXTURE)
  })

  test('second call within TTL is served from memory (no re-fetch)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE })
    vi.stubGlobal('fetch', fetchSpy)
    const { getModelsPricing } = await import('./models-pricing')
    await getModelsPricing()
    await getModelsPricing()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('fresh process boot reads disk cache without re-fetching', async () => {
    // First boot: warm up disk.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    {
      const { getModelsPricing } = await import('./models-pricing')
      await getModelsPricing()
    }
    // Simulate process restart by resetting modules; disk cache survives.
    vi.resetModules()
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE })
    vi.stubGlobal('fetch', fetchSpy)
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toBeDefined()
    // Disk cache was fresh — should NOT have called fetch on restart.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('fetch failure with empty cache (no disk, no memory) returns empty map', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map).toEqual({})
  })

  test('fetch failure falls back to stale disk cache', async () => {
    // Warm disk with one fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => MODELS_DEV_FIXTURE }),
    )
    {
      const { getModelsPricing } = await import('./models-pricing')
      await getModelsPricing()
    }
    // Simulate restart + age the disk cache so it falls past the TTL
    // window, AND make fetch fail.
    vi.resetModules()
    const oldTime = Date.now() - 48 * 60 * 60 * 1000 // 48h ago
    const cacheFile = join(tmpDir, 'models-dev.json')
    const fs = await import('node:fs')
    fs.utimesSync(cacheFile, new Date(oldTime), new Date(oldTime))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { getModelsPricing } = await import('./models-pricing')
    const map = await getModelsPricing()
    expect(map['claude-opus-4-7']).toBeDefined()
  })
})

describe('extractAllPricing (pure)', () => {
  test('handles malformed input gracefully', async () => {
    const { extractAllPricing } = await import('./models-pricing')
    expect(extractAllPricing(null)).toEqual({})
    expect(extractAllPricing(undefined)).toEqual({})
    expect(extractAllPricing('string')).toEqual({})
    expect(extractAllPricing({})).toEqual({})
    expect(extractAllPricing({ anthropic: null })).toEqual({})
    expect(extractAllPricing({ anthropic: { models: null } })).toEqual({})
  })

  test('canonical-first ordering: anthropic wins over resellers for claude- ids', async () => {
    // models.dev lists the same claude model under many provider
    // sections (helicone, abacus, qihang-ai, etc.). Whichever JSON
    // object key order falls last would otherwise win — even if it's
    // a reseller quoting wildly different prices. We need the
    // canonical anthropic entry.
    const { extractAllPricing } = await import('./models-pricing')
    const result = extractAllPricing({
      // Reseller listed FIRST in iteration order — without the fix,
      // anthropic's entry would clobber it. We want the OPPOSITE: the
      // first-write-wins anthropic entry should survive even when
      // resellers come later.
      'qihang-ai': {
        models: {
          'claude-haiku-4-5-20251001': {
            cost: { input: 0.14, output: 0.71 },
          },
        },
      },
      anthropic: {
        models: {
          'claude-haiku-4-5-20251001': {
            cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
          },
        },
      },
      helicone: {
        models: {
          'claude-haiku-4-5-20251001': {
            cost: { input: 999, output: 999 },
          },
        },
      },
    })
    expect(result['claude-haiku-4-5-20251001']).toEqual({
      inputPerM: 1,
      outputPerM: 5,
      cacheReadPerM: 0.1,
      cacheCreate5mPerM: 1.25,
      cacheCreate1hPerM: 1.25,
    })
  })

  test('canonical-first ordering: openai wins over resellers for gpt- ids', async () => {
    const { extractAllPricing } = await import('./models-pricing')
    const result = extractAllPricing({
      cheap_reseller: {
        models: { 'gpt-5.4': { cost: { input: 0.01, output: 0.01 } } },
      },
      openai: {
        models: { 'gpt-5.4': { cost: { input: 2.5, output: 15, cache_read: 0.25 } } },
      },
    })
    expect(result['gpt-5.4']).toEqual({
      inputPerM: 2.5,
      outputPerM: 15,
      cacheReadPerM: 0.25,
      cacheCreate5mPerM: 0,
      cacheCreate1hPerM: 0,
    })
  })

  test('non-canonical models still resolve from third-party providers', async () => {
    const { extractAllPricing } = await import('./models-pricing')
    const result = extractAllPricing({
      anthropic: { models: { 'claude-opus-4-7': { cost: { input: 5, output: 25 } } } },
      cohere: { models: { 'command-r-plus': { cost: { input: 3, output: 15 } } } },
    })
    expect(result['claude-opus-4-7']).toBeDefined()
    expect(result['command-r-plus']).toEqual({
      inputPerM: 3,
      outputPerM: 15,
      cacheReadPerM: 0,
      cacheCreate5mPerM: 0,
      cacheCreate1hPerM: 0,
    })
  })

  test('skips models without a cost block', async () => {
    const { extractAllPricing } = await import('./models-pricing')
    const result = extractAllPricing({
      anthropic: {
        models: {
          'has-cost': { cost: { input: 1, output: 2 } },
          'no-cost': {},
          'null-cost': { cost: null },
        },
      },
    })
    expect(Object.keys(result)).toEqual(['has-cost'])
  })
})
