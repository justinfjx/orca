# Personal builds

Build the `personal` branch for the official stable release plus these required patches.

Official base: [`v1.4.261`](https://github.com/stablyai/orca/releases/tag/v1.4.261).

| PR                                                    | Patch                                 | Original commit                                                                        |
| ----------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| [#41911](https://github.com/stablyai/orca/pull/41911) | Native Claude prompt-cache countdowns | `5503c98dcbdcc1e43df340a69afbdfa131a3ef6b`                                             |
| [#42043](https://github.com/stablyai/orca/pull/42043) | PDF refresh in generated directories  | `862a886bda8b790d63c2911f1851091c2ac7d275`                                             |
| [#36746](https://github.com/stablyai/orca/pull/36746) | Mobile chat composer usage meter      | `d9ab38223794e0565aed94eb8f6463a292575554`, `da3c69669bfa4f246f6487d2f2a11a1c395ef11f` |

The integration history retains each patch's original attribution. The #36746 backport carries its usage meter and label-width fix, adapted to the stable release's module paths and composer layout. Official v1.4.261 includes the iPhone Duo spacing fix from #42375. Develop further PR changes on their original branches, then integrate the required updates here.

## Adopt the next stable release

Use a clean checkout of `personal`. Find the latest official stable release:

```sh
gh release view --repo stablyai/orca --json tagName,isPrerelease,url
```

Replace `<release-tag>` below with that stable tag, then fetch and merge it:

```sh
git fetch --no-tags upstream refs/tags/<release-tag>:refs/tags/<release-tag>
git merge <release-tag>
```

Merge release tags into this branch to preserve its integration history. Keep unreleased upstream commits on the development and PR branches.

If release histories diverge, reconcile the merge against the new release tree and reapply only the recorded personal patches. Retain both parents in the merge commit.

Review the carried PRs against the new release. When the release includes a patch, remove its row from the table and retain the existing commits. Resolve overlapping upstream changes against the required behavior. For a new patch, use `git cherry-pick -x` on its individual commits and add its source to the table.

Update the official base above, run the affected regressions, then run the release-relative gate immediately before pushing:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm check:changed --base=<release-tag> --maxWorkers=2
git push origin personal
```

## Build the personal version

Use Node 24 and the pnpm version pinned in `package.json`. Install the desktop and mobile dependencies as described in [the contributor guide](../../.github/CONTRIBUTING.md#local-setup). On macOS:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm build:mac
```

The mobile usage meter ships in the desktop-served mobile web bundle. Persisting its window and used/remaining preferences also requires a phone shell built with the new `orca:composerUsageWindow` and `orca:composerUsageDisplay` storage grants. Older shells can display the meter with its defaults.

Keep the previous working installer until the upgraded build passes checks for the required features. Installing an official update replaces the personal build with official code; use builds from this branch while the extra patches are needed.

## Automatic DMG releases

The fork's **Personal macOS Release** workflow checks the official stable release every six hours. It runs from `main`; its build and verification scripts live on `personal`. The standard `macos-15` Apple Silicon runner builds the same manual-install DMG without Apple account credentials.

The workflow integrates into a disposable checkout, validates the carried patches, builds the desktop and mobile bundle, and exercises the packaged desktop and a real terminal. It then rechecks the candidate and advances `personal` with a fast-forward push before publishing the DMG. A concurrent change to `personal` stops publication.

For low-memory runners, `ORCA_PREFLIGHT_SPLIT_RELATED=1` resolves the related test files in a separate process, then runs them after that process exits. The workflow keeps this mode enabled to release the discovery graph before test workers start.

Conflicts, diverged official release histories and failed checks stop the run. The workflow opens or updates `[personal] Automatic release needs attention` in this fork, with a link to the logs. A successful release closes that issue.

Run a check or retry from the default branch:

```sh
gh workflow run personal-release.yml --repo justinfjx/orca --ref main
```

For a release that needs manual reconciliation, start a `codex/personal-release-*` candidate branch from `personal`, integrate the new official release and update this ledger. Validate and push that candidate, then dispatch it explicitly:

```sh
gh workflow run personal-release.yml --repo justinfjx/orca --ref main \
  -f candidate_ref=codex/personal-release-v1.4.261
```

Follow the resulting run with `gh run watch <run-id> --repo justinfjx/orca --compact --exit-status`. Dispatch a fresh run after changing source or after a partially completed publication; it resolves the current branch and release state again. GitHub may disable scheduled workflows after 60 days without repository activity; re-enable the workflow in Actions when resuming maintenance.
