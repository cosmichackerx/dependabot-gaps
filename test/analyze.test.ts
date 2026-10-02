import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cfg, entry, rules, run } from './helpers.js';

const pkg = '{"dependencies":{"a":"1"}}';

test('no dependabot.yml: one error with a ready-to-use file', () => {
  const r = run({ 'package.json': pkg, 'Dockerfile': 'FROM node:22' });
  assert.deepEqual(rules(r), ['no-config:error']);
  assert.match(r.suggestion ?? '', /package-ecosystem: "docker"/);
  assert.match(r.suggestion ?? '', /package-ecosystem: "npm"/);
});

test('no manifests and no config is clean', () => {
  assert.deepEqual(rules(run({ 'README.md': '# hi' })), []);
});

test('root entry covers the root manifest only: nested package.json is a gap', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'apps/web/package.json': pkg });
  assert.deepEqual(rules(r), ['uncovered-manifest:warning']);
  assert.equal(r.findings[0]!.directory, '/apps/web');
  assert.match(r.suggestion ?? '', /directory: "\/apps\/web"/);
  assert.equal(r.summary.covered, 1);
});

test('directories globs cover nested manifests', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', ['/', '/apps/*'])), 'package.json': pkg, 'apps/web/package.json': pkg, 'apps/api/package.json': pkg, 'apps/api/src/package.json': pkg });
  assert.deepEqual(rules(r), ['uncovered-manifest:warning']);
  assert.equal(r.findings[0]!.directory, '/apps/api/src');
});

test('singular directory with a glob is flagged and does not cover', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/apps/*')), 'apps/web/package.json': pkg });
  assert.ok(rules(r).includes('directory-glob:error'));
  assert.ok(rules(r).includes('uncovered-manifest:warning'));
});

test('workflows are covered by "/" or by /.github/workflows; composite actions in subfolders are not', () => {
  const files = { '.github/workflows/ci.yml': 'on: push', '.github/actions/setup/action.yml': 'name: x' };
  const a = run({ '.github/dependabot.yml': cfg(entry('github-actions', '/')), ...files });
  assert.deepEqual(rules(a), ['uncovered-manifest:warning']);
  assert.equal(a.findings[0]!.directory, '/.github/actions/setup');
  const b = run({ '.github/dependabot.yml': cfg(entry('github-actions', ['/', '/.github/actions/*'])), ...files });
  assert.deepEqual(rules(b), []);
  const c = run({ '.github/dependabot.yml': cfg(entry('github-actions', '/.github/workflows')), '.github/workflows/ci.yml': 'on: push' });
  assert.deepEqual(rules(c), []);
});

test('exclude-paths removes a manifest from the gaps', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/', '    exclude-paths:\n      - "legacy/**"\n')), 'package.json': pkg, 'legacy/old/package.json': pkg });
  // legacy/old is not under the "/" entry's directory scope, so it is still a gap
  assert.deepEqual(rules(r), ['uncovered-manifest:warning']);
  const r2 = run({ '.github/dependabot.yml': cfg(entry('npm', ['/', '/legacy/*'], '    exclude-paths:\n      - "legacy/**"\n')), 'package.json': pkg, 'legacy/old/package.json': pkg });
  assert.deepEqual(rules(r2), []);
  assert.equal(r2.summary.excluded, 1);
});

test('npm workspaces: members of a covered root are not gaps', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': '{"workspaces":["packages/*"]}', 'packages/a/package.json': pkg, 'packages/b/package.json': pkg, 'tools/c/package.json': pkg });
  assert.deepEqual(rules(r), ['uncovered-manifest:warning']);
  assert.equal(r.findings[0]!.directory, '/tools/c');
  assert.equal(r.summary.coveredViaWorkspace, 2);
});

test('pnpm-workspace.yaml with negation', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "!apps/skip"\n', 'apps/a/package.json': pkg, 'apps/skip/package.json': pkg });
  assert.equal(r.summary.coveredViaWorkspace, 1);
  assert.equal(r.findings[0]!.directory, '/apps/skip');
});

test('cargo workspace members and maven modules and gradle includes', () => {
  const cargo = run({ '.github/dependabot.yml': cfg(entry('cargo', '/')), 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/old"]\n', 'crates/a/Cargo.toml': '[dependencies]\nx = "1"', 'crates/old/Cargo.toml': '[dependencies]\nx = "1"' });
  assert.equal(cargo.summary.coveredViaWorkspace, 1);
  assert.equal(cargo.findings[0]!.directory, '/crates/old');
  const maven = run({ '.github/dependabot.yml': cfg(entry('maven', '/')), 'pom.xml': '<project><modules><module>core</module><module>web</module></modules></project>', 'core/pom.xml': '', 'web/pom.xml': '', 'extra/pom.xml': '' });
  assert.equal(maven.summary.coveredViaWorkspace, 2);
  assert.equal(maven.findings[0]!.directory, '/extra');
  const gradle = run({ '.github/dependabot.yml': cfg(entry('gradle', '/')), 'settings.gradle.kts': 'include(":app", ":libs:util")', 'build.gradle.kts': '', 'app/build.gradle.kts': '', 'libs/util/build.gradle.kts': '', 'other/build.gradle.kts': '' });
  assert.equal(gradle.summary.coveredViaWorkspace, 3); // every build file below a covered settings file
});

test('an entry for a directory without a manifest of that ecosystem is reported', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/'), entry('pip', '/server')), 'package.json': pkg });
  assert.deepEqual(rules(r), ['unmatched-entry:warning']);
  assert.match(r.findings[0]!.message, /"\/server" matches no directory with a pip manifest/);
  assert.ok((r.findings[0]!.line ?? 0) > 0);
});

test('overlapping entries for the same ecosystem and target branch', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', ['/', '/apps/*']), entry('npm', '/apps/web')), 'package.json': pkg, 'apps/web/package.json': pkg });
  assert.deepEqual(rules(r), ['overlapping-entries:error']);
  const ok = run({ '.github/dependabot.yml': cfg(entry('npm', '/'), entry('npm', '/apps/web', '    target-branch: develop\n')), 'package.json': pkg, 'apps/web/package.json': pkg });
  assert.deepEqual(rules(ok), []);
});

test('test, example and docs paths are info, not warnings; --strict-paths makes them warnings', () => {
  const files = { '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'examples/demo/package.json': pkg };
  assert.deepEqual(rules(run(files)), ['uncovered-manifest:info']);
  assert.deepEqual(rules(run(files, { strictPaths: true })), ['uncovered-manifest:warning']);
  assert.equal(run(files).suggestion, undefined);
});

test('node_modules, vendor and --ignore are skipped; --include-vendored brings vendor back', () => {
  const files = { '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'node_modules/x/package.json': pkg, 'vendor/y/package.json': pkg, 'tools/z/package.json': pkg };
  assert.equal(run(files).findings.length, 1);
  assert.equal(run(files, { includeVendored: true }).findings.length, 2);
  const ig = run(files, { ignore: ['tools/**'] });
  assert.equal(ig.findings.length, 0);
  assert.equal(ig.summary.ignored, 1);
});

test('lockfile decides uv/bun; all .tf files of a directory are one place', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'svc/pyproject.toml': '[project]\ndependencies = ["a"]', 'svc/uv.lock': '', 'infra/main.tf': '', 'infra/vars.tf': '' }, { allEcosystems: true });
  assert.equal(r.findings.length, 2);
  assert.match(r.suggestion ?? '', /package-ecosystem: "uv"/);
  assert.match(r.suggestion ?? '', /package-ecosystem: "terraform"/);
});

test('invalid configuration: version, ecosystem, directory, schedule', () => {
  const bad = 'version: 1\nupdates:\n  - package-ecosystem: "npmm"\n    directory: "/"\n    schedule:\n      interval: weekly\n  - package-ecosystem: npm\n    schedule: {}\n';
  const r = run({ '.github/dependabot.yml': bad, 'package.json': pkg });
  const msgs = r.findings.filter((f) => f.rule === 'invalid-config').map((f) => f.message).join(' | ');
  assert.match(msgs, /version: 2/);
  assert.match(msgs, /unknown package-ecosystem `npmm`/);
  assert.match(msgs, /`directory` or `directories` is required/);
  assert.match(msgs, /schedule\.interval/);
});

test('unparseable YAML is one error, not a crash', () => {
  const r = run({ '.github/dependabot.yml': 'updates: [\n', 'package.json': pkg });
  assert.deepEqual(rules(r), ['config-unparseable:error']);
});

test('multi-ecosystem-group entries do not need their own schedule', () => {
  const y = 'version: 2\nmulti-ecosystem-groups:\n  infra:\n    schedule:\n      interval: weekly\nupdates:\n  - package-ecosystem: npm\n    directory: "/"\n    multi-ecosystem-group: infra\n';
  assert.deepEqual(rules(run({ '.github/dependabot.yml': y, 'package.json': pkg })), []);
});

test('ecosystems without any entry are one info line (deliberate opt-out), not a wall of warnings', () => {
  const files = { '.github/dependabot.yml': cfg(entry('github-actions', '/')), '.github/workflows/ci.yml': 'on: push', 'a/composer.json': '{"require":{"p/q":"1"}}', 'b/composer.json': '{"require":{"p/q":"1"}}', 'c/composer.json': '{"require":{"p/q":"1"}}' };
  const r = run(files);
  assert.deepEqual(rules(r), ['unconfigured-ecosystem:info']);
  assert.match(r.findings[0]!.message, /composer: 3 manifest\(s\) in 3 place\(s\)/);
  assert.equal(r.summary.optedOut, 3);
  assert.equal(r.summary.uncovered, 0);
  const all = run(files, { allEcosystems: true });
  assert.equal(all.findings.filter((f) => f.rule === 'uncovered-manifest' && f.severity === 'warning').length, 3);
});

test('gradle: build files below a covered settings file are members even when includes are computed', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('gradle', '/')), 'settings.gradle': 'rootProject.name = "x"\nnew File("modules").eachDir { include it.name }', 'build.gradle': '', 'modules/a/build.gradle': '', 'modules/b/build.gradle': '' });
  assert.deepEqual(rules(r), []);
  assert.equal(r.summary.coveredViaWorkspace, 2);
});

test('uncovered package.json / composer.json / Cargo.toml without dependencies are not gaps', () => {
  const files = { '.github/dependabot.yml': cfg(entry('npm', '/'), entry('composer', '/'), entry('cargo', '/')), 'package.json': pkg, 'composer.json': '{"require":{"a/b":"^1"}}', 'Cargo.toml': '[dependencies]\na = "1"\n', 'x/package.json': '{"name":"x","version":"1.0.0"}', 'y/package.json': '{"devDependencies":{"a":"1"}}', 'z/composer.json': '{"autoload":{}}', 'w/Cargo.toml': '[package]\nname = "w"\n' };
  const r = run(files);
  assert.deepEqual(r.findings.map((f) => f.directory), ['/y']);
  assert.equal(r.summary.noDependencies, 3);
});

test('csproj / pyproject without dependency declarations are not gaps; with an inline version they are', () => {
  const files = { '.github/dependabot.yml': cfg(entry('nuget', '/a'), entry('pip', '/')), 'a/a.csproj': '<Project><ItemGroup><PackageReference Include="X" Version="1.0.0"/></ItemGroup></Project>', 'b/b.csproj': '<Project><ItemGroup><PackageReference Include="X"/></ItemGroup></Project>', 'c/c.csproj': '<Project><ItemGroup><PackageReference Include="Y" Version="2.0.0" /></ItemGroup></Project>', 'pyproject.toml': '[project]\ndependencies = ["a"]\n', 'lib/pyproject.toml': '[build-system]\nrequires = ["setuptools"]\n' };
  const r = run(files);
  assert.deepEqual(r.findings.map((f) => f.directory), ['/c']);
  assert.equal(r.summary.noDependencies, 2);
});

test('uv workspace members are covered with their root', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('uv', '/api')), 'api/pyproject.toml': '[project]\ndependencies = ["a"]\n[tool.uv.workspace]\nmembers = ["providers/*"]\nexclude = ["providers/skip"]\n', 'api/providers/x/pyproject.toml': '[project]\ndependencies = ["b"]', 'api/providers/skip/pyproject.toml': '[project]\ndependencies = ["b"]' });
  assert.equal(r.summary.coveredViaWorkspace, 1);
  assert.equal(r.findings[0]!.directory, '/api/providers/skip');
});

test('a trailing ** without a slash behaves like * (Ruby Dir.glob) and is explained', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', ['/**'])), 'apps/web/package.json': pkg });
  assert.ok(r.findings.some((f) => f.rule === 'unmatched-entry' && /behaves like `\*`/.test(f.message)));
  assert.ok(r.findings.some((f) => f.rule === 'uncovered-manifest'));
  const ok = run({ '.github/dependabot.yml': cfg(entry('npm', ['/**/*'])), 'apps/web/package.json': pkg });
  assert.deepEqual(rules(ok), []);
});
