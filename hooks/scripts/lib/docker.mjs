// hooks/scripts/lib/docker.mjs
// Docker container management for Agents Observe. Node.js built-ins only.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { getJson } from './http.mjs'
import { initLocalDataDirs, getServerEnv } from './config.mjs'
import { saveServerPortFile, removeServerPortFile } from './fs.mjs'

// -- Shell helper -------------------------------------------------

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err?.code ?? 0,
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
      })
    })
  })
}

/**
 * Read the managed label value from a container.
 * Returns the label string (version) if it's our container, null otherwise.
 */
async function getContainerLabel(config) {
  const result = await run('docker', [
    'inspect',
    '--format',
    `{{index .Config.Labels "${config.dockerLabel}"}}`,
    config.containerName,
  ])
  return result.ok && result.stdout ? result.stdout : null
}

/**
 * Check if a container exists and is managed by us.
 */
async function isOurContainer(config) {
  return !!(await getContainerLabel(config))
}

/**
 * Force-remove a container, but only if it has our managed label.
 * Returns true if removed, false if skipped (not ours or doesn't exist).
 */
async function safeRemoveContainer(config, log) {
  if (!(await isOurContainer(config))) {
    const exists = await run('docker', ['inspect', config.containerName])
    if (exists.ok) {
      log.warn(
        `Container "${config.containerName}" exists but is not managed by ${config.dockerLabel} — skipping removal`,
      )
    }
    return false
  }
  await run('docker', ['rm', '-f', config.containerName])
  return true
}

/**
 * Get the status of our container (if it exists).
 * Returns { exists, running, versionMatch } or null if container doesn't exist.
 */
async function getContainerState(config) {
  const label = await getContainerLabel(config)
  if (!label) return null

  const statusResult = await run('docker', [
    'inspect',
    '--format',
    '{{.State.Running}}',
    config.containerName,
  ])
  const running = statusResult.ok && statusResult.stdout === 'true'
  const versionMatch = label === (config.expectedVersion || 'unknown')

  return { exists: true, running, versionMatch, labelVersion: label }
}

// -- Docker lifecycle ---------------------------------------------

/**
 * Starts the Docker container. Returns the actual port the server is running on.
 * Handles: version mismatch (restart), port conflict (auto-assign), stale containers.
 *
 * Fast path: if a stopped container exists with the correct version, just
 * `docker start` it instead of rm + pull + run.
 */
