import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mergePersonalStableRelease, personalGit } from './personal-release-state.mjs'

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'personal-release-state-'))
  personalGit(root, 'init', '-q')
  personalGit(root, 'symbolic-ref', 'HEAD', 'refs/heads/official')
  personalGit(root, 'config', 'user.name', 'Release fixture')
  personalGit(root, 'config', 'user.email', 'fixture@example.com')
  const commit = (file, contents) => {
    writeFileSync(join(root, file), contents)
    personalGit(root, 'add', file)
    personalGit(root, 'commit', '-qm', file)
  }
  commit('base.txt', 'common release\n')
  return { root, commit }
}

test('a linear stable update keeps the personal feature and adopts the new release', () => {
  const { root, commit } = repository()
  try {
    personalGit(root, 'tag', 'v1.0.0')
    personalGit(root, 'switch', '-qc', 'personal')
    commit('feature.txt', 'required personal feature\n')
    personalGit(root, 'switch', '-q', 'official')
    commit('upstream.txt', 'new official feature\n')
    personalGit(root, 'tag', 'v1.0.1')
    personalGit(root, 'switch', '-q', 'personal')
    mergePersonalStableRelease(root, 'v1.0.0', 'v1.0.1')
    assert.equal(readFileSync(join(root, 'feature.txt'), 'utf8'), 'required personal feature\n')
    assert.equal(readFileSync(join(root, 'upstream.txt'), 'utf8'), 'new official feature\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('diverged release histories stop before reviving old-release-only content', () => {
  const { root, commit } = repository()
  try {
    personalGit(root, 'tag', 'fork-point')
    commit('old-only.txt', 'retired official change\n')
    personalGit(root, 'tag', 'v1.0.0')
    personalGit(root, 'switch', '-qc', 'personal')
    commit('feature.txt', 'required personal feature\n')
    const before = personalGit(root, 'rev-parse', 'HEAD')
    personalGit(root, 'switch', '-qc', 'next-official', 'fork-point')
    commit('upstream.txt', 'replacement release\n')
    personalGit(root, 'tag', 'v1.0.1')
    personalGit(root, 'switch', '-q', 'personal')
    assert.throws(() => mergePersonalStableRelease(root, 'v1.0.0', 'v1.0.1'), {
      code: 'PERSONAL_RELEASE_HISTORY_DIVERGED'
    })
    assert.equal(personalGit(root, 'rev-parse', 'HEAD'), before)
    assert.equal(personalGit(root, 'status', '--porcelain'), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
