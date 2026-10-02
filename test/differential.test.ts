import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { directoryMatches } from '../src/glob.js';

// test/fixtures/glob-ruby.json is the output of scripts/glob-differential.rb: the exact call dependabot-core makes
// (Dir.glob(pattern.delete_prefix("/"), File::FNM_DOTMATCH) filtered to directories) on a fixed tree. CI regenerates it
// with the runner's Ruby and fails when it differs from the committed file.
const oracle = JSON.parse(readFileSync(new URL('../../test/fixtures/glob-ruby.json', import.meta.url), 'utf8')) as {
  ruby: string;
  tree: string[];
  cases: { pattern: string; glob: boolean; matches: string[] }[];
};

const norm = (m: string): string => {
  let x = m.replace(/\/+$/, '');
  if (x === '.') return '';
  if (x.endsWith('/.')) x = x.slice(0, -2);
  return x.split('/').filter((c) => c !== '.').join('/');
};

test(`directoryMatches agrees with Ruby ${oracle.ruby} Dir.glob on ${oracle.cases.length} patterns`, () => {
  const dirs = ['', ...oracle.tree.filter((d) => d !== '.')];
  const bad: string[] = [];
  for (const c of oracle.cases) {
    const want = [...new Set(c.matches.map(norm))].sort();
    const got = dirs.filter((d) => directoryMatches(c.pattern, d)).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`${c.pattern}\n   ruby: ${want.join(', ')}\n   mine: ${got.join(', ')}`);
  }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}`);
});
