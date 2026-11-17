import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'darwin') {
  throw new Error('DMG verification requires macOS.')
}
const root = process.cwd()
const output = resolve(process.env.PERSONAL_OUTPUT_DIR || '.cache/personal-release')
const metadata = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'))
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const { _electron } = require('@stablyai/playwright-test')
const supportDir = join(root, '.cache/personal-release')
mkdirSync(supportDir, { recursive: true })
const supportPath = join(supportDir, 'packaged-smoke-support.cjs')
await build({
  stdin: {
    contents: `export {createElectronHomeIsolation} from './tests/e2e/helpers/electron-home-isolation.ts'; export {getE2ECompletedOnboardingProfile} from './tests/e2e/helpers/e2e-completed-onboarding-profile.ts'; export {closeElectronAppForE2E,cleanupE2EDaemons} from './tests/e2e/helpers/electron-process-shutdown.ts'`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  outfile: supportPath
})
const {
  createElectronHomeIsolation,
  getE2ECompletedOnboardingProfile,
  closeElectronAppForE2E,
  cleanupE2EDaemons
} = require(supportPath)
const mount = mkdtempSync(join(output, 'mounted-'))
const userData = mkdtempSync(join(output, 'profile-'))
let mounted = false
let app
try {
  execFileSync(
    'hdiutil',
    ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, metadata.dmg],
    { stdio: 'inherit' }
  )
  mounted = true
  const bundle = join(mount, 'Orca.app')
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' })
  const mobile = join(bundle, 'Contents/Resources/app.asar.unpacked/out/mobile-web')
  const manifest = JSON.parse(readFileSync(join(mobile, 'manifest.json'), 'utf8'))
  const built = JSON.parse(readFileSync('out/mobile-web/manifest.json', 'utf8'))
  assert.equal(manifest.buildId, built.buildId)
  for (const asset of manifest.assets) {
    assert.ok(existsSync(join(mobile, asset.path)))
  }
  const { ELECTRON_RUN_AS_NODE: unused, ...inheritedEnv } = process.env
  void unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir: userData
  })
  const profile = getE2ECompletedOnboardingProfile()
  writeFileSync(
    join(userData, 'orca-data.json'),
    JSON.stringify({
      ...profile,
      settings: { ...profile.settings, terminalGpuAcceleration: 'off' }
    })
  )
  app = await _electron.launch({
    executablePath: join(bundle, 'Contents/MacOS/Orca'),
    args: ['--password-store=basic', '--use-mock-keychain', '-ApplePersistenceIgnoreState', 'YES'],
    env: {
      ...isolation.env,
      NODE_ENV: 'production',
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_E2E_HEADLESS: '1',
      ORCA_BYPASS_SINGLE_INSTANCE_LOCK: '1'
    },
    timeout: 90000
  })
  const page = await app.firstWindow({ timeout: 90000 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, {
    timeout: 60000
  })
  const identity = await app.evaluate(({ app, BrowserWindow }) => ({
    version: app.getVersion(),
    home: app.getPath('home'),
    userData: app.getPath('userData'),
    arch: process.arch,
    packaged: app.isPackaged,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  }))
  assert.equal(identity.version, metadata.version)
  assert.equal(identity.home, isolation.isolatedHome)
  assert.equal(identity.userData, userData)
  assert.equal(identity.arch, 'arm64')
  assert.equal(identity.packaged, true)
  assert.ok(
    identity.windows.length > 0 &&
      identity.windows.every((window) => !window.visible && !window.focused)
  )
  const status = await page.evaluate(() => window.api.runtime.getStatus())
  assert.ok(status.capabilities?.length > 0)
  const terminal = await page.evaluate(async (cwd) => {
    let text = ''
    const stop = window.api.pty.onData(({ id, data, rawLength }) => {
      text += data
      window.api.pty.ackData(id, rawLength ?? data.length)
    })
    const terminal = await window.api.pty.spawn({
      cols: 80,
      rows: 24,
      cwd,
      shellOverride: '/bin/sh'
    })
    window.api.pty.setPtyDeliveryInterest(terminal.id, true)
    window.__personalReleaseProbe = { output: () => text, terminal: terminal.id, stop }
    return window.api.pty.writeAccepted(
      terminal.id,
      "printf 'ORCA_'; printf 'PERSONAL_RELEASE_OK\\n'\r",
      'driving',
      { requireWriteSettlement: true }
    )
  }, isolation.isolatedHome)
  assert.equal(terminal, true)
  await page.waitForFunction(
    () => window.__personalReleaseProbe.output().includes('ORCA_PERSONAL_RELEASE_OK'),
    undefined,
    { timeout: 30000 }
  )
  await page.evaluate(async () => {
    const probe = window.__personalReleaseProbe
    window.api.pty.setPtyDeliveryInterest(probe.terminal, false)
    probe.stop()
    await window.api.pty.kill(probe.terminal)
  })
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'packaged-desktop.png') })
  writeFileSync(
    join(output, 'verification.json'),
    `${JSON.stringify(
      {
        sha: metadata.sha,
        version: metadata.version,
        identity,
        capabilities: status.capabilities.length,
        mobileAssets: manifest.assets.length
      },
      null,
      2
    )}\n`
  )
  console.log(`Verified ${metadata.version}: hidden desktop, mobile payload and PTY output.`)
} finally {
  try {
    await (app
      ? closeElectronAppForE2E(app, { cleanupDaemonsForUserDataDir: userData })
      : cleanupE2EDaemons(userData))
  } finally {
    if (mounted) {
      execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
    }
  }
}
