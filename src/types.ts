export type Severity = 'error' | 'warning' | 'info';

export type RuleId =
  | 'no-config'
  | 'config-unparseable'
  | 'invalid-config'
  | 'uncovered-manifest'
  | 'unconfigured-ecosystem'
  | 'unmatched-entry'
  | 'overlapping-entries'
  | 'directory-glob';

export const RULES: Record<RuleId, { severity: Severity; summary: string }> = {
  'no-config': { severity: 'error', summary: 'The repository has Dependabot-supported manifests but no .github/dependabot.yml.' },
  'config-unparseable': { severity: 'error', summary: 'dependabot.yml is not valid YAML.' },
  'invalid-config': { severity: 'error', summary: 'dependabot.yml breaks a documented requirement (version, package-ecosystem, directory/directories, schedule.interval).' },
  'uncovered-manifest': { severity: 'warning', summary: 'A manifest exists that no updates entry covers, so Dependabot never opens version-update PRs for it.' },
  'unconfigured-ecosystem': { severity: 'info', summary: 'Manifests of an ecosystem that has no updates entry at all (usually a deliberate opt-out; use --all-ecosystems to treat it as a gap).' },
  'unmatched-entry': { severity: 'warning', summary: 'An updates entry points at a directory without a manifest of that ecosystem (Dependabot reports a dependency_file_not_found error).' },
  'overlapping-entries': { severity: 'error', summary: 'Two entries for the same ecosystem and target branch cover the same directory (Dependabot rejects overlapping entries).' },
  'directory-glob': { severity: 'error', summary: '`directory` (singular) does not expand globs; use `directories`.' },
};

export interface Finding {
  rule: RuleId;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
  ecosystem?: string;
  directory?: string;
  /** the entry that would fix it, as YAML lines */
  suggestion?: string;
}

export interface Manifest {
  /** repo-relative path using "/" */
  path: string;
  /** directory as Dependabot sees it, repo-relative without leading slash ("" = root) */
  dir: string;
  /** package-ecosystem values that can cover this manifest (any one is enough) */
  ecosystems: string[];
  /** alternative directories that also cover it (GitHub Actions workflows) */
  altDirs?: string[];
  /** true when the path looks like tests, fixtures, examples or docs */
  lowPriority: boolean;
}

export interface UpdateEntry {
  index: number;
  line?: number;
  ecosystem: string;
  /** normalised patterns, no leading slash, "" = root */
  directories: string[];
  excludePaths: string[];
  targetBranch?: string;
  /** `directory:` (singular) is always literal, even with * in it */
  literal: boolean;
  hasDirectory: boolean;
  hasDirectories: boolean;
}

export interface Summary {
  manifests: number;
  covered: number;
  coveredViaWorkspace: number;
  excluded: number;
  ignored: number;
  uncovered: number;
  /** gaps in ecosystems with no updates entry at all (reported as one info line each) */
  optedOut: number;
  /** uncovered package.json/composer.json/Cargo.toml files that declare no dependencies */
  noDependencies: number;
  entries: number;
}

export interface Result {
  configFile?: string;
  findings: Finding[];
  summary: Summary;
}
