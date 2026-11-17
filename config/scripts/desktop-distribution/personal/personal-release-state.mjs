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
  if (!personalIsAncestor(root, base, tag)) {
    const error = new Error(
      `${base} and ${tag} have diverged release histories. Reconcile a candidate branch against ${tag} and dispatch it explicitly.`
    )
    error.code = 'PERSONAL_RELEASE_HISTORY_DIVERGED'
    throw error
  }
  if (base === tag) {
    if (!personalIsAncestor(root, tag, 'HEAD')) {
      throw new Error('Personal ledger base is absent from its commit history.')
    }
    return
  }
  personalGit(root, 'merge', '--no-ff', '--no-commit', tag)
}
