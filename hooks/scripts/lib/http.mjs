// hooks/scripts/lib/http.mjs
// HTTP helpers for Agents Observe. No dependencies - Node.js built-ins only.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

export function httpRequest(url, options, body) {
  const parsed = new URL(url)
  const transport = parsed.protocol === 'https:' ? httpsRequest : request
  const fireAndForget = options.fireAndForget || false

  return new Promise((resolve) => {
    const req = transport(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )

    if (fireAndForget) {
      req.on('socket', (socket) => {
        socket.unref()
      })
    }

    req.on('error', (err) => {
      resolve({ status: 0, body: null, error: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: null, error: 'timeout' })
    })
    if (body) req.write(body)
    req.end()
  })
}

export function postJson(url, data, opts = {}) {
  const body = JSON.stringify(data)
  return httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      fireAndForget: opts.fireAndForget || false,
    },
    body,
  )
}

export function getJson(url) {
  return httpRequest(url, { method: 'GET' }, null)
}
