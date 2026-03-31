// test/http.test.mjs
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'

async function loadHttp() {
  const mod = await import('../hooks/scripts/lib/http.mjs?' + Date.now())
  return mod
}

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('http', () => {
  it('postJson returns response when fireAndForget is false', async () => {
    const { postJson } = await loadHttp()
    const { server, url } = await startTestServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))
      })
    })

    try {
      const result = await postJson(`${url}/test`, { foo: 'bar' })
      expect(result.status).toBe(200)
      expect(result.body.received).toBe(true)
    } finally {
      server.close()
    }
  })

  it('postJson with fireAndForget returns immediately and unrefs socket', async () => {
    const { postJson } = await loadHttp()
    let requestReceived = false
    const { server, url } = await startTestServer((req, res) => {
      requestReceived = true
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    })

    try {
      const result = postJson(`${url}/test`, { foo: 'bar' }, { fireAndForget: true })
      // Returns a promise but we don't need to await it for the process to exit
      expect(result).toBeInstanceOf(Promise)
      // Give it a moment to actually send
      await new Promise((r) => setTimeout(r, 100))
      expect(requestReceived).toBe(true)
    } finally {
      server.close()
    }
  })
})
