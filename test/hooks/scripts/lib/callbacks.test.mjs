// test/callbacks.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'

import {
  handleCallbackRequests,
  ALL_CALLBACK_HANDLERS,
} from '../../../../hooks/scripts/lib/callbacks.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, baseOrigin: `http://127.0.0.1:${port}` })
    })
  })
}

describe('ALL_CALLBACK_HANDLERS', () => {
  it('includes getSessionInfo', () => {
    expect(ALL_CALLBACK_HANDLERS).toContain('getSessionInfo')
  })
})

describe('handleCallbackRequests', () => {
  it('warns on non-array requests', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin: '' }
    await handleCallbackRequests('not an array', { config, log })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('must be an array'))
  })

  it('skips handlers not in allowedCallbacks', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(), baseOrigin: '' }
    await handleCallbackRequests([{ cmd: 'getSessionInfo', args: {} }], { config, log })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Blocked callback'))
  })

  it('warns on unknown handler', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(['nonexistent']), baseOrigin: '' }
    await handleCallbackRequests([{ cmd: 'nonexistent', args: {} }], { config, log })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('No handler'))
  })

  it('handles empty requests array', async () => {
    const log = makeLog()
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin: '' }
    await handleCallbackRequests([], { config, log })
    expect(log.debug).toHaveBeenCalledWith('Processing 0 callback request(s)')
  })
})

describe('getSessionInfo callback dispatch', () => {
  let testDir

  function setup() {
    testDir = join(tmpdir(), `callbacks-test-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
    return testDir
  }

  function cleanup() {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  it('dispatches to the claude-code lib when agentClass=claude-code', async () => {
    setup()
    const transcriptPath = join(testDir, 'transcript.jsonl')
    writeFileSync(transcriptPath, '{"type":"system"}\n{"slug":"my-slug","gitBranch":"main"}\n')

    const log = makeLog()
    const received = []
    const { server, baseOrigin } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        received.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    await handleCallbackRequests(
      [
        {
          cmd: 'getSessionInfo',
          callback: '/api/callbacks/session-info/s1',
          args: {
            transcript_path: transcriptPath,
            agentClass: 'claude-code',
            cwd: '/tmp/x',
          },
        },
      ],
      { config, log },
    )

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      slug: 'my-slug',
      git: { branch: 'main', repository_url: null },
    })
    server.close()
    cleanup()
  })

  it('dispatches to the codex lib when agentClass=codex', async () => {
    setup()
    const transcriptPath = join(testDir, 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'session_meta',
        payload: {
          git: { branch: 'feat/x', repository_url: 'git@github.com:ex/r.git' },
        },
      }) + '\n',
    )

    const log = makeLog()
    const received = []
    const { server, baseOrigin } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        received.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    await handleCallbackRequests(
      [
        {
          cmd: 'getSessionInfo',
          callback: '/api/callbacks/session-info/s1',
          args: {
            transcript_path: transcriptPath,
            agentClass: 'codex',
          },
        },
      ],
      { config, log },
    )

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      slug: null,
      git: { branch: 'feat/x', repository_url: 'git@github.com:ex/r.git' },
    })
    server.close()
    cleanup()
  })

  it('returns null when agentClass is unknown (no dispatch, no POST)', async () => {
    const log = makeLog()
    let posted = 0
    const { server, baseOrigin } = await startTestServer((_req, res) => {
      posted++
      res.writeHead(200)
      res.end()
    })
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    await handleCallbackRequests(
      [
        {
          cmd: 'getSessionInfo',
          callback: '/api/callbacks/session-info/s1',
          args: { transcript_path: '/tmp/x.jsonl', agentClass: 'not-a-real-agent' },
        },
      ],
      { config, log },
    )

    expect(posted).toBe(0)
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('no agent handler'))
    server.close()
  })
})
