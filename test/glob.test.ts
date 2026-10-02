import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directoryMatches, excludedBy, isGlob, normalizeDir } from '../src/glob.js';

test('normalizeDir: root spellings and slashes', () => {
  for (const r of ['/', '', '.', './', '//']) assert.equal(normalizeDir(r), '');
  assert.equal(normalizeDir('/apps/web/'), 'apps/web');
  assert.equal(normalizeDir('apps\\web'), 'apps/web');
});

test('isGlob mirrors dependabot-core: * ? or a [..] pair', () => {
  assert.ok(isGlob('/a/*') && isGlob('/a/?') && isGlob('/a/[ab]'));
  assert.ok(!isGlob('/a/[ab') && !isGlob('/a/b'));
});

test('literal directories compare exactly, root only matches root', () => {
  assert.ok(directoryMatches('/', ''));
  assert.ok(!directoryMatches('/', 'apps'));
  assert.ok(directoryMatches('/apps/web', 'apps/web'));
  assert.ok(!directoryMatches('/apps', 'apps/web'));
});

test('* is one segment, ** crosses segments, neither matches the root', () => {
  assert.ok(directoryMatches('/packages/*', 'packages/a'));
  assert.ok(!directoryMatches('/packages/*', 'packages/a/b'));
  assert.ok(!directoryMatches('/packages/*', 'packages'));
  assert.ok(directoryMatches('/**/*', 'a'));
  assert.ok(directoryMatches('/**/*', 'a/b/c'));
  assert.ok(!directoryMatches('/**/*', ''));
  assert.ok(directoryMatches('/services/**/api', 'services/api'));
  assert.ok(directoryMatches('/services/**/api', 'services/x/y/api'));
});

test('FNM_DOTMATCH: * matches dot directories', () => {
  assert.ok(directoryMatches('/*', '.github'));
  assert.ok(directoryMatches('/.github/*', '.github/actions'));
});

test('? classes and braces', () => {
  assert.ok(directoryMatches('/app-?', 'app-1'));
  assert.ok(!directoryMatches('/app-?', 'app-12'));
  assert.ok(directoryMatches('/app-[ab]', 'app-b'));
  assert.ok(directoryMatches('/{api,web}/*', 'web/x'));
  assert.ok(!directoryMatches('/{api,web}/*', 'db/x'));
});

test('exclude-paths: file, directory prefix and ** patterns, relative to the entry directory', () => {
  assert.ok(excludedBy(['vendor/**'], '', 'vendor/x/package.json'));
  assert.ok(excludedBy(['src/test/assets'], '', 'src/test/assets/package.json'));
  assert.ok(excludedBy(['src/*.js'], '', 'src/a.js'));
  assert.ok(!excludedBy(['src/*.js'], '', 'src/deep/a.js'));
  assert.ok(excludedBy(['test/**'], 'app', 'app/test/a/b.json'));
  assert.ok(!excludedBy(['test/**'], 'app', 'other/test/a.json'));
  assert.ok(!excludedBy(['docs'], '', 'package.json'));
});
