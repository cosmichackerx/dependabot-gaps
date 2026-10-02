import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';
import { KNOWN_ECOSYSTEMS } from './ecosystems.js';
import { isGlob, normalizeDir } from './glob.js';
import type { Finding, UpdateEntry } from './types.js';

export const CONFIG_PATHS = ['.github/dependabot.yml', '.github/dependabot.yaml'];

export interface ParsedConfig {
  file: string;
  entries: UpdateEntry[];
  findings: Finding[];
}

function strList(node: unknown): string[] {
  if (!isSeq(node)) return [];
  return node.items.map((i) => (isScalar(i) ? String(i.value) : '')).filter((s) => s !== '');
}

/** Parse dependabot.yml into entries and report structural problems (only documented requirements). */
export function parseConfig(file: string, text: string): ParsedConfig {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false });
  const findings: Finding[] = [];
  const lineOf = (n: unknown): number | undefined => {
    const range = (n as Node | undefined)?.range;
    return range ? lc.linePos(range[0]).line : undefined;
  };
  const add = (rule: Finding['rule'], message: string, node?: unknown, extra: Partial<Finding> = {}) =>
    findings.push({ rule, severity: 'error', file, line: lineOf(node), message, ...extra });

  if (doc.errors.length > 0) {
    const e = doc.errors[0]!;
    findings.push({ rule: 'config-unparseable', severity: 'error', file, line: e.linePos?.[0]?.line, message: `not valid YAML: ${e.message.split('\n')[0]}` });
    return { file, entries: [], findings };
  }
  const root = doc.contents;
  if (!isMap(root)) {
    add('invalid-config', 'dependabot.yml must be a mapping with `version: 2` and `updates:`', root);
    return { file, entries: [], findings };
  }
  if ((root.get('version') as unknown) !== 2) add('invalid-config', '`version: 2` is required', root);
  const updates = root.get('updates', true);
  if (!isSeq(updates)) {
    add('invalid-config', '`updates:` must be a list', updates ?? root);
    return { file, entries: [], findings };
  }
  const entries: UpdateEntry[] = [];
  updates.items.forEach((item, index) => {
    if (!isMap(item)) {
      add('invalid-config', `updates[${index}] must be a mapping`, item);
      return;
    }
    const eco = item.get('package-ecosystem');
    const ecoStr = typeof eco === 'string' ? eco : '';
    const line = lineOf(item);
    if (!ecoStr) add('invalid-config', `updates[${index}]: \`package-ecosystem\` is required`, item);
    else if (!(KNOWN_ECOSYSTEMS as readonly string[]).includes(ecoStr)) add('invalid-config', `updates[${index}]: unknown package-ecosystem \`${ecoStr}\``, item.get('package-ecosystem', true));
    const dir = item.get('directory');
    const dirs = item.get('directories', true);
    const hasDirectory = typeof dir === 'string';
    const hasDirectories = isSeq(dirs);
    if (!hasDirectory && !hasDirectories) add('invalid-config', `updates[${index}] (${ecoStr || '?'}): \`directory\` or \`directories\` is required`, item);
    if (hasDirectory && hasDirectories) add('invalid-config', `updates[${index}] (${ecoStr || '?'}): use either \`directory\` or \`directories\`, not both`, item);
    if (hasDirectory && isGlob(dir)) {
      add('directory-glob', `updates[${index}] (${ecoStr}): \`directory: ${dir}\` is taken literally; only \`directories\` expands globs`, item.get('directory', true), { ecosystem: ecoStr });
    }
    const schedule = item.get('schedule');
    const hasInterval = isMap(schedule) ? typeof schedule.get('interval') === 'string' : false;
    if (!hasInterval && !item.get('multi-ecosystem-group')) add('invalid-config', `updates[${index}] (${ecoStr || '?'}): \`schedule.interval\` is required`, item);
    const patterns = hasDirectories ? strList(dirs) : hasDirectory ? [dir] : [];
    entries.push({
      index,
      line,
      ecosystem: ecoStr,
      directories: patterns,
      excludePaths: strList(item.get('exclude-paths', true)),
      targetBranch: typeof item.get('target-branch') === 'string' ? (item.get('target-branch') as string) : undefined,
      literal: hasDirectory,
      hasDirectory,
      hasDirectories,
    });
  });
  return { file, entries, findings };
}

export function dirKey(pattern: string): string {
  return isGlob(pattern) ? pattern.replace(/^\/+/, '') : normalizeDir(pattern);
}
