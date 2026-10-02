import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const exec = (args: string[], cwd?: string) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dgaps-'));
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, c);
  }
  return dir;
}
const y = 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: "/"\n    schedule:\n      interval: weekly\n  - package-ecosystem: docker\n    directory: "/"\n    schedule:\n      interval: weekly\n';

test('exit codes: 1 when gaps, 0 with --fail-on never, 2 on usage errors', () => {
  const dir = repo({ '.github/dependabot.yml': y, 'package.json': '{"dependencies":{"a":"1"}}', 'Dockerfile': 'FROM y', 'api/Dockerfile': 'FROM x' });
  assert.equal(exec([dir]).status, 1);
  assert.equal(exec([dir, '--fail-on', 'never']).status, 0);
  assert.equal(exec(['--bogus']).status, 2);
  assert.equal(exec([dir, '--format', 'xml']).status, 2);
});

test('formats: json, sarif, github, markdown', () => {
  const dir = repo({ '.github/dependabot.yml': y, 'package.json': '{"dependencies":{"a":"1"}}', 'Dockerfile': 'FROM y', 'api/Dockerfile': 'FROM x' });
  const json = JSON.parse(exec([dir, '-f', 'json']).stdout) as { findings: { rule: string }[]; suggestion: string };
  assert.equal(json.findings[0]!.rule, 'uncovered-manifest');
  assert.match(json.suggestion, /docker/);
  const sarif = JSON.parse(exec([dir, '-f', 'sarif']).stdout) as { version: string; runs: { results: { ruleId: string }[] }[] };
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0]!.results[0]!.ruleId, 'uncovered-manifest');
  assert.match(exec([dir, '-f', 'github']).stdout, /^::warning file=api\/Dockerfile,title=uncovered-manifest::/);
  assert.match(exec([dir, '-f', 'markdown']).stdout, /\| warning \| `uncovered-manifest`/);
});

test('--fix appends the missing entries and a second run is clean', () => {
  const dir = repo({ '.github/dependabot.yml': y, 'package.json': '{"dependencies":{"a":"1"}}', 'Dockerfile': 'FROM y', 'api/Dockerfile': 'FROM x' });
  assert.equal(exec([dir, '--fix']).status, 0);
  assert.match(readFileSync(join(dir, '.github/dependabot.yml'), 'utf8'), /package-ecosystem: "docker"\n    directory: "\/api"/);
  assert.equal(exec([dir]).status, 0);
});

test('--fix creates the file when there is none', () => {
  const dir = repo({ 'go.mod': 'module x' });
  assert.equal(exec([dir, '--fix']).status, 0);
  assert.match(readFileSync(join(dir, '.github/dependabot.yml'), 'utf8'), /^version: 2\nupdates:\n  - package-ecosystem: "gomod"/);
  assert.equal(exec([dir]).status, 0);
});

test('--version and --list-rules', () => {
  assert.match(exec(['--version']).stdout, /^\d+\.\d+\.\d+/);
  assert.match(exec(['--list-rules']).stdout, /uncovered-manifest/);
});
