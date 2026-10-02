/**
 * Directory matching as dependabot-core does it (updater/lib/dependabot/file_fetcher_command.rb):
 * a directory is a glob when it contains `*`, `?` or a `[...]` pair; the leading `/` is removed and
 * `Dir.glob(pattern, File::FNM_DOTMATCH)` picks the directories. This module re-implements the subset of
 * Ruby's Dir.glob that matters for directory names: `*`, `?`, `[...]`, `{a,b}` and `**` (zero or more
 * path segments when followed by `/`, otherwise like `*`). Dot directories ARE matched (FNM_DOTMATCH).
 */

export function isGlob(dir: string): boolean {
  return dir.includes('*') || dir.includes('?') || (dir.includes('[') && dir.includes(']'));
}

/** "/", "" and "." are the repository root; other values lose leading/trailing slashes. */
export function normalizeDir(dir: string): string {
  let d = dir.trim().replace(/\\/g, '/');
  d = d.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (d === '.') d = '';
  return d;
}

function expandBraces(p: string): string[] {
  const m = /\{([^{}]*)\}/.exec(p);
  if (!m) return [p];
  const out: string[] = [];
  for (const alt of m[1]!.split(',')) out.push(...expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
  return out;
}

function segmentToRegex(seg: string): string {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (c === '*') {
      while (seg[i + 1] === '*') i++;
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = seg.indexOf(']', i + 2);
      if (end === -1) re += '\\[';
      else {
        let body = seg.slice(i + 1, end);
        if (body.startsWith('!')) body = '^' + body.slice(1);
        re += `[${body.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return re;
}

export function globToRegExp(pattern: string, deep = false): RegExp[] {
  return expandBraces(pattern).map((p) => {
    const segs = p.split('/');
    let re = '^';
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1;
      if (seg === '**' && !last) re += '(?:[^/]+/)*';
      else if (seg === '**') re += deep ? '.*' : '[^/]*';
      else re += segmentToRegex(seg) + (last ? '' : '/');
    });
    return new RegExp(re + '$');
  });
}

/** Does `pattern` (as written in dependabot.yml) select the repo-relative directory `dir`? */
export function directoryMatches(pattern: string, dir: string): boolean {
  const p = normalizeDir(pattern);
  const d = normalizeDir(dir);
  if (!isGlob(pattern)) return p === d;
  if (d === '') return false; // Dir.glob never yields the root itself
  return globToRegExp(p).some((r) => r.test(d));
}

/** exclude-paths: patterns relative to the entry directory; match the path itself or any parent directory. */
export function excludedBy(patterns: string[], entryDir: string, path: string): boolean {
  // The docs say "relative to the directory"; for globbed `directories` that is ambiguous, so a pattern also
  // counts when it matches relative to the repository root (avoids reporting a deliberate exclusion as a gap).
  return excludedFrom(patterns, entryDir, path) || (entryDir !== '' && excludedFrom(patterns, '', path));
}

function excludedFrom(patterns: string[], entryDir: string, path: string): boolean {
  const base = normalizeDir(entryDir);
  let rel: string;
  if (base === '') rel = path;
  else if (path === base || path.startsWith(base + '/')) rel = path.slice(base.length).replace(/^\//, '');
  else return false;
  if (rel === '') return false;
  const parts = rel.split('/');
  for (const raw of patterns) {
    const pat = normalizeDir(raw);
    if (!pat) continue;
    const res = globToRegExp(pat, true);
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (res.some((r) => r.test(prefix))) return true;
      if (pat.endsWith('/**') && res.some((r) => r.test(prefix + '/x'))) return true;
    }
  }
  return false;
}

/** Does an updates entry select `dir`? `directory:` is literal; `directories:` entries expand globs. */
export function entryMatches(entry: { literal: boolean; directories: string[] }, dir: string): boolean {
  return entry.directories.some((p) => (entry.literal ? normalizeDir(p) === normalizeDir(dir) : directoryMatches(p, dir)));
}
