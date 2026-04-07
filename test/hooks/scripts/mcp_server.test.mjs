// test/hooks/scripts/mcp_server.test.mjs
// Tests for the MCP JSON-RPC protocol handler.
// We can't easily test the full mcp_server.mjs (it calls startServer at module
// level), so we extract and test the handleMessage logic via a thin wrapper
// that captures stdout writes.
import { describe, it, expect, beforeEach } from 'vitest'

// The MCP server writes JSON-RPC to stdout. We simulate this by reimplementing
// handleMessage here (same logic as mcp_server.mjs) and testing the protocol.
// This avoids needing Docker running for unit tests.

const sent = []

function send(obj) {
  sent.push(obj)
}

function handleMessage(msg) {
  const { method, id } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: {},
        serverInfo: {
          name: 'agents-observe',
          version: '0.8.0',
        },
      },
    })
    return
  }

  if (method === 'notifications/initialized') return

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [] } })
    return
  }
  if (method === 'resources/list') {
    send({ jsonrpc: '2.0', id, result: { resources: [] } })
    return
  }
  if (method === 'prompts/list') {
    send({ jsonrpc: '2.0', id, result: { prompts: [] } })
    return
  }

  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

beforeEach(() => {
  sent.length = 0
})

describe('MCP JSON-RPC protocol', () => {
  describe('initialize', () => {
    it('responds with server info and capabilities', () => {
      handleMessage({
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'claude-code', version: '2.1.92' },
        },
        jsonrpc: '2.0',
        id: 0,
      })

      expect(sent).toHaveLength(1)
      const resp = sent[0]
      expect(resp.jsonrpc).toBe('2.0')
      expect(resp.id).toBe(0)
      expect(resp.result.protocolVersion).toBe('2025-11-25')
      expect(resp.result.serverInfo.name).toBe('agents-observe')
      expect(resp.result.serverInfo.version).toBe('0.8.0')
      expect(resp.result.capabilities).toEqual({})
    })

    it('uses default protocol version when not provided', () => {
      handleMessage({ method: 'initialize', jsonrpc: '2.0', id: 1 })

      expect(sent[0].result.protocolVersion).toBe('2024-11-05')
    })

    it('preserves the request id', () => {
      handleMessage({ method: 'initialize', jsonrpc: '2.0', id: 42 })
      expect(sent[0].id).toBe(42)
    })
  })

  describe('notifications/initialized', () => {
    it('does not send a response (notification)', () => {
      handleMessage({ method: 'notifications/initialized', jsonrpc: '2.0' })
      expect(sent).toHaveLength(0)
    })
  })

  describe('tools/list', () => {
    it('returns empty tools array', () => {
      handleMessage({ method: 'tools/list', jsonrpc: '2.0', id: 1 })
      expect(sent[0].result).toEqual({ tools: [] })
    })
  })

  describe('resources/list', () => {
    it('returns empty resources array', () => {
      handleMessage({ method: 'resources/list', jsonrpc: '2.0', id: 2 })
      expect(sent[0].result).toEqual({ resources: [] })
    })
  })

  describe('prompts/list', () => {
    it('returns empty prompts array', () => {
      handleMessage({ method: 'prompts/list', jsonrpc: '2.0', id: 3 })
      expect(sent[0].result).toEqual({ prompts: [] })
    })
  })

  describe('unknown methods', () => {
    it('returns method-not-found error for unknown request', () => {
      handleMessage({ method: 'tools/call', jsonrpc: '2.0', id: 4 })

      expect(sent).toHaveLength(1)
      expect(sent[0].error.code).toBe(-32601)
      expect(sent[0].error.message).toContain('tools/call')
      expect(sent[0].id).toBe(4)
    })

    it('ignores unknown notifications (no id)', () => {
      handleMessage({ method: 'unknown/notification', jsonrpc: '2.0' })
      expect(sent).toHaveLength(0)
    })
  })

  describe('protocol compliance', () => {
    it('all responses include jsonrpc 2.0', () => {
      handleMessage({ method: 'initialize', jsonrpc: '2.0', id: 0 })
      handleMessage({ method: 'tools/list', jsonrpc: '2.0', id: 1 })
      handleMessage({ method: 'resources/list', jsonrpc: '2.0', id: 2 })
      handleMessage({ method: 'prompts/list', jsonrpc: '2.0', id: 3 })
      handleMessage({ method: 'unknown', jsonrpc: '2.0', id: 4 })

      expect(sent).toHaveLength(5)
      for (const msg of sent) {
        expect(msg.jsonrpc).toBe('2.0')
      }
    })

    it('full handshake sequence works', () => {
      // Simulate the Claude Code MCP handshake
      handleMessage({
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: { roots: {}, elicitation: {} }, clientInfo: { name: 'claude-code' } },
        jsonrpc: '2.0',
        id: 0,
      })
      handleMessage({ method: 'notifications/initialized', jsonrpc: '2.0' })
      handleMessage({ method: 'tools/list', jsonrpc: '2.0', id: 1 })

      expect(sent).toHaveLength(2) // initialize response + tools/list response
      expect(sent[0].result.serverInfo.name).toBe('agents-observe')
      expect(sent[1].result.tools).toEqual([])
    })
  })
})
