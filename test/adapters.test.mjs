import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanTree } from '../src/scan.mjs';
import { makeAdapter } from '../src/adapters/generic.mjs';
import * as dsh from '../src/adapters/dsh.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('dsh adapter reads tool results and keeps the isError ground truth', () => {
  const res = scanTree({ root: path.join(here, 'fixtures', 'dsh'), adapter: dsh, noCache: true });
  assert.equal(res.recs.length, 2);
  assert.equal(res.recs[0].ie, 1);
  assert.equal(res.recs[0].tool, 'read');
  assert.equal(res.recs[0].model, 'demo-model');
  assert.equal(res.recs[0].proj, 'proj-abc');
  assert.equal(res.recs[1].ie, 0);
  assert.deepEqual(res.recs[1].sm, ['exit-marker']);
});

test('cache reuses unchanged files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erratlas-'));
  const cachePath = path.join(dir, 'cache.json');
  const root = path.join(here, 'fixtures', 'dsh');
  const a = scanTree({ root, adapter: dsh, cachePath });
  assert.equal(a.stats.scanned, 1);
  const b = scanTree({ root, adapter: dsh, cachePath });
  assert.equal(b.stats.scanned, 0);
  assert.equal(b.stats.reused, 1);
  assert.equal(b.recs.length, a.recs.length);
});

test('generic adapter maps claude-code style jsonl', () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(here, '..', 'presets', 'claude-code.json'), 'utf8'));
  const adapter = makeAdapter(mapping);
  const res = scanTree({ root: path.join(here, 'fixtures', 'generic'), adapter: adapter, noCache: true });
  assert.equal(res.recs.length, 2);
  assert.equal(res.recs[0].tool, 'Bash');
  assert.equal(res.recs[0].ie, 1);
  assert.equal(res.recs[0].model, 'claude-demo');
  assert.equal(res.recs[1].ie, 0);
  assert.ok(res.recs[0].t > 0);
});
test('claude-code preset handles real transcript shapes', () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(here, '..', 'presets', 'claude-code.json'), 'utf8'));
  const adapter = makeAdapter(mapping);
  const res = scanTree({ root: path.join(here, 'fixtures', 'claude-code'), adapter: adapter, noCache: true });
  assert.equal(res.recs.length, 4, 'four tool calls, noise records ignored');
  const byTool = Object.fromEntries(res.recs.map((r) => [r.tool, r]));
  // is_error nested inside the {stdout,stderr,is_error} content object (Bash)
  assert.equal(byTool.Bash.ie, 1, 'bash failure must be caught through content.is_error');
  assert.ok(byTool.Bash.tx.includes('No such file'), 'stderr is folded into the result text');
  // content as an array of text blocks, block level is_error:false
  assert.equal(byTool.Read.ie, 0);
  // block level is_error:true with plain string content
  assert.equal(byTool.Edit.ie, 1);
  // no is_error field at all means success
  assert.equal(byTool.Write.ie, 0);
  assert.equal(byTool.Read.model, 'claude-demo');
  assert.ok(res.recs.every((r) => r.t > 0), 'timestamps parsed');
});
test('codex preset handles rollouts with two call families', () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(here, '..', 'presets', 'codex.json'), 'utf8'));
  const adapter = makeAdapter(mapping);
  const res = scanTree({ root: path.join(here, 'fixtures', 'codex'), adapter: adapter, noCache: true });
  assert.equal(res.recs.length, 4, 'four tool results');
  const execs = res.recs.filter((r) => r.tool === 'exec_command');
  const patch = res.recs.find((r) => r.tool === 'apply_patch');
  assert.equal(execs.length, 3);
  assert.ok(patch, 'custom_tool_call family is picked up');
  // Process exited with code 0 must stay a success
  assert.equal(execs.filter((r) => r.ie === 0).length, 1);
  // exit code 1 in the output text, and payload.is_error, must both be failures
  assert.equal(execs.filter((r) => r.ie === 1).length, 2);
  const missing = res.recs.find((r) => (r.tx || '').includes('missing.yaml'));
  assert.ok(missing && missing.ie === 1, 'stderr text is kept for failures');
  // custom_tool_call_output wraps JSON in a string with metadata.exit_code
  assert.equal(patch.ie, 0);
  assert.ok(patch.tl > 0, 'unwrapped nested output text counts as content');
});
