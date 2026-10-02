import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ajv } from 'ajv';
import { renderSarif } from '../src/report.js';
import { cfg, entry, run } from './helpers.js';

// A structural SARIF 2.1.0 check (the fields GitHub code scanning requires).
const schema = {
  type: 'object',
  required: ['version', 'runs'],
  properties: {
    version: { const: '2.1.0' },
    runs: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['tool', 'results'],
        properties: {
          tool: { type: 'object', required: ['driver'], properties: { driver: { type: 'object', required: ['name', 'rules'] } } },
          results: {
            type: 'array',
            items: {
              type: 'object',
              required: ['ruleId', 'level', 'message', 'locations'],
              properties: { level: { enum: ['error', 'warning', 'note'] }, locations: { type: 'array', minItems: 1 } },
            },
          },
        },
      },
    },
  },
};

test('SARIF output satisfies the required structure and ruleIndex points at the right rule', () => {
  const r = run({ '.github/dependabot.yml': cfg(entry('npm', '/'), entry('docker', '/')), 'package.json': '{"dependencies":{"a":"1"}}', 'Dockerfile': 'FROM y', 'api/Dockerfile': 'FROM x' });
  const doc = JSON.parse(renderSarif(r, '0.1.0')) as { runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string; ruleIndex: number }[] }[] };
  const ajv = new Ajv({ strict: false });
  assert.ok(ajv.validate(schema, doc), JSON.stringify(ajv.errors));
  for (const res of doc.runs[0]!.results) assert.equal(doc.runs[0]!.tool.driver.rules[res.ruleIndex]!.id, res.ruleId);
});
