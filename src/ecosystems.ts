import { normalizeDir } from './glob.js';
import type { Manifest } from './types.js';

/** Every `package-ecosystem` value Dependabot documents (docs: dependabot-options-reference, 2026-10). */
export const KNOWN_ECOSYSTEMS = [
  'bazel', 'bun', 'bundler', 'cargo', 'composer', 'conda', 'deno', 'devcontainers', 'docker', 'docker-compose', 'dotnet-sdk',
  'elm', 'github-actions', 'gitsubmodule', 'gomod', 'gradle', 'helm', 'julia', 'maven', 'mix', 'nix', 'npm', 'nuget', 'opentofu',
  'pip', 'pre-commit', 'pub', 'rust-toolchain', 'sbt', 'swift', 'terraform', 'uv', 'vcpkg',
] as const;

const LOW_PRIORITY = /(^|\/)[^/]*(test|fixture|example|sample|demo|e2e|benchmark|playground|sandbox|testdata)[^/]*(\/|$)|(^|\/)(docs?|templates?|spec)(\/|$)/i;

interface Rule {
  test: (base: string, path: string) => boolean;
  ecosystems: string[];
}

const RULES: Rule[] = [
  { test: (b) => b === 'package.json', ecosystems: ['npm', 'bun'] },
  { test: (b, p) => /^requirements([-_.].*)?\.(txt|in)$/i.test(b) || /(^|\/)requirements?\/[^/]+\.(txt|in)$/i.test(p), ecosystems: ['pip', 'uv'] },
  { test: (b) => b === 'pyproject.toml', ecosystems: ['pip', 'uv'] },
  { test: (b) => b === 'setup.py' || b === 'Pipfile', ecosystems: ['pip'] },
  { test: (b) => b === 'Dockerfile' || /^Dockerfile\..+/.test(b) || /\.Dockerfile$/i.test(b), ecosystems: ['docker'] },
  { test: (b) => /^(docker-)?compose([-.][\w.-]+)?\.ya?ml$/i.test(b), ecosystems: ['docker-compose'] },
  { test: (b) => b === 'Cargo.toml', ecosystems: ['cargo'] },
  { test: (b) => b === 'go.mod', ecosystems: ['gomod'] },
  { test: (b) => b === 'pom.xml', ecosystems: ['maven'] },
  { test: (b) => /^(build|settings)\.gradle(\.kts)?$/.test(b), ecosystems: ['gradle'] },
  { test: (b) => b === 'Project.toml' || b === 'JuliaProject.toml', ecosystems: ['julia'] },
  { test: (b) => b === 'build.sbt', ecosystems: ['sbt'] },
  { test: (b) => b === 'Gemfile', ecosystems: ['bundler'] },
  { test: (b) => b === 'composer.json', ecosystems: ['composer'] },
  { test: (b) => /\.(cs|fs|vb)proj$/i.test(b) || b === 'packages.config' || b === 'Directory.Packages.props', ecosystems: ['nuget'] },
  { test: (b) => b === 'global.json', ecosystems: ['dotnet-sdk'] },
  { test: (b) => b === 'mix.exs', ecosystems: ['mix'] },
  { test: (b) => /\.tf$/.test(b), ecosystems: ['terraform', 'opentofu'] },
  { test: (b) => b === 'Chart.yaml', ecosystems: ['helm'] },
  { test: (b) => b === 'pubspec.yaml', ecosystems: ['pub'] },
  { test: (b) => b === 'Package.swift', ecosystems: ['swift'] },
  { test: (b) => b === 'elm.json', ecosystems: ['elm'] },
  { test: (b) => b === '.gitmodules', ecosystems: ['gitsubmodule'] },
  { test: (b) => b === '.pre-commit-config.yaml', ecosystems: ['pre-commit'] },
  { test: (b) => b === 'flake.nix', ecosystems: ['nix'] },
  { test: (b) => b === 'deno.json' || b === 'deno.jsonc', ecosystems: ['deno'] },
  { test: (b) => b === 'rust-toolchain.toml' || b === 'rust-toolchain', ecosystems: ['rust-toolchain'] },
  { test: (b) => b === 'vcpkg.json', ecosystems: ['vcpkg'] },
  { test: (b) => b === 'MODULE.bazel', ecosystems: ['bazel'] },
  { test: (b) => b === 'environment.yml' || b === 'environment.yaml', ecosystems: ['conda'] },
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', 'site-packages', 'bower_components', '.terraform', '.tox', '.gradle', 'target', '__pycache__']);
const VENDOR_DIRS = new Set(['vendor', 'third_party', 'third-party', 'thirdparty', 'extern', 'external']);

export function isSkipped(path: string, includeVendored: boolean): boolean {
  for (const seg of path.split('/').slice(0, -1)) {
    if (SKIP_DIRS.has(seg)) return true;
    if (!includeVendored && VENDOR_DIRS.has(seg)) return true;
  }
  return false;
}

/** Classify one repo-relative path; null when no Dependabot ecosystem reads it. */
export function classifyManifest(path: string): Manifest | null {
  const slash = path.lastIndexOf('/');
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dir = normalizeDir(slash === -1 ? '' : path.slice(0, slash));
  const low = LOW_PRIORITY.test(path);

  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
    return { path, dir: '', altDirs: ['.github/workflows'], ecosystems: ['github-actions'], lowPriority: false };
  }
  if (base === 'action.yml' || base === 'action.yaml') {
    return { path, dir, ecosystems: ['github-actions'], lowPriority: low };
  }
  if (path === '.devcontainer.json' || /^\.devcontainer\/(?:[^/]+\/)?devcontainer\.json$/.test(path)) {
    return { path, dir: '', ecosystems: ['devcontainers'], lowPriority: false };
  }
  for (const r of RULES) if (r.test(base, path)) return { path, dir, ecosystems: r.ecosystems, lowPriority: low };
  return null;
}

/** Collapse manifests that Dependabot reads together: all *.tf of a directory are one unit. */
export function classifyAll(paths: string[], includeVendored = false): Manifest[] {
  const out: Manifest[] = [];
  const seenDirKey = new Set<string>();
  for (const p of paths) {
    if (isSkipped(p, includeVendored)) continue;
    const m = classifyManifest(p);
    if (!m) continue;
    if (m.ecosystems.includes('terraform') || m.ecosystems.includes('github-actions') && m.path.startsWith('.github/workflows/')) {
      const key = `${m.ecosystems.join('+')}:${m.dir}${m.altDirs ? '|w' : ''}`;
      if (seenDirKey.has(key)) continue;
      seenDirKey.add(key);
    }
    out.push(m);
  }
  return out;
}
