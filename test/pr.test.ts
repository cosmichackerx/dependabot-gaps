import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diffResults, findingKey } from '../src/pr.js';
import { renderMarkdown, renderText } from '../src/report.js';
import { cfg, entry, run } from './helpers.js';

const pkg = '{"dependencies":{"a":"1"}}';
const base = { '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, 'apps/old/package.json': pkg };

test('PR mode: pre-existing gaps are not reported, only the gap the PR adds', () => {
  const head = { ...base, 'apps/new/package.json': pkg };
  const r = diffResults(run(base), run(head), 'origin/main');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0]!.directory, '/apps/new');
  assert.equal(r.pr.existing, 1, 'apps/old stays unreported');
  assert.equal(r.pr.resolved, 0);
  assert.match(r.suggestion ?? '', /directory: "\/apps\/new"/);
  assert.ok(!(r.suggestion ?? '').includes('/apps/old'));
});

test('PR mode: unrelated edits that shift line numbers do not make old findings new; fixing a gap counts as resolved', () => {
  const shifted = { ...base, '.github/dependabot.yml': `# comment\n# another\n${cfg(entry('npm', '/'))}` };
  assert.equal(diffResults(run(base), run(shifted), 'b').findings.length, 0);
  const fixed = { ...base, '.github/dependabot.yml': cfg(entry('npm', ['/', '/apps/*'])) };
  const r = diffResults(run(base), run(fixed), 'b');
  assert.equal(r.findings.length, 0);
  assert.equal(r.pr.resolved, 1);
});

test('PR mode: a PR that breaks the config or removes dependabot.yml is reported', () => {
  const broken = diffResults(run(base), run({ ...base, '.github/dependabot.yml': cfg(entry('npm', '/'), entry('npm', '/')) }), 'b');
  assert.ok(broken.findings.some((f) => f.rule === 'overlapping-entries'));
  const removed = diffResults(run(base), run({ 'package.json': pkg }), 'b');
  assert.deepEqual(removed.findings.map((f) => f.rule), ['no-config']);
  const stale = diffResults(run(base), run({ ...base, '.github/dependabot.yml': cfg(entry('npm', '/'), entry('npm', '/nowhere')) }), 'b');
  assert.ok(stale.findings.some((f) => f.rule === 'unmatched-entry'));
});

test('PR mode: ecosystem opt-out info is keyed by ecosystem, not by its changing counts', () => {
  const one = { '.github/dependabot.yml': cfg(entry('npm', '/')), 'package.json': pkg, Dockerfile: 'FROM node:22' };
  const two = { ...one, 'tools/Dockerfile': 'FROM node:22' };
  const r = diffResults(run(one), run(two), 'b');
  assert.ok(!r.findings.some((f) => f.rule === 'unconfigured-ecosystem'));
  assert.equal(findingKey({ rule: 'no-config', severity: 'error', file: 'x', message: 'a' }), findingKey({ rule: 'no-config', severity: 'error', file: 'y', message: 'b' }));
});

test('PR mode report wording: new / existing / resolved, and an explicit all-clear', () => {
  const clean = diffResults(run(base), run(base), 'origin/main');
  assert.match(renderMarkdown(clean), /gaps this pull request introduces/);
  assert.match(renderMarkdown(clean), /No new gaps introduced/);
  assert.match(renderText(clean), /0 new, 1 existing and not shown, 0 resolved/);
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

test('CLI --base: exit code follows only the new gaps (real git repository)', () => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'dg-pr-'));
  const put = (files: Record<string, string>): void => {
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
  };
  git(dir, 'init', '-q', '-b', 'main');
  put(base);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const exec = (...a: string[]) => spawnSync(process.execPath, [cli, dir, ...a], { encoding: 'utf8' });
  assert.equal(exec().status, 1, 'the full report fails on the old gap');
  assert.equal(exec('--base', 'HEAD').status, 0, 'but nothing is new against itself');
  git(dir, 'checkout', '-q', '-b', 'feature');
  put({ 'apps/new/package.json': pkg });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'add package');
  const bad = exec('--base', 'main');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /\/apps\/new/);
  assert.ok(!bad.stdout.includes('/apps/old'));
  assert.match(bad.stdout, /1 new, 1 existing and not shown/);
  assert.equal(exec('--base', 'no-such-ref').status, 2);
  assert.equal(exec('--base', 'main', '--fix').status, 2);
});
