# dependabot-gaps

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

## Why

`directory: "/"` is **not recursive**. In a monorepo every package, every Dockerfile folder and every composite action needs a directory in `dependabot.yml`, and nobody notices when the 12th package is added without one: version-update PRs just never come. `directories` globs, `exclude-paths`, workspaces (which Dependabot follows on its own) and the special GitHub Actions rules make it hard to eyeball. This tool applies those rules mechanically.

## Install

```bash
# needs Node 20+
git clone --branch v0.1.0 https://github.com/cosmichackerx/dependabot-gaps && cd dependabot-gaps
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
      - uses: cosmichackerx/dependabot-gaps@v0.1.0
        with:
          fail-on: warning        # error | warning | never
          # ignore: "examples/** third_party/**"
          # sarif-file: gaps.sarif  (then upload with github/codeql-action/upload-sarif)
```

Findings appear as annotations and as a table in the job summary.

## Rules

| Rule | Severity | Meaning |
|---|---|---|
| `uncovered-manifest` | warning (info under test/example/docs paths) | A manifest exists that no entry covers. |
| `unconfigured-ecosystem` | info | Manifests of an ecosystem that has **no entry at all**: usually a deliberate opt-out, so one line per ecosystem instead of a wall of warnings. `--all-ecosystems` turns them into gaps. |
| `unmatched-entry` | warning | An entry's directory (or glob) has no manifest of that ecosystem: Dependabot raises `dependency_file_not_found`. |
| `overlapping-entries` | error | Two entries for the same ecosystem and `target-branch` cover the same directory. |
| `directory-glob` | error | `directory: /apps/*` is taken literally; only `directories` expands globs. |
| `no-config` | error | Manifests exist but there is no `.github/dependabot.yml`; the suggestion is a complete file. |
| `invalid-config` / `config-unparseable` | error | Missing `version: 2`, unknown `package-ecosystem`, no `directory`/`directories`, no `schedule.interval` (not required for `multi-ecosystem-group` entries), or invalid YAML. |

## What it models (and where that comes from)

* **`directories` globs** follow `dependabot-core` (`updater/lib/dependabot/file_fetcher_command.rb`): a directory is a glob if it contains `*`, `?` or a `[..]` pair; the leading `/` is dropped and `Dir.glob(pattern, File::FNM_DOTMATCH)` selects directories. So `*` matches dot directories, `/**/*` means all depths below the root (not the root), and **a trailing `**` without `/` behaves like `*`** (Ruby semantics). `directory:` (singular) is always literal.
* **`exclude-paths`** is honoured (matches the manifest or a parent directory; relative to the entry directory or, to avoid false alarms, the repository root).
* **Workspaces:** manifests Dependabot fetches together with a covered one are not gaps: npm/yarn/pnpm `workspaces` and `pnpm-workspace.yaml`, Cargo `[workspace]`, Maven `<modules>`, uv `[tool.uv.workspace]`, and every Gradle build file below a covered `settings.gradle(.kts)` (settings files often compute their includes).
* **GitHub Actions:** `/` covers `.github/workflows/*.y(a)ml` and the root `action.yml`; a directory entry (or `/.github/workflows`) covers the YAML files in that folder; composite actions in subfolders need their own directory (`/.github/actions/*`).
* **Noise filters:** `node_modules`, `.git`, `vendor`, `third_party` and similar are skipped (`--include-vendored`); `package.json`/`composer.json`/`Cargo.toml`/`pyproject.toml` without any dependency table and `.csproj` files without a versioned `PackageReference` are ignored (central package management keeps versions elsewhere); paths containing test/example/fixture/demo/docs are `info`.
* `uv`/`bun`/`opentofu` are suggested instead of `pip`/`npm`/`terraform` when a `uv.lock`/`bun.lock`/`.opentofu.lock.hcl` sits next to the manifest.

These come from the [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) and the `dependabot-core` source, **not from observing Dependabot run**. I could not test against a live Dependabot, and I had no Ruby on the machine to execute `Dir.glob` itself; the glob behaviour is from Ruby's documentation. Treat a finding as "worth a look", and tell me where it is wrong.

## Measured on 238 real repositories

I ran v0.1.0 over the 240 top-starred public repositories of 20 languages that I had on disk for a related project (pushed after 2026-09-01), using tree-only clones (`--rev HEAD`). `oven-sh/bun` produced no result and `dotnet/aspnetcore` was skipped because reading hundreds of blobs lazily from a partial clone was too slow; **238 repositories** were analysed.

| | Repositories |
|---|---:|
| Have a `dependabot.yml`/`.yaml` | 102 |
| ...of which have at least one `uncovered-manifest` **warning** | 43 (42 %) |
| ...of which have an `unmatched-entry` warning | 10 |
| ...of which only have an `unconfigured-ecosystem` info (deliberate opt-out) | most of the rest |
| No `dependabot.yml` but at least one supported manifest | 130 of 136 |

Across the 102 configured repositories: 5471 manifest places, 486 directly covered, 1084 covered via a workspace, 893 ignored because they declare no dependencies, 2452 in ecosystems with no entry, and **556 uncovered manifests, reported as 374 warnings and 144 infos (one finding per directory and ecosystem)**; 13 `unmatched-entry` warnings.

**How I checked precision (and the limits):**

* A first pass flagged 2290 warnings; reading the output showed that large repos opt out of whole ecosystems on purpose (for example `symfony/symfony` only configures GitHub Actions), so ecosystem-level opt-out became its own info line. Ignoring dependency-less manifests, following workspaces and `.csproj` central package management then brought the total down to 374 warnings. These are changes I made **after seeing the numbers**, so the final table is tuned to this corpus.
* An independent Python script (own glob matcher, `pyyaml`) re-checked a random sample of **40 uncovered warnings** (seed 2026): in all 40 no entry of a compatible ecosystem has a matching directory and the manifest exists in the tree. An earlier sample of 40 exposed two real modelling gaps that I fixed: uv workspaces (`langgenius/dify`) and `/**` (`TriliumNext/Trilium`, now reported as `unmatched-entry` with an explanation instead of silently treated as recursive).
* All 13 `unmatched-entry` warnings were checked against the tree by hand; each points at a directory without a manifest of that ecosystem (for example `curl/curl`, `pi-hole/pi-hole`, `Stirling-PDF`, `openai/codex`).
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
* Tested on Linux, Windows and macOS in CI with a synthetic fixture suite (41 tests) and the corpus above, not against a live Dependabot.

## Development

```bash
npm ci
npm test            # typecheck + tests (node:test), no network
npm run bundle      # regenerate action/index.mjs (committed; CI fails if it is stale)
```

MIT licensed. See [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md).
