import { parse as parseYaml } from 'yaml';
import { directoryMatches, normalizeDir } from './glob.js';
import type { Source } from './source.js';
import type { Manifest } from './types.js';

/**
 * Manifests that Dependabot fetches together with a covered one (dependabot-core file fetchers follow
 * workspaces), so they do not need an updates entry of their own:
 *   npm/yarn/pnpm  package.json "workspaces" and pnpm-workspace.yaml
 *   cargo          [workspace] members / exclude
 *   uv             [tool.uv.workspace] members / exclude
 *   maven          <modules>
 *   gradle         include(...) in settings.gradle(.kts)
 * Members are looked up among the repository's manifests of the same ecosystem.
 */
export function workspaceMembers(root: Manifest, source: Source, all: Manifest[]): Manifest[] {
  const eco = root.ecosystems[0];
  const base = root.path.slice(root.path.lastIndexOf('/') + 1);
  const rel = (patterns: string[], neg: string[] = []): Manifest[] => {
    const prefix = root.dir ? root.dir + '/' : '';
    return all.filter((m) => {
      if (m.path === root.path || m.ecosystems[0] !== eco || !m.dir.startsWith(prefix) || m.dir === root.dir) return false;
      const relDir = m.dir.slice(prefix.length);
      const hit = patterns.some((p) => directoryMatches(p, relDir) || normalizeDir(p) === relDir);
      const bad = neg.some((p) => directoryMatches(p, relDir) || normalizeDir(p) === relDir);
      return hit && !bad;
    });
  };
  const text = source.read(root.path) ?? '';
  try {
    if (eco === 'npm' && base === 'package.json') {
      let pats: string[] = [];
      const neg: string[] = [];
      const pkg = JSON.parse(text) as { workspaces?: string[] | { packages?: string[] } };
      const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
      pats = ws.filter((w) => !w.startsWith('!'));
      neg.push(...ws.filter((w) => w.startsWith('!')).map((w) => w.slice(1)));
      const pnpm = source.read(root.dir ? `${root.dir}/pnpm-workspace.yaml` : 'pnpm-workspace.yaml');
      if (pnpm) {
        const y = parseYaml(pnpm) as { packages?: string[] } | null;
        for (const w of y?.packages ?? []) (w.startsWith('!') ? neg : pats).push(w.startsWith('!') ? w.slice(1) : w);
      }
      return pats.length ? rel(pats, neg) : [];
    }
    if (eco === 'cargo') {
      const sec = /^\[workspace\]\s*$([\s\S]*?)(?=^\[(?!workspace\.)|(?![\s\S]))/m.exec(text);
      if (!sec) return [];
      const list = (key: string): string[] => {
        const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(sec[1]!);
        return m ? [...m[1]!.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!) : [];
      };
      return rel(list('members'), list('exclude'));
    }
    if (eco === 'pip' && base === 'pyproject.toml') {
      // uv workspaces: [tool.uv.workspace] members / exclude (one lock file for the whole workspace)
      const sec = /^\[tool\.uv\.workspace\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
      if (!sec) return [];
      const list = (key: string): string[] => {
        const m = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(sec[1]!);
        return m ? [...m[1]!.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!) : [];
      };
      return rel(list('members'), list('exclude'));
    }
    if (eco === 'maven') {
      const mods = [...text.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((x) => x[1]!);
      return mods.length ? rel(mods.map((x) => x.replace(/\/pom\.xml$/, ''))) : [];
    }
    if (eco === 'gradle' && /^settings\.gradle(\.kts)?$/.test(base)) {
      // settings files often compute their includes (loops, helper functions), so every build file below a
      // covered settings file that does not have a settings file of its own counts as a member.
      const sub = (all.filter((m) => m.ecosystems[0] === 'gradle' && m.dir !== root.dir && (root.dir === '' || m.dir.startsWith(root.dir + '/'))));
      const own = new Set(sub.filter((m) => /^settings\.gradle/.test(m.path.slice(m.path.lastIndexOf('/') + 1))).map((m) => m.dir));
      const members = sub.filter((m) => ![...own].some((d) => m.dir === d || m.dir.startsWith(d + '/')));
      if (members.length > 0) return members;
      const names: string[] = [];
      for (const inc of text.matchAll(/\binclude\s*\(?([^\n)]*)/g)) {
        for (const q of inc[1]!.matchAll(/["']:?([^"']+)["']/g)) names.push(q[1]!.replace(/:/g, '/'));
      }
      return names.length ? rel(names) : [];
    }
  } catch {
    return [];
  }
  return [];
}
