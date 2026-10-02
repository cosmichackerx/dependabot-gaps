import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where the repository files come from: a working tree, or a git revision read without checking it out. */
export interface Source {
  list(): string[];
  read(path: string): string | undefined;
}

const SKIP_WALK = new Set(['.git', 'node_modules']);

function walk(root: string, rel = '', out: string[] = []): string[] {
  for (const name of readdirSync(join(root, rel))) {
    if (SKIP_WALK.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(join(root, r));
    if (st.isDirectory()) walk(root, r, out);
    else if (st.isFile()) out.push(r);
  }
  return out;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function isGitRepo(dir: string): boolean {
  try {
    git(dir, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/** Working tree: tracked + untracked-but-not-ignored files when inside git, otherwise a plain walk. */
export function worktreeSource(root: string): Source {
  let files: string[];
  if (isGitRepo(root)) {
    const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    files = out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)));
  } else files = walk(root);
  return {
    list: () => files.map((f) => f.replace(/\\/g, '/')),
    read: (p) => {
      try {
        return readFileSync(join(root, p), 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}

/** A git revision (works in `--filter=blob:none --no-checkout` clones: only the blobs we read are fetched). */
export function revSource(root: string, rev: string): Source {
  const out = git(root, ['ls-tree', '-r', '-z', '--name-only', rev]);
  const files = out.split('\0').filter(Boolean);
  return {
    list: () => files,
    read: (p) => {
      try {
        return git(root, ['show', `${rev}:${p}`]);
      } catch {
        return undefined;
      }
    },
  };
}

export function memorySource(files: Record<string, string>): Source {
  return { list: () => Object.keys(files), read: (p) => files[p] };
}
