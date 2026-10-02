import { renderEntries } from './analyze.js';
import type { Finding, Result } from './types.js';

/** What a pull request changed relative to its base: only head findings that the base did not already have. */
export interface PrInfo {
  base: string;
  /** findings present at the base and still present at head (not shown) */
  existing: number;
  /** findings present at the base and gone at head */
  resolved: number;
}

/**
 * Identity of a finding across two revisions. Line numbers never take part (editing the config shifts them), and an
 * ecosystem-level opt-out is keyed by ecosystem only because its message carries counts that change with every new manifest.
 */
export function findingKey(f: Finding): string {
  if (f.rule === 'unconfigured-ecosystem') return `${f.rule}|${f.ecosystem ?? f.message.split(':')[0]}`;
  if (f.rule === 'no-config') return f.rule;
  return [f.rule, f.file, f.ecosystem ?? '', f.directory ?? '', f.message].join('|');
}

export function diffResults(base: Result, head: Result & { suggestion?: string }, baseRef: string): Result & { suggestion?: string; pr: PrInfo } {
  const before = new Set(base.findings.map(findingKey));
  const after = new Set(head.findings.map(findingKey));
  const fresh = head.findings.filter((f) => !before.has(findingKey(f)));
  // entries to add for the gaps this PR introduced (info-level gaps in test/example paths are not suggested, as in the full report)
  const gaps = fresh
    .filter((f) => f.rule === 'uncovered-manifest' && f.severity === 'warning' && f.ecosystem && f.directory)
    .map((f) => ({ ecosystem: f.ecosystem as string, dir: (f.directory as string).replace(/^\//, '') }));
  const suggestion = gaps.length ? renderEntries(gaps) : undefined;
  return {
    ...head,
    findings: fresh,
    suggestion,
    pr: {
      base: baseRef,
      existing: head.findings.length - fresh.length,
      resolved: [...before].filter((k) => !after.has(k)).length,
    },
  };
}
