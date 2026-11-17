import os from 'node:os'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runProcess, runProcessSync, spawnProcess } from '@orca/process-host'
import { hasNoChangedFiles } from './vitest-changed-precheck.mjs'
import { RUN_ARGS_ENV } from './vitest-run-filters.mjs'
import { localModuleCacheEnv } from '../module-cache/vitest-local-module-cache.mjs'
import { createRunTempDirectory } from './vitest-run-temp-directory.mjs'
import { createVitestZodBundle } from '../module-cache/vitest-zod-bundle.mjs'
import {
  checkBunVersion,
  probeBunVersion,
  readPinnedBunVersion,
  resolvePinnedBunExecutable
} from '../../tool-invocation/pinned-bun-executable.mjs'

const root = resolve(import.meta.dirname, '../../../..')
const vitestArgs = process.argv.slice(2)

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

function waitForVitest(spec) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(spec)
    // Stay alive until Vitest exits so the run directory is removed after its last write.
    // A terminal sends SIGINT and SIGHUP to the whole group; forward them only if Vitest missed them.
    const forward = (signal) => {
      if (signal === 'SIGTERM') {
        child.kill(signal)
        return
      }
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill(signal)
        }
      }, 1000).unref()
    }
    for (const signal of FORWARDED_SIGNALS) {
      process.on(signal, forward)
    }
    const settle = () => {
      for (const signal of FORWARDED_SIGNALS) {
        process.off(signal, forward)
      }
    }
    child.on('error', (error) => {
      settle()
      reject(error)
    })
    child.on('close', (code, signal) => {
      settle()
      resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1))
    })
  })
}

function relatedTestBatches(files) {
  const batches = []
  let batch = []
  let characters = 0
  for (const file of files) {
    if (batch.length > 0 && characters + file.length > 16000) {
      batches.push(batch)
      batch = []
      characters = 0
    }
    batch.push(file)
    characters += file.length + 1
  }
  if (batch.length > 0) {
    batches.push(batch)
  }
  return batches
}

async function runSplitRelatedTests(spec, runTemp) {
  const configIndex = vitestArgs.indexOf('--config')
  if (!runTemp || vitestArgs[1] !== '--run' || configIndex < 2) {
    throw new Error(
      'Split related selection requires the preflight related --run ... --config command.'
    )
  }
  const planPath = join(runTemp.path, 'related-test-specifications.json')
  // Release the full dependency graph before starting test workers on memory-limited runners.
  const collected = await waitForVitest({
    ...spec,
    args: [
      '--smol',
      '--bun',
      resolve(
        root,
        'config/scripts/test-runtime/execution-policy/collect-related-test-specifications.mjs'
      ),
      planPath,
      ...vitestArgs
    ]
  })
  if (collected !== 0) {
    return collected
  }
  const projects = JSON.parse(readFileSync(planPath, 'utf8'))
  const sharedArgs = vitestArgs.slice(configIndex).filter((arg) => arg !== '--passWithNoTests')
  let batchIndex = 0
  for (const { project, files } of projects) {
    for (const batch of relatedTestBatches(files)) {
      console.log(`Running ${batch.length} related test files in ${project}.`)
      const reportPath = join(runTemp.path, `related-batch-${batchIndex++}.json`)
      const args = [
        'run',
        ...batch,
        `--project=${project}`,
        ...sharedArgs,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportPath}`
      ]
      const code = await waitForVitest({
        ...spec,
        args: ['--smol', '--bun', resolve(root, 'node_modules/vitest/vitest.mjs'), ...args],
        env: { ...spec.env, [RUN_ARGS_ENV]: JSON.stringify(args) }
      })
      if (code !== 0) {
        return code
      }
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      const actual = report.testResults.map((test) => resolve(test.name)).sort()
      const expected = batch.map((file) => resolve(root, file)).sort()
      if (
        actual.length !== expected.length ||
        actual.some((file, index) => file !== expected[index])
      ) {
        throw new Error(
          `Related test file inventory changed in ${project}: expected ${expected.length}, ran ${actual.length}.`
        )
      }
    }
  }
  return 0
}

async function runVitest() {
  const pinnedBun = resolvePinnedBunExecutable(root, runProcessSync)
  const bunCheck = pinnedBun
    ? { ok: true }
    : checkBunVersion(probeBunVersion('bun', root, runProcessSync), readPinnedBunVersion(root))
  if (bunCheck.message) {
    console.error(bunCheck.message)
  }
  if (!bunCheck.ok) {
    return 1
  }
  let runTemp
  try {
    const zodBundle = createVitestZodBundle(root)
    const moduleCacheEnv = await localModuleCacheEnv(root)
    runTemp = createRunTempDirectory()
    const env = {
      ...process.env,
      ...runTemp?.env,
      ...moduleCacheEnv,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_TEST_NODE_EXECUTABLE: process.execPath,
      ORCA_TEST_NODE_VERSION: process.versions.node,
      ORCA_UNIT_ZOD_BUNDLE: zodBundle.path,
      [RUN_ARGS_ENV]: JSON.stringify(vitestArgs),
      // The config's TypeScript and CommonJS package scope are intended; the notice is noise.
      VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true'
    }
    const spec = { program: pinnedBun ?? 'bun', cwd: root, env, stdio: 'inherit' }
    if (process.env.ORCA_PREFLIGHT_SPLIT_RELATED === '1' && vitestArgs[0] === 'related') {
      return await runSplitRelatedTests(spec, runTemp)
    }
    return await waitForVitest({
      ...spec,
      args: ['--bun', resolve(root, 'node_modules/vitest/vitest.mjs'), ...vitestArgs]
    })
  } catch (error) {
    console.error('Could not prepare or start Vitest:', error)
    return 1
  } finally {
    runTemp?.remove()
  }
}

if (await hasNoChangedFiles(vitestArgs, root, runProcess)) {
  // Vitest's own result for this case, without paying its startup.
  console.log('No changed files found, exiting with code 0')
} else {
  process.exitCode = await runVitest()
}
