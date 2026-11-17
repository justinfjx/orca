import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  mergePersonalStableRelease,
  personalGit,
  personalIsAncestor,
  personalReleaseBase,
  PERSONAL_BUILD_LEDGER
} from './personal-release-state.mjs'

const root = process.cwd()
const output = resolve(process.env.PERSONAL_OUTPUT_DIR || '.cache/personal-release')
const metadataPath = join(output, 'release.json')
const repository = process.env.GITHUB_REPOSITORY || 'justinfjx/orca'
const upstream = 'stablyai/orca'

function run(program, args, options = {}) {
  return execFileSync(program, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
}

function pnpm(...args) {
  if (process.platform === 'win32') {
    throw new Error('The personal DMG pipeline runs on macOS.')
  }
  run('pnpm', args)
}

function gh(...args) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
}

function readMetadata() {
  return JSON.parse(readFileSync(metadataPath, 'utf8'))
}

function saveMetadata(metadata) {
  mkdirSync(output, { recursive: true })
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
}

async function prepare() {
  const tag = process.env.PERSONAL_RELEASE_TAG || ''
  const start = process.env.PERSONAL_START_SHA || ''
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[0-9a-f]{40}$/.test(start)) {
    throw new Error('Prepare requires a stable release tag and the original personal commit.')
  }
  if (personalGit(root, 'status', '--porcelain')) {
    throw new Error('Prepare requires a clean checkout.')
  }
  personalGit(root, 'fetch', '--no-tags', 'origin', 'personal')
  if (personalGit(root, 'rev-parse', 'FETCH_HEAD') !== start) {
    throw new Error('Personal changed after discovery; start a fresh run.')
  }
  if (!personalIsAncestor(root, start, 'HEAD')) {
    throw new Error('Candidate must retain the current personal history.')
  }
  let ledger = readFileSync(join(root, PERSONAL_BUILD_LEDGER), 'utf8')
  const base = personalReleaseBase(ledger)
  personalGit(
    root,
    'fetch',
    '--no-tags',
    `https://github.com/${upstream}.git`,
    'refs/tags/v*:refs/tags/v*'
  )
  mergePersonalStableRelease(root, base, tag)
  ledger = readFileSync(join(root, PERSONAL_BUILD_LEDGER), 'utf8')
  const upstreamSha = personalGit(root, 'rev-parse', `${tag}^{commit}`)
  const retired = new Set()
  for (const match of ledger.matchAll(
    /\| \[#(\d+)\]\(https:\/\/github\.com\/stablyai\/orca\/pull\/\d+\)/g
  )) {
    const pull = JSON.parse(gh('api', `repos/${upstream}/pulls/${match[1]}`))
    if (!pull.merged_at || !pull.merge_commit_sha) {
      continue
    }
    const exists = spawnSync('git', ['cat-file', '-e', `${pull.merge_commit_sha}^{commit}`], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore'
    })
    if (exists.status === 0 && personalIsAncestor(root, pull.merge_commit_sha, upstreamSha)) {
      retired.add(match[1])
    }
  }
  ledger = ledger
    .replace(
      /^Official base:.*$/m,
      `Official base: [\`${tag}\`](https://github.com/${upstream}/releases/tag/${tag}).`
    )
    .split('\n')
    .filter((line) => !retired.has(/^\| \[#(\d+)\]/.exec(line)?.[1]))
    .join('\n')
  writeFileSync(join(root, PERSONAL_BUILD_LEDGER), ledger)
  personalGit(root, 'add', PERSONAL_BUILD_LEDGER)
  if (personalGit(root, 'status', '--porcelain')) {
    personalGit(root, 'commit', '-m', `Merge official ${tag} into personal`)
  }
  const sha = personalGit(root, 'rev-parse', 'HEAD')
  saveMetadata({ tag, sha, upstreamSha, start, releaseTag: `personal-${tag}-${sha.slice(0, 10)}` })
  console.log(`Prepared ${tag} at ${sha}; retired PRs: ${[...retired].join(', ') || 'none'}`)
}

async function buildDmg() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Build requires an Apple Silicon macOS runner.')
  }
  const metadata = readMetadata()
  Object.assign(process.env, {
    ORCA_BACKGROUND_LAUNCH: '1',
    CSC_NAME: '-',
    ORCA_COMPUTER_MACOS_SIGN_IDENTITY: '-',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ORCA_BUILD_COMMIT: metadata.sha,
    ORCA_MAC_RELEASE: '0',
    ORCA_MAC_HOURLY: '0',
    ORCA_MAC_DAILY: '0',
    ORCA_MAC_ADHOC: '0'
  })
  pnpm('-C', 'mobile', 'typecheck')
  pnpm('-C', 'mobile', 'typecheck:tests')
  pnpm(
    'test',
    'config/scripts/mobile-web-app/shell/mobile-web-app-top-chrome-render.test.mjs',
    '--maxWorkers=1'
  )
  pnpm('test:e2e', 'tests/e2e/pdf-viewer-file-rewrite.spec.ts', '--workers=1')
  pnpm('build:desktop')
  pnpm('build:computer-macos')
  for (const helper of ['keyboard-layout', 'process-footprint', 'notification-status']) {
    pnpm(`build:${helper}-macos`, '--single-arch')
  }
  pnpm('ensure:electron-runtime')
  const { getLocalBuildIdentity } = await import(
    pathToFileURL(join(root, 'config/scripts/desktop-distribution/macos/build-mac-local.mjs'))
  )
  const identity = getLocalBuildIdentity()
  process.env.ORCA_LOCAL_BUILD_VERSION = identity.version
  const require = createRequire(join(root, 'package.json'))
  const base = require(join(root, 'config/electron-builder.config.cjs'))
  const { build, Platform, Arch } = require('electron-builder')
  const { default: sign } = await import(
    pathToFileURL(join(root, 'config/scripts/desktop-distribution/macos/sign-mac-app.mjs'))
  )
  const destination = join(output, 'dist')
  await build({
    targets: Platform.MAC.createTarget(['dmg'], Arch.arm64),
    publish: 'never',
    config: {
      ...base,
      directories: { ...base.directories, output: destination },
      mac: { ...base.mac, identity: null },
      publish: null,
      afterSign: async (context) => {
        const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
        const options = await context.packager.helper.buildSignOptions(
          app,
          { name: '-' },
          'development',
          false,
          context.packager.platformSpecificBuildOptions,
          undefined,
          context.arch
        )
        await sign({ ...options, preAutoEntitlements: false, timestamp: 'none' })
      }
    }
  })
  saveMetadata({
    ...metadata,
    version: identity.version,
    dmg: join(destination, 'orca-macos-arm64.dmg')
  })
}

