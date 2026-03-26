// app/server/src/storage/index.ts

import { SqliteAdapter } from './sqlite-adapter'
import type { EventStore } from './types'

export function createStore(): EventStore {
  const adapter = process.env.STORAGE_ADAPTER || 'sqlite'

  switch (adapter) {
    case 'sqlite': {
      const dbPath = process.env.DB_PATH || 'observe.db'
      return new SqliteAdapter(dbPath)
    }
    default:
      throw new Error(`Unknown storage adapter: ${adapter}`)
  }
}

export type { EventStore } from './types'
export type { InsertEventParams, EventFilters, StoredEvent } from './types'
