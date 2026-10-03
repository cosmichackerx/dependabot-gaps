# Changelog

## Unreleased

* CI: README test count and action pins are checked by [claims-check](https://github.com/cosmichackerx/claims-check) (`.claims.json`). The first run found the README saying 41 tests while the suite has 53; fixed.

## 0.2.1 - 2026-10-03

* New rule `unsupported-version-catalog` (warning): a Gradle version catalog other than `gradle/libs.versions.toml` is not read by Dependabot (docs list only the standard catalog; custom catalogs: dependabot-core#8079). Reported only when the config has a `gradle` entry (or with `--all-ecosystems`); catalogs under test/example paths are `info`.

## 0.2.0 - 2026-10-03

* **Pull request mode** (`--base <ref>`; Action inputs `pr-mode`, `base`, `comment`; opt-in, so existing workflows keep their full report): only findings the head introduces are reported and counted; optional **sticky PR comment** (`comment: true`, skipped for forks, never fails the job); CI proves exactly one comment after two runs.
* Glob model rewritten as a segment walker and **differentially tested against real Ruby `Dir.glob`** (fixture + CI job + fuzz script). Fixes: `.` matching under `FNM_DOTMATCH` (`/apps/*` covers `/apps`, `/**/*` covers the root), `x/**/` includes `x`.
* Dependabot housekeeping: actions bumped to checkout 7.0.1 / setup-node 7.0.0 (SHA-pinned), TypeScript 7, esbuild 0.28.2.

## 0.1.0 - 2026-10-03

First release.

* Finds manifests no `updates` entry covers (`uncovered-manifest`), entries that match nothing (`unmatched-entry`), overlapping entries (`overlapping-entries`), `directory:` with a glob (`directory-glob`), a missing file (`no-config`) and invalid/unparseable configuration.
* `directories` globbing follows `dependabot-core` (`Dir.glob` with `FNM_DOTMATCH`); `directory` (singular) is literal; `exclude-paths` honoured.
* Understands what Dependabot fetches with a covered manifest: npm/yarn/pnpm workspaces, Cargo workspaces, Maven modules, Gradle subprojects.
* GitHub Actions: `/` covers `.github/workflows` and the root `action.yml`; composite actions in subfolders need their own directory.
* Precision filters: ecosystems with no entry at all are one info line (deliberate opt-out); manifests without dependencies are ignored; test/example/docs paths are `info`; `node_modules`, `vendor` etc. skipped.
* Output: text, markdown, json, GitHub annotations, SARIF 2.1.0; `--fix` appends the missing entries; `--rev` reads a git revision without a checkout.
* Composite GitHub Action with a committed bundle (no nested actions), Marketplace metadata.
