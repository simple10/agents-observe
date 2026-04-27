// test/hooks/scripts/observe_cli.test.mjs
// Integration tests for observe_cli.mjs — runs it as a child process.
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const CLI = resolve(import.meta.dirname, '../../../hooks/scripts/observe_cli.mjs')

function runCli(args, { stdin, env } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [CLI, ...args],
      {
        env: { ...process.env, ...env },
        timeout: 10000,
      },
      (err, stdout, stderr) => {
        resolve({
          code: err?.code ?? 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      },
    )
    if (stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}

function mockApiHandler(responses = {}) {
  const received = []
  return {
    received,
    handler: (req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, body })
        const key = `${req.method} ${req.url}`
        const response = responses[key] || { status: 200, body: { ok: true } }
        res.writeHead(response.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(response.body))
      })
    },
  }
}

describe('observe_cli', () => {
  describe('parseArgs', () => {
    it('shows help with no args', async () => {
      const { stdout } = await runCli(['help'])
      expect(stdout).toContain('Usage:')
      expect(stdout).toContain('hook-sync')
      expect(stdout).toContain('hook-autostart')
      expect(stdout).toContain('db-reset')
    })

    it('exits nonzero on unknown command', async () => {
      const { code, stderr } = await runCli(['nonexistent'])
      expect(code).not.toBe(0)
      expect(stderr).toContain('Unknown command')
    })
  })

  describe('hook command', () => {
    it('POSTs event to server', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'test-1' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        // Give fire-and-forget a moment
        await new Promise((r) => setTimeout(r, 200))
        expect(mock.received.some((r) => r.url === '/api/events')).toBe(true)
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed.payload.hook_event_name).toBe('SessionStart')
        expect(parsed.agentClass).toBe('claude-code')
        expect(parsed.sessionId).toBe('test-1')
      } finally {
        server.close()
      }
    })

    it('adds project slug metadata without mutating hook payload', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'test-2' }),
          env: {
            AGENTS_OBSERVE_API_BASE_URL: `${url}/api`,
            AGENTS_OBSERVE_PROJECT_SLUG: 'my-repo',
          },
        })
        await new Promise((r) => setTimeout(r, 200))
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed._meta.project.slug).toBe('my-repo')
        expect(parsed.payload.project_name).toBeUndefined()
        expect(parsed.payload.hook_event_name).toBe('SessionStart')
      } finally {
        server.close()
      }
    })

    it('sets flags.startsNotification on Notification events', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({ hook_event_name: 'Notification', session_id: 'test-n' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        await new Promise((r) => setTimeout(r, 200))
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed.flags.startsNotification).toBe(true)
        expect(parsed.flags.clearsNotification).toBeUndefined()
      } finally {
        server.close()
      }
    })

    it('dispatches Codex hook payloads when AGENTS_OBSERVE_AGENT_CLASS=codex', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({
            session_id: 'codex-session-1',
            hook_event_name: 'PreToolUse',
            model: 'gpt-5.5',
            turn_id: 'turn-1',
            tool_name: 'Bash',
            tool_use_id: 'tool-1',
            tool_input: { command: 'echo codex' },
          }),
          env: {
            AGENTS_OBSERVE_API_BASE_URL: `${url}/api`,
            AGENTS_OBSERVE_AGENT_CLASS: 'codex',
            AGENTS_OBSERVE_PROJECT_SLUG: 'codex-project',
          },
        })
        await new Promise((r) => setTimeout(r, 200))
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed.agentClass).toBe('codex')
        expect(parsed.hookName).toBe('PreToolUse')
        expect(parsed.sessionId).toBe('codex-session-1')
        expect(parsed.agentId).toBe('codex-session-1')
        expect(parsed.payload.model).toBe('gpt-5.5')
        expect(parsed.payload.turn_id).toBe('turn-1')
        expect(parsed.payload.tool_name).toBe('Bash')
        expect(parsed.payload.tool_use_id).toBe('tool-1')
        expect(parsed._meta.project.slug).toBe('codex-project')
      } finally {
        server.close()
      }
    })

    it('sets flags.clearsNotification on UserPromptSubmit events', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'test-u' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        await new Promise((r) => setTimeout(r, 200))
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed.flags.clearsNotification).toBe(true)
        expect(parsed.flags.startsNotification).toBeUndefined()
      } finally {
        server.close()
      }
    })

    it('leaves ordinary events with no flags object', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        await runCli(['hook'], {
          stdin: JSON.stringify({
            hook_event_name: 'PreToolUse',
            session_id: 'test-p',
            tool_name: 'Bash',
          }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        await new Promise((r) => setTimeout(r, 200))
        const eventReq = mock.received.find((r) => r.url === '/api/events')
        const parsed = JSON.parse(eventReq.body)
        expect(parsed.flags).toBeUndefined()
      } finally {
        server.close()
      }
    })

    it('skips on empty stdin', async () => {
      const { code } = await runCli(['hook'], { stdin: '' })
      expect(code).toBe(0)
    })

    it('handles invalid JSON gracefully', async () => {
      const { code } = await runCli(['hook'], { stdin: 'not json' })
      expect(code).toBe(0)
    })
  })

  describe('hook-sync command', () => {
    it('returns systemMessage JSON when server is reachable', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        const { stdout } = await runCli(['hook-sync'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        const parsed = JSON.parse(stdout)
        expect(parsed.systemMessage).toContain('logging events')
        expect(parsed.systemMessage).toContain('Dashboard')
      } finally {
        server.close()
      }
    })

    it('returns server systemMessage if present in response', async () => {
      const mock = mockApiHandler({
        'POST /api/events': {
          status: 201,
          body: { ok: true, systemMessage: 'Custom server message' },
        },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        const { stdout } = await runCli(['hook-sync'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        const parsed = JSON.parse(stdout)
        expect(parsed.systemMessage).toBe('Custom server message')
      } finally {
        server.close()
      }
    })

    it('returns error systemMessage when server is unreachable', async () => {
      const { stdout } = await runCli(['hook-sync'], {
        stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
        env: { AGENTS_OBSERVE_API_BASE_URL: 'http://127.0.0.1:19999/api' },
      })
      const parsed = JSON.parse(stdout)
      expect(parsed.systemMessage).toContain('not running')
    })

    it('always outputs valid JSON even with empty stdin', async () => {
      const { stdout } = await runCli(['hook-sync'], {
        stdin: '',
        env: { AGENTS_OBSERVE_API_BASE_URL: 'http://127.0.0.1:19999/api' },
      })
      const parsed = JSON.parse(stdout)
      expect(parsed.systemMessage).toBeDefined()
    })

    it('never outputs non-JSON to stdout', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        const { stdout } = await runCli(['hook-sync'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
          env: {
            AGENTS_OBSERVE_API_BASE_URL: `${url}/api`,
            AGENTS_OBSERVE_LOG_LEVEL: 'trace',
          },
        })
        // Every line of stdout must be valid JSON
        for (const line of stdout.split('\n').filter(Boolean)) {
          expect(() => JSON.parse(line)).not.toThrow()
        }
      } finally {
        server.close()
      }
    })
  })

  describe('hook-autostart command', () => {
    it('returns success message when server is already reachable', async () => {
      const mock = mockApiHandler({
        'POST /api/events': { status: 201, body: { ok: true } },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        const { stdout } = await runCli(['hook-autostart'], {
          stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        const parsed = JSON.parse(stdout)
        expect(parsed.systemMessage).toContain('logging events')
      } finally {
        server.close()
      }
    })

    it('skips auto-start when custom API URL is set and unreachable', async () => {
      const { stdout } = await runCli(['hook-autostart'], {
        stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
        env: {
          AGENTS_OBSERVE_API_BASE_URL: 'http://remote-server:9999/api',
          AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT: '1000',
        },
      })
      const parsed = JSON.parse(stdout)
      expect(parsed.systemMessage).toContain('unreachable')
      expect(parsed.systemMessage).toContain('remote-server:9999')
    })

    it('always returns valid JSON even on error', async () => {
      const { stdout } = await runCli(['hook-autostart'], {
        stdin: JSON.stringify({ hook_event_name: 'SessionStart' }),
        env: {
          AGENTS_OBSERVE_API_BASE_URL: 'http://127.0.0.1:19999/api',
          AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT: '1000',
        },
      })
      const parsed = JSON.parse(stdout)
      expect(parsed.systemMessage).toBeDefined()
    })
  })

  describe('health command', () => {
    it('shows health info when server is running', async () => {
      const mock = mockApiHandler({
        'GET /api/health': {
          status: 200,
          body: {
            ok: true,
            id: 'agents-observe',
            version: '0.8.0',
            runtime: 'docker',
            logLevel: 'debug',
            dbPath: '/data/observe.db',
            activeConsumers: 1,
            activeClients: 0,
          },
        },
      })
      const { server, url } = await startMockServer(mock.handler)

      try {
        const { stdout, code } = await runCli(['health'], {
          env: { AGENTS_OBSERVE_API_BASE_URL: `${url}/api` },
        })
        expect(code).toBe(0)
        expect(stdout).toContain('v0.8.0')
        expect(stdout).toContain('Docker')
      } finally {
        server.close()
      }
    })

    it('reports server not running with exit code 1', async () => {
      const { stdout, code } = await runCli(['health'], {
        env: { AGENTS_OBSERVE_API_BASE_URL: 'http://127.0.0.1:19999/api' },
      })
      expect(code).not.toBe(0)
      expect(stdout).toContain('not running')
    })
  })
})
