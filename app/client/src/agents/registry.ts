import type { AgentClassRegistration, EnrichedEvent } from './types'

// Storage uses the base-typed registration. Per-class generic parameters
// are erased at the storage boundary so a single map can hold all
// classes. The cast is safe because `processEvent` for class X always
// produces events that class X's components expect — by construction.
type AnyRegistration = AgentClassRegistration<EnrichedEvent>

const registrations = new Map<string, AnyRegistration>()
let defaultRegistration: AnyRegistration | null = null

export const AgentRegistry = {
  register<TEvent extends EnrichedEvent>(registration: AgentClassRegistration<TEvent>) {
    registrations.set(registration.agentClass, registration as unknown as AnyRegistration)
  },

  registerDefault<TEvent extends EnrichedEvent>(registration: AgentClassRegistration<TEvent>) {
    defaultRegistration = registration as unknown as AnyRegistration
  },

  get(agentClass: string | null | undefined): AnyRegistration {
    const reg = registrations.get(agentClass ?? '') ?? defaultRegistration
    if (!reg) {
      throw new Error(`No agent class registered for "${agentClass}" and no default registered`)
    }
    return reg
  },

  getAll(): AnyRegistration[] {
    return [...registrations.values()]
  },

  has(agentClass: string): boolean {
    return registrations.has(agentClass)
  },
}
