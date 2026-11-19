import { execFileSync, spawnSync } from 'node:child_process'

export const PERSONAL_BUILD_LEDGER = 'docs/agents-md-refs/personal-build.md'

export function personalGit(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  }).trim()
}

export function personalReleaseBase(ledger) {
  const tag = /^Official base: \[`(v\d+\.\d+\.\d+)`\]/m.exec(ledger)?.[1]
  if (!tag) {
    throw new Error('Personal build ledger has no official stable base.')
  }
  return tag
}

export function personalIsAncestor(root, ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status === 0) {
    return true
  }
  if (result.status === 1) {
    return false
  }
  throw new Error(result.stderr || 'Could not inspect release ancestry.')
}

export function mergePersonalStableRelease(root, base, tag) {
  if (!personalIsAncestor(root, base, 'HEAD')) {
    throw new Error('Personal ledger base is absent from its commit history.')
  }
  if (base === tag) {
    return
  }
  if (personalIsAncestor(root, base, tag)) {
    personalGit(root, 'merge', '--no-ff', '--no-commit', tag)
    return
  }
  if (personalIsAncestor(root, tag, 'HEAD')) {
    throw new Error(`Refusing to move the personal baseline back to ${tag}.`)
  }
  // Keep both parents, but replay only the fork's changes since its recorded release.
  personalGit(root, 'merge', '--no-ff', '--no-commit', '-s', 'ours', tag)
  try {
    personalGit(root, 'merge-recursive', base, '--', 'HEAD', tag)
  } catch (error) {
    const conflicts = personalGit(root, 'diff', '--name-only', '--diff-filter=U')
    personalGit(root, 'merge', '--abort')
    if (!conflicts) {
      throw error
    }
    throw new Error(
      `Reconcile personal changes against ${tag} in a candidate branch:\n${conflicts}`,
      {
        cause: error
      }
    )
  }
}
