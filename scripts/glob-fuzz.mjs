// Fuzz src/glob.ts against real Ruby: node scripts/glob-fuzz.mjs [count] [seed] [--max-rate 0.005]; needs `ruby` on PATH (or RUBY=/path).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryMatches } from '../dist/src/glob.js';

const count = Number(process.argv[2] ?? 2000);
let seed = Number(process.argv[3] ?? 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const segs = ['apps', 'packages', 'a', 'b', 'c', 'src', '.github', 'actions', '*', '*', '**', '**', '?', '.*', 'app-?', 'app*', '[ab]', '[!a]*', '{apps,docs}', 'x.y', 'nope'];
const patterns = new Set();
while (patterns.size < count) {
  const n = 1 + Math.floor(rnd() * 4);
  let p = '/' + Array.from({ length: n }, () => pick(segs)).join('/');
  if (rnd() < 0.15) p += '/';
  if (/[*?[]/.test(p)) patterns.add(p);
}
const dir = mkdtempSync(join(tmpdir(), 'fuzz-'));
writeFileSync(join(dir, 'p.txt'), [...patterns].join('\n'));
const out = JSON.parse(execFileSync(process.env.RUBY ?? 'ruby', ['scripts/glob-differential.rb', join(dir, 'p.txt')], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const norm = (m) => { let x = m.replace(/\/+$/, ''); if (x === '.') return ''; if (x.endsWith('/.')) x = x.slice(0, -2); return x.split('/').filter((c) => c !== '.').join('/'); };
const dirs = ['', ...out.tree.filter((d) => d !== '.')];
let bad = 0;
for (const c of out.cases) {
  const want = [...new Set(c.matches.map(norm))].sort().join('|');
  const got = dirs.filter((d) => directoryMatches(c.pattern, d)).sort().join('|');
  if (want !== got) { bad++; if (bad <= 15) console.log('MISMATCH', c.pattern, '\n  ruby:', want, '\n  mine:', got); }
}
console.log(`ruby ${out.ruby}: ${out.cases.length} random patterns, ${bad} mismatches`);
const mr = process.argv.indexOf('--max-rate');
const maxRate = mr > 0 ? Number(process.argv[mr + 1]) : 0;
process.exitCode = bad / out.cases.length > maxRate ? 1 : 0;
