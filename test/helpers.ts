import { analyze } from '../src/analyze.js';
import type { Options } from '../src/analyze.js';
import { memorySource } from '../src/source.js';

export const run = (files: Record<string, string>, opts?: Options) => analyze(memorySource(files), opts);
export const rules = (r: ReturnType<typeof run>): string[] => r.findings.map((f) => `${f.rule}:${f.severity}`).sort();
export const cfg = (...entries: string[]): string => `version: 2\nupdates:\n${entries.join('\n')}\n`;
export const entry = (eco: string, dirs: string | string[], extra = ''): string =>
  `  - package-ecosystem: "${eco}"\n` +
  (Array.isArray(dirs) ? `    directories:\n${dirs.map((d) => `      - "${d}"`).join('\n')}\n` : `    directory: "${dirs}"\n`) +
  `    schedule:\n      interval: weekly\n${extra}`;
