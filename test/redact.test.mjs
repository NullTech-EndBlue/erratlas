import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, redactRecords } from '../src/redact.mjs';

test('paths, emails, urls, ips and tokens are removed', () => {
  const cases = [
    ['cannot read "C:\\\\Users\\\\me\\\\secret\\\\a.txt": not found', ['Users', 'secret', 'a.txt']],
    ['/home/me/proj/src/app.ts failed', ['/home/me', 'app.ts']],
    ['mail me at someone@example.com', ['someone@example.com']],
    ['see https://example.com/private?id=1', ['example.com']],
    ['connect to 192.168.1.10 failed', ['192.168.1.10']],
    ['token sk-abcdefghijklmnop1234 rejected', ['sk-abcdefghijklmnop1234']],
    ['hash 0123456789abcdef0123456789abcdef dead', ['0123456789abcdef0123456789abcdef']]
  ];
  for (const [input, secrets] of cases) {
    const out = scrub(input);
    for (const s of secrets) assert.ok(!out.includes(s), 'leaked "' + s + '" in: ' + out);
  }
});

test('ordinary coding text survives redaction', () => {
  const out = scrub('Expected a semicolon');
  assert.equal(out, 'Expected a semicolon');
  const out2 = scrub('old_string was not found in "src/a.ts"');
  assert.ok(out2.includes('old_string was not found'), out2);
});

test('session and project identity become stable aliases', () => {
  const recs = [
    { sid: 'b2f1-real-id', proj: '--D-EndBlue-DSH-~4F18~5316--', tx: 'boom', ie: 1, tl: 4 },
    { sid: 'a1-real-id', proj: '--D-EndBlue-DSH-plug--', tx: 'boom', ie: 1, tl: 4 },
    { sid: 'b2f1-real-id', proj: '--D-EndBlue-DSH-~4F18~5316--', tx: 'boom', ie: 0, tl: 4 }
  ];
  const out = redactRecords(recs);
  assert.ok(out.every((r) => /^S\d\d$/.test(r.sid)), out.map((r) => r.sid).join(','));
  assert.ok(out.every((r) => r.proj.startsWith('project-')), out.map((r) => r.proj).join(','));
  // same input id always maps to the same alias, and the mapping is stable across runs
  assert.equal(out[0].sid, out[2].sid);
  assert.deepEqual(redactRecords(recs).map((r) => r.sid), out.map((r) => r.sid));
  assert.equal(out[0].proj, out[2].proj);
  // originals untouched
  assert.equal(recs[0].sid, 'b2f1-real-id');
});
