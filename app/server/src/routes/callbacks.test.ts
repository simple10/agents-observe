import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

describe('callback routes', () => {
  let app: Hono<Env>
  const updateSessionSlug = vi.fn()
  const patchSessionMetadata = vi.fn()
  const broadcastToAll = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    updateSessionSlug.mockReset()
    patchSessionMetadata.mockReset()
    broadcastToAll.mockReset()

    const { default: callbacksRouter } = await import('./callbacks')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', { updateSessionSlug, patchSessionMetadata } as unknown as EventStore)
      c.set('broadcastToAll', broadcastToAll)
      c.set('broadcastToSession', () => {})
      await next()
    })
    app.route('/api', callbacksRouter)
  })

  describe('POST /api/callbacks/session-info/:sessionId', () => {
    test('sets slug when provided and merges git into metadata', async () => {
      const res = await app.request('/api/callbacks/session-info/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'my-session',
          git: { branch: 'main', repository_url: 'git@ex:r.git' },
        }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-123', 'my-session')
      expect(patchSessionMetadata).toHaveBeenCalledWith('sess-123', {
        git: { branch: 'main', repository_url: 'git@ex:r.git' },
      })
      expect(broadcastToAll).toHaveBeenCalledWith({
        type: 'session_update',
        data: { id: 'sess-123', slug: 'my-session' },
      })
    })

    test('auto-names slug as uuidPrefix-<branch>:<agentShortName> for claude-code', async () => {
      const res = await app.request('/api/callbacks/session-info/019d9d13-24c6-76f0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: null,
          git: { branch: 'feat/x', repository_url: 'git@ex:r.git' },
          agentClass: 'claude-code',
        }),
      })
      expect(res.status).toBe(200)
      // claude-code -> "claude"; prefix is the first UUID segment.
      expect(updateSessionSlug).toHaveBeenCalledWith('019d9d13-24c6-76f0', '019d9d13-feat/x:claude')
      expect(patchSessionMetadata).toHaveBeenCalledWith('019d9d13-24c6-76f0', {
        git: { branch: 'feat/x', repository_url: 'git@ex:r.git' },
      })
    })

    test('auto-names slug with :codex suffix when agent class is codex', async () => {
      const res = await app.request('/api/callbacks/session-info/019d9d13-24c6-76f0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: null,
          git: { branch: 'feat/x', repository_url: null },
          agentClass: 'codex',
        }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('019d9d13-24c6-76f0', '019d9d13-feat/x:codex')
    })

    test('omits agent suffix when agentClass is absent from the body', async () => {
      const res = await app.request('/api/callbacks/session-info/019d9d13-24c6-76f0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: null,
          git: { branch: 'feat/x', repository_url: null },
        }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('019d9d13-24c6-76f0', '019d9d13-feat/x')
    })

    test('uses explicit slug verbatim even when agentClass is present', async () => {
      // explicitSlug wins verbatim — no suffix tacked on even if the
      // hook mirrored an agentClass back to us.
      const res = await app.request('/api/callbacks/session-info/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'human-picked-name',
          git: { branch: 'feat/x', repository_url: null },
          agentClass: 'claude-code',
        }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-123', 'human-picked-name')
    })

    test('does not overwrite slug when only repository_url is provided (no branch fallback)', async () => {
      const res = await app.request('/api/callbacks/session-info/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: null,
          git: { branch: null, repository_url: 'git@ex:r.git' },
        }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).not.toHaveBeenCalled()
      expect(patchSessionMetadata).toHaveBeenCalledWith('sess-123', {
        git: { repository_url: 'git@ex:r.git' },
      })
      // No slug changed, no broadcast
      expect(broadcastToAll).not.toHaveBeenCalled()
    })

    test('skips metadata patch when no git fields are present', async () => {
      const res = await app.request('/api/callbacks/session-info/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'just-slug', git: null }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-123', 'just-slug')
      expect(patchSessionMetadata).not.toHaveBeenCalled()
    })

    test('returns 400 when neither slug nor git info is present', async () => {
      const res = await app.request('/api/callbacks/session-info/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      expect(updateSessionSlug).not.toHaveBeenCalled()
      expect(patchSessionMetadata).not.toHaveBeenCalled()
    })

    test('decodes URL-encoded session IDs', async () => {
      const encoded = encodeURIComponent('sess-with-special/chars')
      const res = await app.request(`/api/callbacks/session-info/${encoded}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'decoded-test' }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-with-special/chars', 'decoded-test')
    })
  })
})
