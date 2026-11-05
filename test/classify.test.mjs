import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, signature, groupOf, core, normalizePath, silentMarks } from '../src/classify.mjs';

const rec = (tx, ie) => ({ ie: ie === undefined ? 1 : ie, tx, tl: (tx || '').length });

test('edit friction causes are recognised', () => {
  assert.equal(classify(rec('cannot modify "a.ts": file has not been read - read the file, then retry')), 'A-edit-need-read');
  assert.equal(classify(rec('cannot edit "a.ts": file changed since it was read')), 'A-edit-stale');
});

test('run_code wrapper is unwrapped before matching', () => {
  const r = rec('Error: code run failed (exception): Expected a semicolon\nFile sandbox: danger-full-access.');
  assert.equal(classify(r), 'D-ts-syntax');
  assert.equal(core(r.tx).split('\n')[0], 'Expected a semicolon');
});

test('abort wrapper maps to interrupted even when the body is opaque', () => {
  assert.equal(classify(rec('Error: code run failed (abort): [object Object]\nCaptured output: ...')), 'E-user-abort');
});

test('unknown failures fall into Z-other, successes into ok', () => {
  assert.equal(classify(rec('something nobody has seen before')), 'Z-other');
  assert.equal(classify(rec('all good', 0)), 'ok');
});

test('signature collapses numbers and paths', () => {
  const a = signature(rec('old_string was not found in "C:\\\\a\\\\b.ts"'));
  const b = signature(rec('old_string was not found in "D:\\\\x\\\\y.ts"'));
  assert.equal(a, b);
});

test('quoted non-paths survive normalization', () => {
  const s = normalizePath('unsupported content type "application/pdf"');
  assert.ok(s.includes('application/pdf'), s);
  const p = normalizePath('cannot read "C:\\\\Users\\\\me\\\\a.txt"');
  assert.ok(p.includes('"PATH"'), p);
});

test('silent markers detect a fake success', () => {
  assert.deepEqual(silentMarks('build ok\n[exit code: 1]'), ['exit-marker']);
  assert.deepEqual(silentMarks('all fine'), []);
});

test('every cause maps to a group', () => {
  for (const c of ['A-edit-need-read', 'D-ts-syntax', 'E-timeout', 'G-search-io', 'P-policy', 'Z-other']) {
    assert.ok(groupOf(c).length > 0);
  }
});
test('claude code wordings map to the same causes', () => {
  assert.equal(classify(rec('String to replace not found in file.')), 'B-edit-no-match');
  assert.equal(classify(rec('Found 3 matches of the string to replace')), 'B-edit-ambiguous');
  assert.equal(classify(rec('File has not been read yet. Read it first before writing to it.')), 'A-edit-need-read');
  assert.equal(classify(rec('File has been modified since read, either by the user or by a linter.')), 'A-edit-stale');
});
