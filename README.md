# dependabot-gaps

[![CI](https://github.com/cosmichackerx/dependabot-gaps/actions/workflows/ci.yml/badge.svg)](https://github.com/cosmichackerx/dependabot-gaps/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cosmichackerx/dependabot-gaps?sort=semver)](https://github.com/cosmichackerx/dependabot-gaps/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Find what your `.github/dependabot.yml` forgets to update.** `dependabot-gaps` lists the manifests in your repository (monorepo packages, nested `package.json`, `Dockerfile`s, composite actions under `.github/actions/*`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, ...) that **no `updates` entry covers**, entries that point at a directory with nothing to update, overlapping entries, and `directory:` keys with a glob that Dependabot takes literally. Then it prints the entries to add (or appends them with `--fix`).

CLI + GitHub Action. Zero network access, SARIF output for code scanning, Node 20+.

```text
$ dependabot-gaps  # real output on curl/curl @ HEAD (shallow, tree-only clone, 2026-10-03)
warning  uncovered-manifest    github-actions: action.yml in /.github/actions/pkg-install is not covered by any updates entry
           .github/actions/pkg-install/action.yml
warning  unmatched-entry       updates[1] pip: directory "tests" matches no directory with a pip manifest
           .github/dependabot.yml:22
info     unconfigured-ecosystem  docker: 1 manifest(s) in 1 place(s) (/) and no docker entry at all: deliberate opt-out? (--all-ecosystems reports them as gaps)
           .github/dependabot.yml
info     uncovered-manifest    pip: requirements.txt in /tests/http is not covered by any updates entry (test/example/docs path, probably fine)
           tests/http/requirements.txt

Add under updates: in .github/dependabot.yml
  - package-ecosystem: "github-actions"
    directory: "/.github/actions/pkg-install"
    schedule:
      interval: "weekly"

7 manifest place(s) checked: 4 covered, 0 via workspace, 0 excluded by exclude-paths, 2 uncovered, 1 in ecosystems without any entry; 2 updates entries. 0 error, 2 warning, 2 info.
```

(What that shows: curl's `pip` entry lists `tests`, but the only requirements file is `tests/http/requirements.txt`, so Dependabot has nothing to read at `tests`; and the composite action `pkg-install` is not scanned because `directory: "/"` only covers `.github/workflows` and the root `action.yml`. I have not reported these upstream.)

## At a glance

|  | Lite (try it in a minute) | Full (keep it in CI) |
|---|---|---|
| How | clone, `npm ci`, `node dist/src/cli.js /path/to/repo` (see [Install](#install); `--rev HEAD` audits a repository without a checkout) | the [GitHub Action](#install) with [PR mode](#pull-request-mode-only-the-gaps-a-pr-introduces) (only the gaps a PR introduces) and `--fix` to append the missing entries |

### Validation / results

Every number below is from this repository's own tests or scripts (see the linked sections). "Not proven" is as important as "Result".

| What is claimed | Checked against | Size | Result | Not proven |
|---|---|---|---|---|
| Directory globs match like Dependabot's | Real Ruby `Dir.glob`, the call `dependabot-core` makes (differential check, committed fixture) | 47 hand-picked patterns; 4 x 5000 random patterns on a 40-directory tree | 47/47 identical; 9 mismatches in 20 000 random patterns (0.045 %), all of the shape `x/**/**/` | One fixed tree; the oracle is Ruby's glob, not Dependabot itself |
| Uncovered-manifest warnings are real | 238 public repositories (top-starred, 20 languages); an independent Python script re-checked a random sample | 40 random warnings | all 40 held (no compatible entry matches and the manifest exists) | I did not run Dependabot; a flagged manifest may be intentionally unmanaged; workspace handling is modelled only for the listed ecosystems |
| Rule logic | Unit tests on Linux, Windows, macOS (Node 20, 22, 24) | the `test/` suite | green | - |

**Releases:** 3 releases, v0.1.0 to v0.2.1, all published between 2026-10-02 and 2026-10-03 (days old). See [CHANGELOG.md](CHANGELOG.md) and the [Releases page](https://github.com/cosmichackerx/dependabot-gaps/releases). There is no weekly watcher for this tool; the ecosystem model is checked against the dependabot-core behaviour described in the README.

## Why

`directory: "/"` is **not recursive**. In a monorepo every package, every Dockerfile folder and every composite action needs a directory in `dependabot.yml`, and nobody notices when the 12th package is added without one: version-update PRs just never come. `directories` globs, `exclude-paths`, workspaces (which Dependabot follows on its own) and the special GitHub Actions rules make it hard to eyeball. This tool applies those rules mechanically.

## Install

```bash
# needs Node 20+
git clone --branch v0.2.1 https://github.com/cosmichackerx/dependabot-gaps && cd dependabot-gaps
npm ci                                  # also compiles the CLI (prepare script)
node dist/src/cli.js /path/to/your/repo # exit code 1 when something is uncovered
node dist/src/cli.js /path/to/repo --fix   # append the missing entries to .github/dependabot.yml
```

(No npm package yet; see the roadmap.) `--rev HEAD` reads a git revision without a checkout, so `git clone --depth 1 --filter=blob:none --no-checkout <url>` is enough to audit a big repo.

As a GitHub Action (composite, no nested actions, runs the committed bundle):

```yaml
name: dependabot-gaps
on:
  pull_request:
    paths: ["**/package.json", "**/Dockerfile", "**/action.yml", ".github/dependabot.yml", "**/pyproject.toml", "**/Cargo.toml"]
permissions:
  contents: read
jobs:
  gaps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: cosmichackerx/dependabot-gaps@v0.2.1
        with:
          fail-on: warning        # error | warning | never
          # ignore: "examples/** third_party/**"
          # sarif-file: gaps.sarif  (then upload with github/codeql-action/upload-sarif)
```

Findings appear as annotations and as a table in the job summary.

## Pull request mode: only the gaps a PR introduces

On a repository with 40 existing gaps a check that fails on every one gets switched off. `--base <ref>` analyses the base revision as well and reports **only findings the head adds**; the exit code follows those alone. Line numbers do not take part in the comparison (so reformatting `dependabot.yml` does not make old findings new).

```text
$ git checkout feature && dependabot-gaps --base main
warning  uncovered-manifest    npm: package.json in /apps/api is not covered by any updates entry
           apps/api/package.json
info     unconfigured-ecosystem  docker: 1 manifest(s) in 1 place(s) (/apps/api) and no docker entry at all: deliberate opt-out? ...
           .github/dependabot.yml

Add under updates: in .github/dependabot.yml
  - package-ecosystem: "npm"
    directory: "/apps/api"
    schedule:
      interval: "weekly"

Compared with main: 2 new, 1 existing and not shown, 0 resolved.
```

(`/apps/legacy` was uncovered before the PR and stays unreported; that run exits 1 because of the new warning.) In the Action it is switched on with `pr-mode: "true"` (or `base: <ref>`), and `comment: "true"` adds one **sticky comment** that is created once and updated on every push (same approach as [agent-context-diff](https://github.com/cosmichackerx/agent-context-diff)):

```yaml
on: pull_request
permissions:
  contents: read
  pull-requests: write      # only for the comment
jobs:
  gaps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0     # the base branch must be readable
      - uses: cosmichackerx/dependabot-gaps@v0.2.1
        with:
          comment: "true"      # implies pr-mode: true; use pr-mode: "true" alone for the check without a comment
```

The comment is skipped (with a notice) for pull requests from forks, whose token is read-only, and a token without `pull-requests: write` only produces a warning; the job result never depends on the comment. Without `fetch-depth: 0` the action tries `git fetch --depth=1 origin <base>` and fails with a clear message if that is not possible (for example credentials removed on a private repository).

## Rules

| Rule | Severity | Meaning |
|---|---|---|
| `uncovered-manifest` | warning (info under test/example/docs paths) | A manifest exists that no entry covers. |
| `unconfigured-ecosystem` | info | Manifests of an ecosystem that has **no entry at all**: usually a deliberate opt-out, so one line per ecosystem instead of a wall of warnings. `--all-ecosystems` turns them into gaps. |
| `unmatched-entry` | warning | An entry's directory (or glob) has no manifest of that ecosystem: Dependabot raises `dependency_file_not_found`. |
| `overlapping-entries` | error | Two entries for the same ecosystem and `target-branch` cover the same directory. |
| `directory-glob` | error | `directory: /apps/*` is taken literally; only `directories` expands globs. |
| `unsupported-version-catalog` | warning | A Gradle version catalog such as `gradle/deps.versions.toml` or `catalog/libs.versions.toml`: the Dependabot docs list only `gradle/libs.versions.toml`, so versions in other catalogs get no update PRs (custom catalogs: [dependabot-core#8079](https://github.com/dependabot/dependabot-core/issues/8079), still open when checked on 2026-10-03). Only reported when the config has a `gradle` entry. |
| `no-config` | error | Manifests exist but there is no `.github/dependabot.yml`; the suggestion is a complete file. |
| `invalid-config` / `config-unparseable` | error | Missing `version: 2`, unknown `package-ecosystem`, no `directory`/`directories`, no `schedule.interval` (not required for `multi-ecosystem-group` entries), or invalid YAML. |

## What it models (and where that comes from)

* **`directories` globs** follow `dependabot-core` (`updater/lib/dependabot/file_fetcher_command.rb`): a directory is a glob if it contains `*`, `?` or a `[..]` pair; the leading `/` is dropped and `Dir.glob(pattern, File::FNM_DOTMATCH)` selects directories. `directory:` (singular) is always literal. Since v0.2.0 the glob model is **differentially tested against real Ruby** (see below), which corrected three things I had wrong in v0.1.0:
  * with `FNM_DOTMATCH` a wildcard also matches the `.` entry, so `/apps/*` selects `/apps` itself, and `/*` or `/**/*` select the **repository root** (v0.1.0 claimed `/**/*` excluded the root);
  * that `.` is only yielded before any wildcard has consumed a real directory (`/*/*` does not yield the root, `/*/?` does not yield `.github`);
  * `**` only recurses when followed by `/`; a trailing `**` is `*`, and `x/**/` selects `x` itself plus everything below it.
* **`exclude-paths`** is honoured (matches the manifest or a parent directory; relative to the entry directory or, to avoid false alarms, the repository root).
* **Workspaces:** manifests Dependabot fetches together with a covered one are not gaps: npm/yarn/pnpm `workspaces` and `pnpm-workspace.yaml`, Cargo `[workspace]`, Maven `<modules>`, uv `[tool.uv.workspace]`, and every Gradle build file below a covered `settings.gradle(.kts)` (settings files often compute their includes).
* **GitHub Actions:** `/` covers `.github/workflows/*.y(a)ml` and the root `action.yml`; a directory entry (or `/.github/workflows`) covers the YAML files in that folder; composite actions in subfolders need their own directory (`/.github/actions/*`).
* **Noise filters:** `node_modules`, `.git`, `vendor`, `third_party` and similar are skipped (`--include-vendored`); `package.json`/`composer.json`/`Cargo.toml`/`pyproject.toml` without any dependency table and `.csproj` files without a versioned `PackageReference` are ignored (central package management keeps versions elsewhere); paths containing test/example/fixture/demo/docs are `info`.
* `uv`/`bun`/`opentofu` are suggested instead of `pip`/`npm`/`terraform` when a `uv.lock`/`bun.lock`/`.opentofu.lock.hcl` sits next to the manifest.

These come from the [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) and the `dependabot-core` source, **not from observing Dependabot run**. I could not test against a live Dependabot. The glob expansion is checked against real Ruby (below), but whether Dependabot's own pipeline (for example its handling of `exclude-paths`, or any later change to `file_fetcher_command.rb`) matches that call was read from the source, not observed. Treat a finding as "worth a look", and tell me where it is wrong.

## Glob model vs real Ruby (differential check)

`scripts/glob-differential.rb` runs the call `dependabot-core` makes to expand `directories` (`Dir.glob(pattern.delete_prefix("/"), File::FNM_DOTMATCH)`, directories only) on a fixed 40-directory tree. The result is committed as `test/fixtures/glob-ruby.json` (generated with Ruby 4.0.6; Ruby 3.4.8 gave identical output) and `test/differential.test.ts` asserts that `src/glob.ts` selects exactly the same directories for 47 hand-picked patterns. CI regenerates the fixture with the runner's Ruby and fails on any difference, and fuzzes 3000 random patterns (`scripts/glob-fuzz.mjs`).

| Check | Result |
|---|---|
| 47 hand-picked patterns (literal, `x/*`, `/*`, `/**/*`, `x/**`, `x/**/`, braces, classes, dot dirs) | all identical to Ruby |
| Random patterns, seeds 1-4 x 5000 | 1, 3, 3 and 2 mismatches (9 / 20000 = 0.045 %), **all of the shape `x/**/**/`** (two consecutive `**/` after a prefix); not modelled |

"Identical" is on that fixed tree only, not a proof for every possible tree, and the oracle is Ruby's `Dir.glob`, not Dependabot itself. Run `RUBY=ruby node scripts/glob-fuzz.mjs 5000 <seed>` to try more.

## Measured on 238 real repositories

I ran v0.1.0 over the 240 top-starred public repositories of 20 languages that I had on disk for a related project (pushed after 2026-09-01), using tree-only clones (`--rev HEAD`). `oven-sh/bun` produced no result and `dotnet/aspnetcore` was skipped because reading hundreds of blobs lazily from a partial clone was too slow; **238 repositories** were analysed.

| | Repositories |
|---|---:|
| Have a `dependabot.yml`/`.yaml` | 102 |
| ...of which have at least one `uncovered-manifest` **warning** | 43 (42 %) |
| ...of which have an `unmatched-entry` warning | 10 |
| ...of which only have an `unconfigured-ecosystem` info (deliberate opt-out) | most of the rest |
| No `dependabot.yml` but at least one supported manifest | 130 of 136 |

Across the 102 configured repositories: 5471 manifest places, 486 directly covered, 1084 covered via a workspace, 893 ignored because they declare no dependencies, 2452 in ecosystems with no entry, and **uncovered manifests reported as 350 warnings and 143 infos (one finding per directory and ecosystem)** with v0.2.0 (v0.1.0 said 374 and 144; the 24 fewer warnings are all `TriliumNext/Trilium`, whose `directories: ["/**"]` does select the repository root once the Ruby `.` rule is modelled); 12 `unmatched-entry` warnings (13 in v0.1.0; the difference is Trilium's `/**`). The other counts in this paragraph are from the v0.1.0 run.

**How I checked precision (and the limits):**

* A first pass flagged 2290 warnings; reading the output showed that large repos opt out of whole ecosystems on purpose (for example `symfony/symfony` only configures GitHub Actions), so ecosystem-level opt-out became its own info line. Ignoring dependency-less manifests, following workspaces and `.csproj` central package management then brought the total down to 374 warnings. These are changes I made **after seeing the numbers**, so the final table is tuned to this corpus.
* An independent Python script (own glob matcher, `pyyaml`) re-checked a random sample of **40 uncovered warnings** (seed 2026): in all 40 no entry of a compatible ecosystem has a matching directory and the manifest exists in the tree. An earlier sample of 40 exposed two real modelling gaps that I fixed: uv workspaces (`langgenius/dify`) and `/**` (`TriliumNext/Trilium`; in v0.1.0 I handled `/**` as 'matches nothing', and the Ruby check showed it matches the root and the top-level directories).
* All 13 v0.1.0 `unmatched-entry` warnings (12 still apply) were checked against the tree by hand; each points at a directory without a manifest of that ecosystem (for example `curl/curl`, `pi-hole/pi-hole`, `Stirling-PDF`, `openai/codex`).
* **Not verified:** that Dependabot really skips these manifests (I did not run Dependabot), that every flagged manifest *wants* updates (some are intentionally unmanaged; use `--ignore` or `exclude-paths`), and workspace handling for ecosystems other than the ones listed. Some large repos set `open-pull-requests-limit: 0` and use Dependabot only for alerts; this tool does not look at that.

## How it compares

I searched GitHub, npm, PyPI and crates.io before building this (2026-10). Honest summary:

| Tool | What it does | Difference |
|---|---|---|
| [sisakulint](https://github.com/sisaku-security/sisakulint) `dependabot-ecosystem` rule | Warns when a lockfile-bearing ecosystem is missing from `dependabot.yml` | Looks at repository-root files; no per-directory/monorepo coverage, `directories` globs or workspaces |
| [thisbejim/dependabot-map](https://github.com/thisbejim/dependabot-map), [funnyhcat-dotcom/dependabot-config-doctor](https://github.com/funnyhcat-dotcom/dependabot-config-doctor) | Small tools in the same area (0 stars when I looked) | I did not evaluate them in depth; check whether they fit |
| Ad-hoc workflows (e.g. in [groupsky/ya-modbus](https://github.com/groupsky/ya-modbus/blob/cce56819f22fced026a02165fb62e6346877cbce/.github/workflows/dependabot-verify.yml)) | Walk the tree, compare with the config | Repo-specific scripts; this tool is generic |
| Dependabot itself | Reports a failure only for configured directories | Never tells you about directories you did not configure |
| Renovate | Discovers manifests automatically | A different tool; if you use it you do not have this problem |

## CLI

```text
dependabot-gaps [path] [options]

  -C, --cwd <dir>        run as if started in <dir> (default: .)
      --rev <ref>        read the files of a git revision instead of the working tree
  -f, --format <fmt>     text | markdown | json | github | sarif   (default: text)
  -o, --output <file>    write the report to a file
      --base <ref>       pull request mode: report only gaps the head introduces
      --fail-on <level>  exit 1 on: error | warning | never   (default: warning)
      --ignore <glob>    leave matching paths out (repeatable)
      --include-vendored also look into vendor/, third_party/, extern/
      --all-ecosystems   treat ecosystems with no updates entry at all as gaps
      --strict-paths     report gaps under test/example/docs paths as warnings
      --fix              append the missing entries to .github/dependabot.yml (creates it when absent)
      --list-rules       print the rule ids and exit
```

Exit codes: `0` ok, `1` findings at or above `--fail-on`, `2` usage or read error. `--fix` writes only to `.github/dependabot.yml` (or `.yaml`), uses `interval: weekly`, and exits `0`; read the diff and add `groups`/`cooldown` as you like.

## Limitations

* Static analysis of file names and a few manifest fields; Dependabot's real manifest detection is per ecosystem and more detailed (for example NuGet follows project references, pip follows `-r` includes; those are not modelled, so some reported gaps may be handled in practice).
* Multi-branch setups (`target-branch`) are only used to decide overlaps.
* Private registries, `ignore`, `allow` and `groups` are not analysed.
* Reading a git revision from a partial clone fetches blobs one by one and is slow on repositories with thousands of manifests.
* Tested on Linux, Windows and macOS in CI with a synthetic fixture suite (53 tests) and the corpus above, not against a live Dependabot.

## Development

```bash
npm ci
npm test            # typecheck + tests (node:test), no network
npm run bundle      # regenerate action/index.mjs (committed; CI fails if it is stale)
```

MIT licensed. See [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md).

## Related tools

Small, independent tools by the same author, for build and CI hygiene and for migrations with a deadline. Each works on its own; none requires another.

**Gradle and Android migrations**

* [gradle-version-catalog-lint](https://github.com/cosmichackerx/gradle-version-catalog-lint): Lints `libs.versions.toml`: unused libraries, plugins and versions, dynamic or SNAPSHOT versions, hard-coded dependencies.
* [gradle10-ready](https://github.com/cosmichackerx/gradle10-ready): Static scan of Gradle build scripts for what Gradle 10 removes (space assignment, multi-string dependencies, Kotlin DSL delegates). `--fix`, PR mode.
* [agp9-ready](https://github.com/cosmichackerx/agp9-ready): Static scan of Gradle files for what Android Gradle Plugin 9 and 10 break (built-in Kotlin, legacy variant API, opt-outs), including `buildSrc`. `--fix`, PR mode.
* [kotlin24-ready](https://github.com/cosmichackerx/kotlin24-ready): Static scan of Gradle build scripts for what Kotlin 2.4 removes in the Kotlin Gradle plugin (language version 1.9, KMP `targetHierarchy`, Compose options, ABI validation). `--fix`, PR mode.
* [android-target-ready](https://github.com/cosmichackerx/android-target-ready): Static scanner for the targetSdk 36 / 37 migration in app code and manifests (edge-to-edge, predictive back, large screens).
* [android-target-lint](https://github.com/cosmichackerx/android-target-lint): The same targetSdk migration checks as real Android Lint rules (a lint jar with type resolution).

**CI and repository hygiene**

* [node24-ready](https://github.com/cosmichackerx/node24-ready): Finds GitHub Actions still on the removed Node 20 runtime, also inside composite actions and reusable workflows, and the smallest node24 upgrade.
* [sha256-ready](https://github.com/cosmichackerx/sha256-ready): Finds code that assumes 40-character Git hashes before Git 3.0 makes SHA-256 repositories the default.
* [helm4-ready](https://github.com/cosmichackerx/helm4-ready): Finds the Helm 3 CLI usage (removed and deprecated flags, executable post-renderers, `registry login` URLs, Helm 3 pins) that Helm 4 rejects in CI workflows, scripts and Makefiles, checked against real Helm 3.22.0 and 4.3.0.
* [agent-context-diff](https://github.com/cosmichackerx/agent-context-diff): Diffs `AGENTS.md`, `CLAUDE.md`, Cursor rules and MCP configs between git refs (new servers, widened permissions, hidden Unicode).