function publish() {
  const metadata = readMetadata()
  if (
    personalGit(root, 'rev-parse', 'HEAD') !== metadata.sha ||
    personalGit(root, 'status', '--porcelain')
  ) {
    throw new Error('Publication requires the clean, verified candidate.')
  }
  const verified = JSON.parse(readFileSync(join(output, 'verification.json'), 'utf8'))
  if (verified.sha !== metadata.sha || verified.version !== metadata.version) {
    throw new Error('Packaged application verification does not match this candidate.')
  }
  pnpm('check:changed', `--base=${metadata.tag}`, '--maxWorkers=1')
  const remote = personalGit(root, 'ls-remote', 'origin', 'refs/heads/personal').split(/\s+/)[0]
  if (remote !== metadata.start) {
    throw new Error('Personal advanced during the build; start a fresh run.')
  }
  gh('auth', 'setup-git', '--hostname', 'github.com')
  personalGit(root, 'push', 'origin', 'HEAD:refs/heads/personal')
  const patches = readFileSync(join(root, PERSONAL_BUILD_LEDGER), 'utf8')
    .split('\n')
    .filter((line) => /^\| \[#\d+\]/.test(line))
  const notes = [
    `Built from [personal at ${metadata.sha.slice(0, 12)}](https://github.com/${repository}/commit/${metadata.sha}) on official [${metadata.tag}](https://github.com/${upstream}/releases/tag/${metadata.tag}).`,
    '',
    '## Personal patches',
    '',
    ...(patches.length > 0
      ? ['| PR | Patch | Original commit |', '| --- | --- | --- |', ...patches]
      : ['All previously carried patches are included in the official release.']),
    '',
    '## Install',
    '',
    'Download orca-macos-arm64.dmg for Apple Silicon, drag Orca.app into Applications, then quit and reopen Orca. Keep the previous working installer.',
    '',
    'This personal build uses manual installation. Apple Developer ID signing and notarization were skipped. If macOS blocks first launch, follow [Apple’s instructions](https://support.apple.com/102445).'
  ].join('\n')
  const notesPath = join(output, 'release-notes.md')
  writeFileSync(notesPath, notes)
  const releases = JSON.parse(gh('api', `repos/${repository}/releases?per_page=100`))
  const existing = releases.find((release) => release.tag_name === metadata.releaseTag)
  if (existing && !existing.draft) {
    throw new Error('This personal release is already published.')
  }
  if (existing && existing.target_commitish !== metadata.sha) {
    throw new Error('Existing draft targets a different commit.')
  }
  if (!existing) {
    gh(
      'release',
      'create',
      metadata.releaseTag,
      '--repo',
      repository,
      '--target',
      metadata.sha,
      '--title',
      `Orca Personal ${metadata.tag.slice(1)}`,
      '--notes-file',
      notesPath,
      '--draft',
      '--prerelease',
      '--latest=false'
    )
  }
  gh('release', 'upload', metadata.releaseTag, metadata.dmg, '--repo', repository, '--clobber')
  const release = JSON.parse(
    gh(
      'release',
      'view',
      metadata.releaseTag,
      '--repo',
      repository,
      '--json',
      'targetCommitish,isDraft,assets'
    )
  )
  const asset = release.assets.find((item) => item.name === 'orca-macos-arm64.dmg')
  if (
    !release.isDraft ||
    release.targetCommitish !== metadata.sha ||
    asset?.state !== 'uploaded' ||
    asset.size !== statSync(metadata.dmg).size
  ) {
    throw new Error('Draft target or uploaded DMG does not match the verified build.')
  }
  gh(
    'release',
    'edit',
    metadata.releaseTag,
    '--repo',
    repository,
    '--draft=false',
    '--prerelease',
    '--latest=false'
  )
  const url = `https://github.com/${repository}/releases/tag/${metadata.releaseTag}`
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Published ${metadata.tag}\n\n${url}\n`)
  }
  console.log(url)
}

const commands = { prepare, build: buildDmg, publish }
const command = commands[process.argv[2]]
if (!command) {
  throw new Error('Choose prepare, build, or publish.')
}
await command()