export async function startServer(config, log = console) {
  // Check Docker availability
  const dockerCheck = await run('docker', ['info'])
  if (!dockerCheck.ok) {
    log.error('ERROR: Docker is not running or not installed')
    log.error('Install Docker: https://docs.docker.com/get-docker/')
    return null
  }

  // Check if something is already running on the target port
  const healthResult = await getJson(`${config.apiBaseUrl}/health`)
  if (healthResult.status === 200 && healthResult.body?.ok) {
    if (healthResult.body.id !== config.API_ID) {
      log.warn(
        `Port ${config.serverPort} is in use by another service, auto-assigning a free port...`,
      )
    } else if (config.expectedVersion && healthResult.body.version !== config.expectedVersion) {
      log.warn(
        `Server version mismatch: running ${healthResult.body.version}, expected ${config.expectedVersion}. Restarting...`,
      )
      await safeRemoveContainer(config, log)
    } else {
      const port = new URL(config.apiBaseUrl).port || '4981'
      log.info(`Server already running on port ${port}`)
      return port
    }
  }

  // Ensure the local data dir has been created
  initLocalDataDirs(config)

  // Check existing container state
  const state = await getContainerState(config)

  if (state) {
    if (state.running) {
      // Container is running — re-check health in case it came up between our first check and now
      const recheck = await getJson(`${config.apiBaseUrl}/health`)
      if (recheck.status === 200 && recheck.body?.ok) {
        const port = new URL(config.apiBaseUrl).port || '4981'
        log.info(`Server started by another process on port ${port}`)
        return port
      }
      // Running but not healthy — remove and do a fresh start
      log.warn('Container is running but unhealthy, restarting...')
      await safeRemoveContainer(config, log)
    } else if (state.versionMatch) {
      // Stopped container with correct version — fast restart
      log.info(`Restarting stopped container (v${state.labelVersion})...`)
      const startResult = await run('docker', ['start', config.containerName])
      if (startResult.ok) {
        const port = config.serverPort
        saveServerPortFile(config, port)
        return await waitForHealth(config, port, log)
      }
      // docker start failed — fall through to fresh start
      log.warn(`Failed to restart container: ${startResult.stderr}`)
      await safeRemoveContainer(config, log)
    } else {
      // Stopped container with wrong version — remove for upgrade
      log.info(`Upgrading container from v${state.labelVersion} to v${config.expectedVersion}...`)
      await safeRemoveContainer(config, log)
    }
  }

  // -- Fresh start: pull + run ------------------------------------

  // Pull image (skipped in test harness when AGENTS_OBSERVE_TEST_SKIP_PULL=1)
  if (!config.testSkipPull) {
    log.info('Pulling image and starting container...')
    const pullResult = await run('docker', ['pull', config.dockerImage])
    if (!pullResult.ok) {
      log.error(`Failed to pull image: ${pullResult.stderr}`)
      return null
    }
  } else {
    log.info('AGENTS_OBSERVE_TEST_SKIP_PULL=1 — skipping docker pull (test harness)')
  }

  // Build docker run args from centralized server env
  const serverEnv = getServerEnv(config)
  const containerPort = serverEnv.AGENTS_OBSERVE_SERVER_PORT
  const preferredPort = config.serverPort
  const envArgs = Object.entries(serverEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const labelValue = config.expectedVersion || 'unknown'

  function dockerRunArgs(portMapping) {
    // One mount per supported agent class. Each can resolve to a
    // different host path (user override) but the container side is
    // fixed so the server's resolveTranscriptPath knows where things
    // land. Missing host paths are silently skipped so e.g. a user
    // without codex installed doesn't error out.
    const transcriptMounts = config.transcriptStatsEnabled
      ? [
          ['-v', `${config.transcriptClaudeHost}:/host/.claude/projects:ro`],
          ['-v', `${config.transcriptCodexHost}:/host/.codex/sessions:ro`],
        ]
          .filter(([, mount]) => {
            const [src] = mount.split(':')
            return src && existsSync(src)
          })
          .flat()
      : []
    return [
      'run',
      '-d',
      '--name',
      config.containerName,
      '--label',
      `${config.dockerLabel}=${labelValue}`,
      '-p',
      portMapping,
      ...envArgs,
      '-v',
      `${config.dataDir}:/data`,
      ...transcriptMounts,
      config.dockerImage,
    ]
  }

  // Try preferred port, fall back to auto-assign
  let runResult = await run('docker', dockerRunArgs(`${preferredPort}:${containerPort}`))
  let actualPort = preferredPort

  if (!runResult.ok && runResult.stderr.includes('port is already allocated')) {
    log.warn(`Port ${preferredPort} is in use, auto-assigning a free port...`)

    runResult = await run('docker', dockerRunArgs(`0:${containerPort}`))

    if (!runResult.ok) {
      log.error(`Failed to start container: ${runResult.stderr}`)
      return null
    }

    const portResult = await run('docker', ['port', config.containerName, containerPort])
    if (portResult.ok) {
      const match = portResult.stdout.match(/:(\d+)$/)
      if (match) actualPort = match[1]
    }
  } else if (!runResult.ok) {
    log.error(`Failed to start container: ${runResult.stderr}`)
    return null
  }

  // Save port for hooks to discover
  saveServerPortFile(config, actualPort)

  return await waitForHealth(config, actualPort, log)
}

/**
 * Poll the health endpoint until the server is ready or we give up.
 * Returns the port on success, null on timeout.
 */
async function waitForHealth(config, port, log) {
  const apiUrl = `http://127.0.0.1:${port}/api`
  log.info('Waiting for server to start...')
  for (let i = 0; i < 15; i++) {
    const h = await getJson(`${apiUrl}/health`)
    if (h.status === 200 && h.body?.ok) {
      log.info('Server started successfully')
      return port
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  log.error('Server failed to start within 15 seconds')
  log.error(`Check: docker logs ${config.containerName}`)
  return null
}

/**
 * Stops the Docker container and cleans up the port file.
 * Container is stopped but NOT removed — it can be fast-restarted
 * on next startServer call if the version hasn't changed.
 */
export async function stopServer(config, log = console) {
  log.info('Stopping server...')
  if (await isOurContainer(config)) {
    await run('docker', ['stop', config.containerName])
  } else {
    const exists = await run('docker', ['inspect', config.containerName])
    if (exists.ok) {
      log.warn(
        `Container "${config.containerName}" is not managed by ${config.dockerLabel} — skipping stop`,
      )
    }
  }
  removeServerPortFile(config)
}
