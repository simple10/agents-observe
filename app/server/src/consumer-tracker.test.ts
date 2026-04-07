import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Each test gets a fresh module instance via vi.resetModules() + dynamic import.
// This avoids shared state between tests (the module-level Map, startedAt, etc).

describe('consumer-tracker', () => {
  let tracker: typeof import('./consumer-tracker')
  let websocketMock: { getClientCount: ReturnType<typeof vi.fn> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()

    websocketMock = {
      getClientCount: vi.fn(() => 0),
    }
    vi.doMock('./websocket', () => websocketMock)
    vi.doMock('./config', () => ({
      config: {
        shutdownDelayMs: 30_000,
        consumerTtlMs: 30_000,
        sweepIntervalMs: 10_000,
        startupGraceMs: 60_000,
      },
    }))

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    tracker = await import('./consumer-tracker')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('heartbeat', () => {
    test('registers a consumer and returns count', () => {
      expect(tracker.heartbeat('mcp-1')).toBe(1)
      expect(tracker.getConsumerCount()).toBe(1)
    })

    test('tracks multiple consumers', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.heartbeat('mcp-2')).toBe(2)
      expect(tracker.getConsumerCount()).toBe(2)
    })

    test('refreshes existing consumer without incrementing count', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.heartbeat('mcp-1')).toBe(1)
    })
  })

  describe('deregister', () => {
    test('removes a consumer and returns counts', () => {
      tracker.heartbeat('mcp-1')
      tracker.heartbeat('mcp-2')
      websocketMock.getClientCount.mockReturnValue(3)

      const result = tracker.deregister('mcp-1')
      expect(result).toEqual({ activeConsumers: 1, activeClients: 3 })
      expect(tracker.getConsumerCount()).toBe(1)
    })

    test('deregistering unknown id is a no-op', () => {
      tracker.heartbeat('mcp-1')
      const result = tracker.deregister('mcp-unknown')
      expect(result.activeConsumers).toBe(1)
    })
  })

  describe('checkShutdown', () => {
    test('does not shut down during startup grace period', () => {
      // Time hasn't advanced past the 60s grace period
      tracker.checkShutdown()
      vi.advanceTimersByTime(500)
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test('shuts down after grace period + shutdown delay when no consumers or clients', () => {
      vi.advanceTimersByTime(61_000) // past startup grace period
      tracker.checkShutdown()
      vi.advanceTimersByTime(30_000) // shutdown delay (30s)
      expect(exitSpy).toHaveBeenCalledWith(0)
    })

    test('does not shut down when consumers are active', () => {
      vi.advanceTimersByTime(61_000)
      tracker.heartbeat('mcp-1')
      tracker.checkShutdown()
      vi.advanceTimersByTime(500)
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test('does not shut down when WS clients are connected', () => {
      vi.advanceTimersByTime(61_000)
      websocketMock.getClientCount.mockReturnValue(1)
      tracker.checkShutdown()
      vi.advanceTimersByTime(500)
      expect(exitSpy).not.toHaveBeenCalled()
    })
  })

  describe('checkShutdown — auto-shutdown disabled', () => {
    beforeEach(async () => {
      vi.resetModules()
      vi.doMock('./websocket', () => ({
        getClientCount: vi.fn(() => 0),
      }))
      vi.doMock('./config', () => ({
        config: {
          shutdownDelayMs: 0,
          consumerTtlMs: 30_000,
          sweepIntervalMs: 10_000,
          startupGraceMs: 60_000,
        },
      }))
      tracker = await import('./consumer-tracker')
    })

    test('does not shut down when shutdownDelayMs is 0', () => {
      vi.advanceTimersByTime(61_000)
      tracker.checkShutdown()
      vi.advanceTimersByTime(500)
      expect(exitSpy).not.toHaveBeenCalled()
    })
  })

  describe('sweep', () => {
    test('evicts consumers that exceed TTL', () => {
      tracker.heartbeat('mcp-1')
      expect(tracker.getConsumerCount()).toBe(1)

      // Advance past the 30s TTL
      vi.advanceTimersByTime(31_000)

      // Start sweep — it runs on an interval
      tracker.startConsumerSweep()
      vi.advanceTimersByTime(10_000) // trigger one sweep cycle

      expect(tracker.getConsumerCount()).toBe(0)
    })

    test('does not evict consumers with recent heartbeats', () => {
      tracker.startConsumerSweep()
      tracker.heartbeat('mcp-1')

      // Advance less than TTL
      vi.advanceTimersByTime(15_000)
      tracker.heartbeat('mcp-1') // refresh

      vi.advanceTimersByTime(15_000) // 30s total but heartbeat was refreshed at 15s

      expect(tracker.getConsumerCount()).toBe(1)
    })
  })

  describe('deregister triggers shutdown', () => {
    test('shutting down after last consumer deregisters (after shutdown delay)', () => {
      vi.advanceTimersByTime(61_000)
      tracker.heartbeat('mcp-1')
      tracker.deregister('mcp-1')
      vi.advanceTimersByTime(30_000) // shutdown delay
      expect(exitSpy).toHaveBeenCalledWith(0)
    })

    test('shutdown cancelled if client reconnects during delay', () => {
      vi.advanceTimersByTime(61_000)
      tracker.heartbeat('mcp-1')
      tracker.deregister('mcp-1')
      vi.advanceTimersByTime(5_000) // 5s into the 30s delay
      websocketMock.getClientCount.mockReturnValue(1) // client reconnects
      tracker.cancelPendingShutdown()
      vi.advanceTimersByTime(30_000) // well past the original delay
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test('no shutdown when other consumers remain', () => {
      vi.advanceTimersByTime(61_000)
      tracker.heartbeat('mcp-1')
      tracker.heartbeat('mcp-2')
      tracker.deregister('mcp-1')
      vi.advanceTimersByTime(500)
      expect(exitSpy).not.toHaveBeenCalled()
    })
  })
})
