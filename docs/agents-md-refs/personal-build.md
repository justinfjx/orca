# Personal builds

Build the `personal` branch for the official stable release plus these required patches.

Official base: [`v1.4.258`](https://github.com/stablyai/orca/releases/tag/v1.4.258).

| PR                                                    | Patch                                 | Original commit                            |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| [#41911](https://github.com/stablyai/orca/pull/41911) | Native Claude prompt-cache countdowns | `5503c98dcbdcc1e43df340a69afbdfa131a3ef6b` |
| [#42043](https://github.com/stablyai/orca/pull/42043) | PDF refresh in generated directories  | `862a886bda8b790d63c2911f1851091c2ac7d275` |
| [#42375](https://github.com/stablyai/orca/pull/42375) | iPhone Duo session-header spacing     | `d8e5605d0ed73385d1493fa27ba1a60a077386f9` |

Each patch was cherry-picked with `-x` to retain its source commit. Develop further PR changes on their original branches, then integrate the required updates here.

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

Keep the previous working installer until the upgraded build passes checks for the required features. Installing an official update replaces the personal build with official code; use builds from this branch while the extra patches are needed.
