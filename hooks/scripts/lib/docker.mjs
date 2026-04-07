// hooks/scripts/lib/docker.mjs
// Docker container management for Agents Observe. Node.js built-ins only.

import { execFile } from 'node:child_process'
import { getJson } from './http.mjs'
import { initLocalDataDirs } from './config.mjs'
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

// -- Docker lifecycle ---------------------------------------------

/**
 * Starts the Docker container. Returns the actual port the server is running on.
 * Handles: version mismatch (restart), port conflict (auto-assign), stale containers.
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
      await run('docker', ['stop', config.containerName])
      await run('docker', ['rm', config.containerName])
    } else {
      const port = new URL(config.apiBaseUrl).port || '4981'
      log.info(`Server already running on port ${port}`)
      return port
    }
  }

  // Ensure the local data dir has been created
  initLocalDataDirs(config)

  // Remove stale container to ensure latest image
  const psResult = await run('docker', ['ps', '-a', '--format', '{{.Names}}'])
  if (psResult.ok && psResult.stdout.split('\n').includes(config.containerName)) {
    log.warn('Removing stopped container to pull latest image...')
    await run('docker', ['rm', config.containerName])
  }

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

  // Try preferred port, fall back to auto-assign
  const preferredPort = config.serverPort
  const containerPort = '4981'

  let runResult = await run('docker', [
    'run',
    '-d',
    '--name',
    config.containerName,
    '-p',
    `${preferredPort}:${containerPort}`,
    '-e',
    `AGENTS_OBSERVE_SERVER_PORT=${containerPort}`,
    '-e',
    'AGENTS_OBSERVE_DB_PATH=/data/observe.db',
    '-e',
    'AGENTS_OBSERVE_CLIENT_DIST_PATH=/app/client/dist',
    '-e',
    'AGENTS_OBSERVE_RUNTIME=docker',
    '-v',
    `${config.dataDir}:/data`,
    config.dockerImage,
  ])

  let actualPort = preferredPort

  if (!runResult.ok && runResult.stderr.includes('port is already allocated')) {
    log.warn(`Port ${preferredPort} is in use, auto-assigning a free port...`)

    runResult = await run('docker', [
      'run',
      '-d',
      '--name',
      config.containerName,
      '-p',
      `0:${containerPort}`,
      '-e',
      `AGENTS_OBSERVE_SERVER_PORT=${containerPort}`,
      '-e',
      'AGENTS_OBSERVE_DB_PATH=/data/observe.db',
      '-e',
      'AGENTS_OBSERVE_CLIENT_DIST_PATH=/app/client/dist',
      '-e',
      'AGENTS_OBSERVE_RUNTIME=docker',
      '-v',
      `${config.dataDir}:/data`,
      config.dockerImage,
    ])

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

  // Wait for health
  const actualApiUrl = `http://127.0.0.1:${actualPort}/api`
  log.info('Waiting for server to start...')
  for (let i = 0; i < 15; i++) {
    const h = await getJson(`${actualApiUrl}/health`)
    if (h.status === 200 && h.body?.ok) {
      log.info('Server started successfully')
      if (actualPort !== preferredPort) {
        log.warn(`Note: Using port ${actualPort} (preferred port ${preferredPort} was in use)`)
      }
      return actualPort
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  log.error('Server failed to start within 15 seconds')
  log.error(`Check: docker logs ${config.containerName}`)
  return null
}

/**
 * Stops the Docker container and cleans up the port file.
 */
export async function stopServer(config, log = console) {
  log.info('Stopping server...')
  await run('docker', ['stop', config.containerName])
  removeServerPortFile(config)
}
