#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.js';
import { diffResults } from './pr.js';
import { CONFIG_PATHS } from './config.js';
import { meetsThreshold, renderGithub, renderJson, renderMarkdown, renderSarif, renderText } from './report.js';
import { revSource, worktreeSource } from './source.js';
import { RULES } from './types.js';

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const p of [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json'), join(here, 'package.json')]) {
      try {
        return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;
      } catch {
        /* next */
      }
    }
  } catch {
    /* bundled */
  }
  return '0.2.1';
}

const HELP = `dependabot-gaps [path] [options]

Find manifests that .github/dependabot.yml does not cover, entries that match nothing, and overlapping entries.

  -C, --cwd <dir>        run as if started in <dir> (default: .)
      --rev <ref>        read the files of a git revision instead of the working tree (works in --no-checkout clones)
  -f, --format <fmt>     text | markdown | json | github | sarif   (default: text)
  -o, --output <file>    write the report to a file
      --base <ref>       pull request mode: analyse <ref> too and report only gaps that the head introduces (exit code follows those only)
      --fail-on <level>  exit 1 on: error | warning | never   (default: warning)
      --ignore <glob>    leave matching paths out (repeatable), e.g. --ignore 'examples/**'
      --include-vendored also look into vendor/, third_party/, extern/
      --all-ecosystems   treat ecosystems with no updates entry at all as gaps (default: one info line each)
      --strict-paths     report gaps under test/example/docs paths as warnings (default: info)
      --fix              append the missing entries to .github/dependabot.yml (creates the file when absent)
      --list-rules       print the rule ids and exit
      --version`;

interface Args {
  cwd: string;
  rev?: string;
  base?: string;
  format: string;
  output?: string;
  failOn: 'error' | 'warning' | 'never';
  ignore: string[];
  includeVendored: boolean;
  strictPaths: boolean;
  allEcosystems: boolean;
  fix: boolean;
}

function parseArgs(argv: string[]): Args | number {
  const a: Args = { cwd: '.', format: 'text', failOn: 'warning', ignore: [], includeVendored: false, strictPaths: false, allEcosystems: false, fix: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const val = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '-h':
      case '--help':
        console.log(HELP);
        return 0;
      case '--version':
        console.log(version());
        return 0;
      case '--list-rules':
        for (const [id, r] of Object.entries(RULES)) console.log(`${id.padEnd(20)} ${r.severity.padEnd(8)} ${r.summary}`);
        return 0;
      case '-C':
      case '--cwd':
        a.cwd = val();
        break;
      case '--rev':
        a.rev = val();
        break;
      case '--base':
        a.base = val();
        break;
      case '-f':
      case '--format':
        a.format = val();
        break;
      case '-o':
      case '--output':
        a.output = val();
        break;
      case '--fail-on': {
        const v = val();
        if (v !== 'error' && v !== 'warning' && v !== 'never') throw new Error('--fail-on must be error, warning or never');
        a.failOn = v;
        break;
      }
      case '--ignore':
        a.ignore.push(val());
        break;
      case '--include-vendored':
        a.includeVendored = true;
        break;
      case '--strict-paths':
        a.strictPaths = true;
        break;
      case '--all-ecosystems':
        a.allEcosystems = true;
        break;
      case '--fix':
        a.fix = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        a.cwd = arg;
    }
  }
  if (!['text', 'markdown', 'json', 'github', 'sarif'].includes(a.format)) throw new Error('--format must be text, markdown, json, github or sarif');
  if (a.fix && a.base) throw new Error('--fix cannot be combined with --base');
  if (a.fix && a.rev) throw new Error('--fix needs the working tree, not --rev');
  return a;
}

function main(): number {
  let args: Args | number;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`dependabot-gaps: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (typeof args === 'number') return args;
  try {
    const root = resolve(args.cwd);
    const source = args.rev ? revSource(root, args.rev) : worktreeSource(root);
    const opts = { ignore: args.ignore, includeVendored: args.includeVendored, strictPaths: args.strictPaths, allEcosystems: args.allEcosystems };
    const head = analyze(source, opts);
    const result = args.base ? diffResults(analyze(revSource(root, args.base), opts), head, args.base) : head;
    if (args.fix) {
      if (!result.suggestion) {
        console.error('dependabot-gaps: nothing to add');
      } else {
        const target = join(root, result.configFile ?? CONFIG_PATHS[0]!);
        if (result.configFile) {
          const cur = readFileSync(target, 'utf8');
          writeFileSync(target, cur.replace(/\s*$/, '\n') + result.suggestion + '\n');
        } else {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, result.suggestion.replace(/\s*$/, '\n')); // no-config: the suggestion is a complete file
        }
        console.error(`dependabot-gaps: appended entries to ${result.configFile ?? CONFIG_PATHS[0]} (review the schedule and add groups/cooldown as you like)`);
        return 0;
      }
    }
    const text =
      args.format === 'json' ? renderJson(result)
      : args.format === 'markdown' ? renderMarkdown(result)
      : args.format === 'github' ? renderGithub(result)
      : args.format === 'sarif' ? renderSarif(result, version())
      : renderText(result);
    if (args.output) writeFileSync(args.output, text);
    else process.stdout.write(text);
    return meetsThreshold(result, args.failOn) ? 1 : 0;
  } catch (e) {
    console.error(`dependabot-gaps: ${(e as Error).message}`);
    return 2;
  }
}

process.exitCode = main();
