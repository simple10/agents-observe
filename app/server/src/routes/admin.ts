// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import { copyFileSync, statSync } from 'fs'
import type { EventStore } from '../storage/types'
import { apiError } from '../errors'
import { config } from '../config'
import { removeSessionRootAgent, clearSessionRootAgents } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// GET /db/stats — DB file size + row counts for the Sessions tab
router.get('/db/stats', async (c) => {
  const store = c.get('store')
  let sizeBytes = 0
  try {
    sizeBytes = statSync(config.dbPath).size
  } catch {
    // File may not exist yet in edge cases (fresh install, reset mid-request);
    // fall through with 0 rather than erroring the whole endpoint.
  }
  const { sessionCount, eventCount } = await store.getDbStats()
  return c.json({ dbPath: config.dbPath, sizeBytes, sessionCount, eventCount })
})

// POST /sessions/bulk-delete — delete multiple sessions and VACUUM
// Body: { sessionIds: string[] }
router.post('/sessions/bulk-delete', async (c) => {
  const body = await c.req.json().catch(() => null)
  const ids = body?.sessionIds
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return apiError(c, 400, 'sessionIds must be an array of strings')
  }
  const store = c.get('store')
  let sizeBefore = 0
  try {
    sizeBefore = statSync(config.dbPath).size
  } catch {
    // See /db/stats — tolerate a missing file rather than 500.
  }

  console.log(`[admin] bulk-delete: starting for ${ids.length} session(s)`)
  const deleteStart = Date.now()
  const deleted = await store.deleteSessions(ids)
  for (const id of ids) removeSessionRootAgent(id)
  console.log(
    `[admin] bulk-delete: removed ${deleted.events} events, ${deleted.agents} agents, ${deleted.sessions} sessions in ${Date.now() - deleteStart}ms`,
  )

  // VACUUM after delete so the file actually shrinks on disk. This is the
  // whole point of the Sessions tab; skipping it would leave users
  // confused about why "deleting 5GB of sessions" didn't free any space.
  const vacuumStart = Date.now()
  await store.vacuum()
  let sizeAfter = 0
  try {
    sizeAfter = statSync(config.dbPath).size
  } catch {
    // See above.
  }
  const reclaimed = sizeBefore - sizeAfter
  console.log(
    `[admin] vacuum: ${sizeBefore} -> ${sizeAfter} bytes (reclaimed ${reclaimed}) in ${Date.now() - vacuumStart}ms`,
  )

  return c.json({ ok: true, deleted, sizeBefore, sizeAfter })
})

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.deleteSession(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /sessions/:id/events — clear events and agents for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.clearSessionEvents(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /projects/:id — delete a project and all its sessions, agents, events
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return apiError(c, 400, 'Invalid project ID')
  const { sessionIds, ...deleted } = await store.deleteProject(projectId)
  for (const sessionId of sessionIds) {
    removeSessionRootAgent(sessionId)
  }
  return c.json({ ok: true, deleted })
})

// DELETE /data — delete all data (projects, sessions, agents, events)
// Controlled by AGENTS_OBSERVE_ALLOW_DB_RESET: allow | deny | backup (default)
router.delete('/data', async (c) => {
  const store = c.get('store')
  const policy = config.allowDbReset

  if (policy !== 'allow' && policy !== 'backup') {
    return apiError(c, 403, 'Database reset is disabled', {
      code: 'DB_RESET_DENIED',
      details: 'Set AGENTS_OBSERVE_ALLOW_DB_RESET=allow or backup to enable',
    })
  }

  if (policy === 'backup') {
    const dbPath = config.dbPath
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = dbPath.replace(/\.db$/, `-${timestamp}.bak.db`)
    try {
      copyFileSync(dbPath, backupPath)
      console.log(`[admin] Database backed up to ${backupPath}`)
    } catch (err) {
      console.error('[admin] Failed to create database backup:', err)
      return apiError(c, 500, 'Failed to create database backup before reset', {
        code: 'BACKUP_FAILED',
      })
    }
  }

  const deleted = await store.clearAllData()
  clearSessionRootAgents()
  return c.json({ ok: true, deleted })
})

export default router
