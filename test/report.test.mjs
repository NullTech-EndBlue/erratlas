import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTree } from '../src/scan.mjs';
import * as dsh from '../src/adapters/dsh.mjs';
import { analyze, renderText, toMarkdown, toJson } from '../src/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function analyzeFixture() {
  const res = scanTree({ root: path.join(here, 'fixtures', 'dsh'), adapter: dsh, noCache: true });
  return { a: analyze(res.recs, { top: 5 }), st: res.stats };
}

test('text report shows counts and groups', () => {
  const { a, st } = analyzeFixture();
  const txt = renderText(a, st, false);
  assert.ok(txt.includes('isError=true 1'));
  assert.ok(txt.includes('wrong path or range'));
});

test('markdown report has the core tables', () => {
  const { a, st } = analyzeFixture();
  const md = toMarkdown(a, st);
  assert.ok(md.startsWith('# Tool failure analysis'));
  assert.ok(md.includes('## By cause'));
  assert.ok(md.includes('## Silent failures'));
});

test('json export carries cause and group per failure', () => {
  const { a } = analyzeFixture();
  const js = toJson(a);
  assert.equal(js.length, 1);
  assert.equal(js[0].cause, 'C-missing-path');
  assert.equal(js[0].group, '5-wrong-path');
});
