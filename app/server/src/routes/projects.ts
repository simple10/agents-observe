// app/server/src/routes/projects.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Project, Session } from '../types'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// GET /projects
router.get('/projects', async (c) => {
  const store = c.get('store')
  const rows = await store.getProjects()
  const projects: Project[] = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    sessionCount: r.session_count,
  }))
  return c.json(projects)
})

// GET /projects/:id/sessions
router.get('/projects/:id/sessions', async (c) => {
  const store = c.get('store')
  const projectId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getSessionsForProject(projectId)
  const sessions: Session[] = rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    slug: r.slug,
    status: r.status,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    activeAgentCount: r.active_agent_count,
    eventCount: r.event_count,
  }))
  return c.json(sessions)
})

export default router
