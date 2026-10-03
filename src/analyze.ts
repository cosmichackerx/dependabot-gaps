import { CONFIG_PATHS, parseConfig } from './config.js';
import { classifyAll, classifyManifest, isSkipped } from './ecosystems.js';
import { directoryMatches, entryMatches, excludedBy, globToRegExp, isGlob, normalizeDir } from './glob.js';
import type { Source } from './source.js';
import type { Finding, Manifest, Result, UpdateEntry } from './types.js';
import { workspaceMembers } from './workspace.js';

export interface Options {
  /** path globs (relative to the repo root) to leave out */
  ignore?: string[];
  includeVendored?: boolean;
  /** report manifests under tests/examples/docs too, at warning instead of info */
  strictPaths?: boolean;
  /** treat manifests of ecosystems without any updates entry as gaps (default: one info line per ecosystem) */
  allEcosystems?: boolean;
}

const display = (dir: string): string => '/' + dir;

function repoDirs(files: string[]): Set<string> {
  const dirs = new Set<string>(['']);
  for (const f of files) {
    const parts = f.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return dirs;
}

function primaryEcosystem(m: Manifest, fileSet: Set<string>): string {
  const at = (name: string) => fileSet.has(m.dir ? `${m.dir}/${name}` : name);
  if (m.ecosystems.includes('uv') && at('uv.lock')) return 'uv';
  if (m.ecosystems.includes('bun') && (at('bun.lock') || at('bun.lockb'))) return 'bun';
  if (m.ecosystems.includes('opentofu') && at('.opentofu.lock.hcl')) return 'opentofu';
  return m.ecosystems[0]!;
}

export function renderEntries(gaps: { ecosystem: string; dir: string }[], interval = 'weekly'): string {
  const byEco = new Map<string, Set<string>>();
  for (const g of gaps) byEco.set(g.ecosystem, (byEco.get(g.ecosystem) ?? new Set()).add(g.dir));
  const lines: string[] = [];
  for (const [eco, dirs] of [...byEco].sort(([a], [b]) => a.localeCompare(b))) {
    const list = [...dirs].sort();
    lines.push(`  - package-ecosystem: "${eco}"`);
    if (list.length === 1) lines.push(`    directory: "${display(list[0]!)}"`);
    else {
      lines.push('    directories:');
      for (const d of list) lines.push(`      - "${display(d)}"`);
    }
    lines.push('    schedule:', `      interval: "${interval}"`);
  }
  return lines.join('\n');
}

export function analyze(source: Source, opts: Options = {}): Result & { suggestion?: string } {
  const files = source.list();
  const fileSet = new Set(files);
  const ignoreRes = (opts.ignore ?? []).flatMap((g) => globToRegExp(g.replace(/^\/+/, '').replace(/\/$/, '/**'), true));
  const isIgnored = (path: string): boolean => ignoreRes.some((r) => r.test(path));
  const everything = classifyAll(files, true);
  const considered = classifyAll(files, opts.includeVendored ?? false);
  const manifests = considered.filter((m) => !isIgnored(m.path));
  const summary = { manifests: manifests.length, covered: 0, coveredViaWorkspace: 0, excluded: 0, ignored: considered.length - manifests.length, uncovered: 0, optedOut: 0, noDependencies: 0, entries: 0 };
  const findings: Finding[] = [];

  const configFile = CONFIG_PATHS.find((p) => fileSet.has(p));
  if (!configFile) {
    summary.uncovered = manifests.length;
    if (manifests.length > 0) {
      const gaps = dedupeGaps(manifests, fileSet);
      const suggestion = `version: 2\nupdates:\n${renderEntries(gaps)}`;
      findings.push({ rule: 'no-config', severity: 'error', file: '.github/dependabot.yml', message: `${manifests.length} manifest(s) in ${gaps.length} place(s) but no .github/dependabot.yml`, suggestion });
      return { findings, summary, suggestion };
    }
    return { findings, summary };
  }
  const cfg = parseConfig(configFile, source.read(configFile) ?? '');
  findings.push(...cfg.findings);
  if (cfg.findings.some((f) => f.rule === 'config-unparseable')) return { configFile, findings, summary };
  const entries = cfg.entries.filter((e) => e.ecosystem);
  summary.entries = entries.length;

  // ---- coverage ----
  const covering = (m: Manifest): { entry: UpdateEntry; dir: string }[] => {
    const hits: { entry: UpdateEntry; dir: string }[] = [];
    for (const e of entries) {
      if (!m.ecosystems.includes(e.ecosystem)) continue;
      for (const d of [m.dir, ...(m.altDirs ?? [])]) {
        if (entryMatches(e, d)) {
          hits.push({ entry: e, dir: d });
          break;
        }
      }
    }
    return hits;
  };
  const direct = new Map<string, 'covered' | 'excluded'>();
  for (const m of manifests) {
    const hits = covering(m);
    if (hits.length === 0) continue;
    const live = hits.filter((h) => !excludedBy(h.entry.excludePaths, h.dir, m.path));
    direct.set(m.path, live.length > 0 ? 'covered' : 'excluded');
  }
  const via = new Set<string>();
  let queue = manifests.filter((m) => direct.get(m.path) === 'covered');
  const seen = new Set(queue.map((m) => m.path));
  while (queue.length > 0) {
    const next: Manifest[] = [];
    for (const root of queue) {
      for (const member of workspaceMembers(root, source, manifests)) {
        if (seen.has(member.path)) continue;
        seen.add(member.path);
        via.add(member.path);
        next.push(member);
      }
    }
    queue = next;
  }
  const gaps: Manifest[] = [];
  for (const m of manifests) {
    const d = direct.get(m.path);
    if (d === undefined && !via.has(m.path) && declaresNothing(m, source)) {
      summary.noDependencies++;
      continue;
    }
    if (d === 'covered') summary.covered++;
    else if (d === 'excluded') summary.excluded++;
    else if (via.has(m.path)) summary.coveredViaWorkspace++;
    else gaps.push(m);
  }
  summary.uncovered = gaps.length;

  const configured = new Set(entries.map((e) => e.ecosystem));
  const optedOut = new Map<string, Manifest[]>();
  const byPlace = new Map<string, Manifest[]>();
  for (const g of gaps) {
    if (!opts.allEcosystems && !g.ecosystems.some((e) => configured.has(e))) {
      const eco = primaryEcosystem(g, fileSet);
      optedOut.set(eco, [...(optedOut.get(eco) ?? []), g]);
      continue;
    }
    const key = `${primaryEcosystem(g, fileSet)}\0${g.dir}\0${g.altDirs ? 'w' : ''}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), g]);
  }
  const suggestionGaps: { ecosystem: string; dir: string }[] = [];
  for (const [key, ms] of byPlace) {
    const [eco, dir] = key.split('\0') as [string, string];
    const m0 = ms[0]!;
    const low = m0.lowPriority && !opts.strictPaths;
    const names = [...new Set(ms.map((m) => m.path.slice(m.path.lastIndexOf('/') + 1)))].slice(0, 3).join(', ');
    const where = m0.ecosystems[0] === 'github-actions' && m0.altDirs ? 'workflows' : names;
    findings.push({
      rule: 'uncovered-manifest',
      severity: low ? 'info' : 'warning',
      file: m0.path,
      message: `${eco}: ${where} in ${display(dir)} is not covered by any updates entry${low ? ' (test/example/docs path, probably fine)' : ''}`,
      ecosystem: eco,
      directory: display(dir),
    });
    if (!low) suggestionGaps.push({ ecosystem: eco, dir });
  }

  for (const ms of optedOut.values()) summary.optedOut += ms.length;
  summary.uncovered -= summary.optedOut;
  for (const [eco, ms] of optedOut) {
    const places = [...new Set(ms.map((m) => display(m.dir)))].sort();
    findings.push({
      rule: 'unconfigured-ecosystem',
      severity: 'info',
      file: configFile,
      message: `${eco}: ${ms.length} manifest(s) in ${places.length} place(s) (${places.slice(0, 3).join(', ')}${places.length > 3 ? ', ...' : ''}) and no ${eco} entry at all: deliberate opt-out? (--all-ecosystems reports them as gaps)`,
      ecosystem: eco,
    });
  }

  // ---- entries that point at nothing ----
  const allByEco = new Map<string, Set<string>>();
  for (const m of everything) for (const e of m.ecosystems) for (const d of [m.dir, ...(m.altDirs ?? [])]) allByEco.set(e, (allByEco.get(e) ?? new Set()).add(d));
  for (const e of entries) {
    const dirsWithManifest = allByEco.get(e.ecosystem) ?? new Set<string>();
    for (const p of e.directories) {
      const hit = [...dirsWithManifest].some((d) => entryMatches({ literal: e.literal, directories: [p] }, d));
      if (!hit) {
        findings.push({
          rule: 'unmatched-entry',
          severity: 'warning',
          file: configFile,
          line: e.line,
          message: `updates[${e.index}] ${e.ecosystem}: ${isGlob(p) ? 'pattern' : 'directory'} "${p}" matches no directory with a ${e.ecosystem} manifest${/(^|\/)\*\*$/.test(p) ? ' (a trailing `**` without `/` behaves like `*` in Ruby Dir.glob; use `/**/*` for all depths)' : ''}`,
          ecosystem: e.ecosystem,
          directory: p,
        });
      }
    }
  }

  // ---- overlapping entries ----
  const dirs = repoDirs(files);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (a.ecosystem !== b.ecosystem || (a.targetBranch ?? '') !== (b.targetBranch ?? '')) continue;
      const shared = [...dirs].filter((d) => entryMatches(a, d) && entryMatches(b, d));
      if (shared.length > 0) {
        findings.push({
          rule: 'overlapping-entries',
          severity: 'error',
          file: configFile,
          line: b.line,
          message: `updates[${a.index}] and updates[${b.index}] both cover ${shared.slice(0, 3).map(display).join(', ')} for ${a.ecosystem}${a.targetBranch ? ` on ${a.targetBranch}` : ''}`,
          ecosystem: a.ecosystem,
        });
      }
    }
  }

  // ---- Gradle version catalogs Dependabot does not read ----
  // The docs list only gradle/libs.versions.toml (custom catalogs from settings.gradle are dependabot-core#8079).
  for (const f of configured.has('gradle') || opts.allEcosystems ? files : []) {
    if (!/(^|\/)[^/]+\.versions\.toml$/.test(f) || /(^|\/)gradle\/libs\.versions\.toml$/.test(f)) continue;
    if (isSkipped(f, opts.includeVendored ?? false) || isIgnored(f)) continue;
    const low = classifyManifest(f.replace(/[^/]*$/, 'build.gradle'))?.lowPriority ?? false;
    findings.push({
      rule: 'unsupported-version-catalog',
      severity: low && !opts.strictPaths ? 'info' : 'warning',
      file: f,
      message: `gradle: ${f} is a version catalog Dependabot does not read (only gradle/libs.versions.toml is read), so its versions get no update PRs`,
      ecosystem: 'gradle',
    });
  }

  const suggestion = suggestionGaps.length ? renderEntries(suggestionGaps) : undefined;
  return { configFile, findings: sort(findings), summary, suggestion };
}

/**
 * Files that exist but give Dependabot nothing to update: package.json / composer.json / Cargo.toml / pyproject.toml
 * without any dependency table, and .NET project files without a PackageReference that carries a version (central
 * package management keeps the versions in Directory.Packages.props, which is its own manifest).
 */
function declaresNothing(m: Manifest, source: Source): boolean {
  const base = m.path.slice(m.path.lastIndexOf('/') + 1);
  const isProj = /\.(cs|fs|vb)proj$/i.test(base);
  if (!['package.json', 'composer.json', 'Cargo.toml', 'pyproject.toml'].includes(base) && !isProj) return false;
  const text = source.read(m.path);
  if (text === undefined) return false;
  try {
    if (isProj) return !/<PackageReference\b[^>]*\bVersion(?:Override)?\s*=|<PackageReference\b[^>]*>\s*<Version>/i.test(text);
    if (base === 'Cargo.toml') return !/^\s*\[(?:[\w.\-"']+\.)?(?:dev-|build-)?dependencies(?:\.[^\]]+)?\]/m.test(text);
    if (base === 'pyproject.toml') return !/^\s*(?:dependencies|optional-dependencies|dev-dependencies)\s*=|^\s*\[(?:tool\.poetry\.(?:group\.[^.\]]+\.)?dependencies|dependency-groups|project\.optional-dependencies|tool\.uv)/m.test(text);
    const j = JSON.parse(text) as Record<string, unknown>;
    const keys = base === 'package.json' ? ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] : ['require', 'require-dev'];
    return keys.every((k) => {
      const v = j[k];
      return v === undefined || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);
    });
  } catch {
    return false;
  }
}

function dedupeGaps(ms: Manifest[], fileSet: Set<string>): { ecosystem: string; dir: string }[] {
  const seen = new Set<string>();
  const out: { ecosystem: string; dir: string }[] = [];
  for (const m of ms) {
    if (m.lowPriority) continue;
    const g = { ecosystem: primaryEcosystem(m, fileSet), dir: m.altDirs ? '' : m.dir };
    const k = `${g.ecosystem}\0${g.dir}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(g);
    }
  }
  return out;
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;
function sort(f: Finding[]): Finding[] {
  return f.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message));
}

export { classifyManifest, normalizeDir };
