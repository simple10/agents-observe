import type { AgentClassRegistration } from './types'

const registrations = new Map<string, AgentClassRegistration>()
let defaultRegistration: AgentClassRegistration | null = null

export const AgentRegistry = {
  register(registration: AgentClassRegistration) {
    registrations.set(registration.agentClass, registration)
  },

  registerDefault(registration: AgentClassRegistration) {
    defaultRegistration = registration
  },

  get(agentClass: string | null | undefined): AgentClassRegistration {
    const reg = registrations.get(agentClass ?? '') ?? defaultRegistration
    if (!reg) {
      throw new Error(
        `No agent class registered for "${agentClass}" and no default registered`,
      )
    }
    return reg
  },

  getAll(): AgentClassRegistration[] {
    return [...registrations.values()]
  },

  has(agentClass: string): boolean {
    return registrations.has(agentClass)
  },
}
