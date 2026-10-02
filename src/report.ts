import { RULES, type Finding, type Result, type Severity } from './types.js';

type Full = Result & { suggestion?: string };

const ICON: Record<Severity, string> = { error: 'error  ', warning: 'warning', info: 'info   ' };

export function summaryLine(r: Result): string {
  const s = r.summary;
  const count = (sev: Severity) => r.findings.filter((f) => f.severity === sev).length;
  return `${s.manifests} manifest place(s) checked: ${s.covered} covered, ${s.coveredViaWorkspace} via workspace, ${s.excluded} excluded by exclude-paths, ${s.uncovered} uncovered${s.optedOut ? `, ${s.optedOut} in ecosystems without any entry` : ''}${s.noDependencies ? `, ${s.noDependencies} without dependencies (ignored)` : ''}; ${s.entries} updates entries. ${count('error')} error, ${count('warning')} warning, ${count('info')} info.`;
}

export function renderText(r: Full): string {
  const out: string[] = [];
  if (r.findings.length === 0) out.push('No gaps found.');
  for (const f of r.findings) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    out.push(`${ICON[f.severity]}  ${f.rule.padEnd(20)}  ${f.message}\n           ${loc}`);
  }
  if (r.suggestion) out.push('', r.configFile ? `Add under updates: in ${r.configFile}` : 'Suggested .github/dependabot.yml', r.suggestion);
  out.push('', summaryLine(r));
  return out.join('\n') + '\n';
}

export function renderMarkdown(r: Full): string {
  const out = ['## dependabot-gaps', '', summaryLine(r), ''];
  if (r.findings.length > 0) {
    out.push('| Severity | Rule | Where | Message |', '|---|---|---|---|');
    for (const f of r.findings) out.push(`| ${f.severity} | \`${f.rule}\` | \`${f.line ? `${f.file}:${f.line}` : f.file}\` | ${f.message.replace(/\|/g, '\\|')} |`);
  } else out.push('No gaps found.');
  if (r.suggestion) out.push('', '<details><summary>Entries to add</summary>', '', '```yaml', ...(r.configFile ? ['updates:'] : []), r.suggestion, '```', '', '</details>');
  return out.join('\n') + '\n';
}

export function renderJson(r: Full): string {
  return JSON.stringify({ configFile: r.configFile ?? null, summary: r.summary, findings: r.findings, suggestion: r.suggestion ?? null }, null, 2) + '\n';
}

export function renderGithub(r: Result): string {
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return (
    r.findings
      .map((f) => `::${f.severity === 'info' ? 'notice' : f.severity}${` file=${f.file}${f.line ? `,line=${f.line}` : ''},title=${f.rule}`}::${esc(f.message)}`)
      .join('\n') + (r.findings.length ? '\n' : '')
  );
}

export function renderSarif(r: Result, version: string): string {
  const level = (s: Severity) => (s === 'info' ? 'note' : s);
  const rules = (Object.keys(RULES) as (keyof typeof RULES)[]).map((id) => ({
    id,
    name: id,
    shortDescription: { text: RULES[id].summary },
    defaultConfiguration: { level: level(RULES[id].severity) },
    helpUri: 'https://github.com/cosmichackerx/dependabot-gaps#rules',
  }));
  const results = r.findings.map((f: Finding) => ({
    ruleId: f.rule,
    ruleIndex: (Object.keys(RULES) as string[]).indexOf(f.rule),
    level: level(f.severity),
    message: { text: f.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: f.file, uriBaseId: '%SRCROOT%' }, region: { startLine: f.line ?? 1 } } }],
  }));
  return JSON.stringify({ $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0', runs: [{ tool: { driver: { name: 'dependabot-gaps', version, informationUri: 'https://github.com/cosmichackerx/dependabot-gaps', rules } }, results }] }, null, 2) + '\n';
}

export function meetsThreshold(r: Result, failOn: 'error' | 'warning' | 'never'): boolean {
  if (failOn === 'never') return false;
  return r.findings.some((f) => f.severity === 'error' || (failOn === 'warning' && f.severity === 'warning'));
}
