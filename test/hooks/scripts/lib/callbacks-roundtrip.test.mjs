// test/hooks/scripts/lib/callbacks-roundtrip.test.mjs
//
// End-to-end shape coverage of the server -> CLI -> callback round trip.
//
// The server's POST /api/events emits a `requests` array carrying a
// `name`, `callback` URL, and `args` (with camelCase keys per the
// three-layer spec). The CLI's handleCallbackRequests dispatches each
// request to the matching agent lib's getSessionInfo and POSTs the
// result back to the callback URL. This test pins that round trip with
// the canonical (post-Phase-4) wire shape so accidental drift between
// server and CLI is caught quickly.
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

describe('callbacks round-trip — server-emitted shape (name + transcriptPath)', () => {
  it('dispatches a server-shaped getSessionInfo request and posts back the slug+git', async () => {
    const dir = join(tmpdir(), `cb-roundtrip-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    const transcriptPath = join(dir, 'transcript.jsonl')
    writeFileSync(transcriptPath, '{"slug":"my-session","gitBranch":"feat/x"}\n')

    const log = makeLog()
    const received = []
    const { server, baseOrigin } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        received.push({ url: req.url, body: JSON.parse(body) })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    // The server emits requests in this exact shape today (see
    // app/server/src/routes/events.ts step 7).
    await handleCallbackRequests(
      [
        {
          name: 'getSessionInfo',
          callback: '/api/callbacks/session-info/sess-1',
          args: {
            transcriptPath, // server uses camelCase
            agentClass: 'claude-code',
          },
        },
      ],
      { config, log },
    )

    expect(received).toHaveLength(1)
    expect(received[0].url).toBe('/api/callbacks/session-info/sess-1')
    expect(received[0].body).toEqual({
      slug: 'my-session',
      git: { branch: 'feat/x', repository_url: null },
      // Mirrored back from the request args so the server can correlate.
      agentClass: 'claude-code',
      cwd: null,
    })

    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('default agent lib handler returns null and skips the POST', async () => {
    const log = makeLog()
    let posted = 0
    const { server, baseOrigin } = await startTestServer((_req, res) => {
      posted++
      res.writeHead(200)
      res.end()
    })
    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    // The "default" agent class doesn't know how to read transcripts; the
    // dispatcher should call getSessionInfo (which returns null) and not
    // POST anything to the callback URL.
    await handleCallbackRequests(
      [
        {
          name: 'getSessionInfo',
          callback: '/api/callbacks/session-info/sess-1',
          args: { transcriptPath: '/tmp/whatever.jsonl', agentClass: 'default' },
        },
      ],
      { config, log },
    )

    expect(posted).toBe(0)
    server.close()
  })

  it('still accepts the legacy `cmd` key alongside the new `name` key', async () => {
    const dir = join(tmpdir(), `cb-roundtrip-legacy-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    const transcriptPath = join(dir, 'transcript.jsonl')
    writeFileSync(transcriptPath, '{"slug":"legacy-shape","gitBranch":"main"}\n')

    const log = makeLog()
    const received = []
    const { server, baseOrigin } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        received.push(JSON.parse(body))
        res.writeHead(200)
        res.end()
      })
    })

    const config = { allowedCallbacks: new Set(ALL_CALLBACK_HANDLERS), baseOrigin }

    await handleCallbackRequests(
      [
        {
          cmd: 'getSessionInfo', // legacy field name
          callback: '/api/callbacks/session-info/sess-1',
          args: { transcript_path: transcriptPath, agentClass: 'claude-code' },
        },
      ],
      { config, log },
    )

    expect(received).toHaveLength(1)
    expect(received[0].slug).toBe('legacy-shape')

    server.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
