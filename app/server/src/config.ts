// app/server/src/config.ts
// Central config for the server. All env var reads happen here.

import { resolve, dirname } from 'path'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'

const logLevel = (process.env.AGENTS_OBSERVE_LOG_LEVEL || 'debug').toLowerCase()

function detectRuntime(): 'docker' | 'local' | 'dev' {
  const explicit = process.env.AGENTS_OBSERVE_RUNTIME
  if (explicit === 'docker' || explicit === 'local' || explicit === 'dev') return explicit
  if (existsSync('/.dockerenv')) return 'docker'
  return 'local'
}

function readVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url))
  const paths = [
    resolve(dir, '../../../VERSION'),     // dev: app/server/src -> root
    resolve(dir, '../../VERSION'),        // Docker: /app/server/src -> /app
    '/app/VERSION',                       // Docker fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      continue
    }
  }
  return 'unknown'
}

export const config = {
  apiId: 'agents-observe',
  runtime: detectRuntime(),
  version: readVersion(),
  port: parseInt(process.env.AGENTS_OBSERVE_SERVER_PORT || '4981', 10),
  logLevel,
  verbose: logLevel === 'debug' || logLevel === 'trace',
  dbPath: resolve(process.env.AGENTS_OBSERVE_DB_PATH || '../../data/observe.db'),
  storageAdapter: process.env.AGENTS_OBSERVE_STORAGE_ADAPTER || 'sqlite',
  clientDistPath: process.env.AGENTS_OBSERVE_CLIENT_DIST_PATH || '',
  devClientPort: parseInt(process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '5174', 10),
}
