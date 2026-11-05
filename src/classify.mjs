/**
 * Failure classification.
 *
 * Two levels:
 *   - cause  : what mechanically went wrong (31 rules, ordered, first match wins)
 *   - group  : whose problem it is (tool friction / my bad code / my fumble / capability edge ...)
 */

/** Strip harness wrappers and stack traces so rules see the real message. */
export function core(text) {
  let s = text || '';
  s = s.replace(/^Error: code run failed \((exception|timeout|abort|invalid-output|worker-exit)\):\s*/, '');
  s = s.replace(/^\s*ToolCallError:\s*/, '');
  s = s.replace(/\n\s*at [\s\S]*$/, '');
  return s.trim();
}

export const RULES = [
  [/file has not been read/i, 'A-edit-need-read'],
  [/file has not been read yet/i, 'A-edit-need-read'],
  [/file changed since it was read/i, 'A-edit-stale'],
  [/file has been modified since read/i, 'A-edit-stale'],
  [/file no longer exists/i, 'A-edit-gone'],
  [/old_string and new_string must differ/i, 'B-edit-noop'],
  [/old_string matched \d+ times/i, 'B-edit-ambiguous'],
  [/found \d+ matches of the string to replace/i, 'B-edit-ambiguous'],
  [/old_string was not found/i, 'B-edit-no-match'],
  [/string to replace not found in file/i, 'B-edit-no-match'],
  [/exceeds the \d+px limit/i, 'G-unreadable-file'],
  [/binary file|invalid UTF-8 text/i, 'G-unreadable-file'],
  [/unsupported content type/i, 'G-unsupported-content'],
  [/cross-origin redirect/i, 'G-web-redirect'],
  [/search failed \(exit \d+\)/i, 'G-search-io'],
  [/out of range/i, 'C-out-of-range'],
  [/ENOENT|No such file|does not exist|cannot read .*not found|: not found$/i, 'C-missing-path'],
  [/Expected a semicolon|Expected ',', got|Expected ';'|Unterminated|Expected unicode escape|Unexpected character|Expression expected|Unexpected token|Missing initializer|Identifier cannot follow number|Invalid assignment target|Legacy octal escape|'const' declarations must be initialized|A numeric separator|'import', and 'export'|Private field|has already been declared|missing \)/i, 'D-ts-syntax'],
  [/Unterminated string in JSON|Unexpected end of JSON input|Expected ',' or '\}'|Expected double-quoted property name|is not valid JSON|invalid page metadata/i, 'D-json-syntax'],
  [/deadline reached|timed out after|tool call timed out/i, 'E-timeout'],
  [/\(abort\)|abort: |aborted|user cancelled|COMPUTER_USE_STOPPED_BY_USER|stopped by user|workflow run was cancelled|terminated/i, 'E-user-abort'],
  [/interrupted after it was recorded/i, 'X-interrupted'],
  [/missing required property|unknown property|lossless JSON|INVALID_ARGUMENTS|must be less than|must be at least|must be an? |must contain at most|at most \d+ queries/i, 'F-arg-invalid'],
  [/unknown tool/i, 'F-unknown-tool'],
  [/command not found/i, 'I-shell-missing'],
  [/Traceback \(most recent call last\)/i, 'J-python-traceback'],
  [/exceeds maxDepth/i, 'K-subagent-limit'],
  [/SetNamedSecurityInfoW|ReplaceFileW|EBUSY|ENOTEMPTY|EISDIR|EEXIST|EPERM|EACCES/i, 'M-fs-io'],
  [/ENOTFOUND|ECONNREFUSED|fetch failed|ETIMEDOUT|socket hang up|getaddrinfo|Failed to connect/i, 'M-network'],
  [/Windows Job runner|runtime disposed|worker-exit/i, 'M-infra'],
  [/is not a function|TypeError|ReferenceError|is not defined|Cannot read propert|not iterable|Cannot destructure|Maximum call stack|Cannot mix BigInt/i, 'H-js-runtime'],
  [/only available in plan mode|EXECUTION_OFF|requires its owner or Team Lead|require a direct human turn|no current goal|goal .* already exists|stale goal ref|is not ready to claim|active teammate .* not found|invalid workspace-relative write scope|non-public IP|not strictly wider|this goal operation requires/i, 'P-policy'],
  [/no API key|store it through the credentials|does not declare image input|replaced the official tool|no web_search_tool_result/i, 'P-config'],
  [/human interaction is unavailable/i, 'P-nested-human'],
  [/server is disconnected/i, 'P-mcp-down'],
  [/skill .* is unknown/i, 'F-arg-invalid'],
  [/exit code: [1-9]/, 'L-exit-nonzero'],
];

const GROUP_OF = {
  'A-edit-need-read': '1-tool-friction',
  'A-edit-stale': '1-tool-friction',
  'A-edit-gone': '1-tool-friction',
  'D-ts-syntax': '2-bad-code',
  'D-json-syntax': '2-bad-code',
  'H-js-runtime': '2-bad-code',
  'J-python-traceback': '2-bad-code',
  'I-shell-missing': '2-bad-code',
  'L-exit-nonzero': '2-bad-code',
  'B-edit-no-match': '3-fumbled-edit',
  'B-edit-noop': '3-fumbled-edit',
  'B-edit-ambiguous': '3-fumbled-edit',
  'F-arg-invalid': '4-bad-arguments',
  'F-unknown-tool': '4-bad-arguments',
  'C-missing-path': '5-wrong-path',
  'C-out-of-range': '5-wrong-path',
  'E-timeout': '6-timeout',
  'G-unsupported-content': '7-capability-edge',
  'G-web-redirect': '7-capability-edge',
  'G-search-io': '7-capability-edge',
  'G-unreadable-file': '7-capability-edge',
  'M-fs-io': '8-environment',
  'M-network': '8-environment',
  'M-infra': '8-environment',
  'E-user-abort': '9-interrupted',
  'X-interrupted': '9-interrupted',
  'P-policy': '10-policy',
  'P-config': '10-policy',
  'P-nested-human': '10-policy',
  'P-mcp-down': '10-policy',
  'K-subagent-limit': '10-policy',
};

export const GROUP_LABEL = {
  '1-tool-friction': 'editor version friction (read-before-edit)',
  '2-bad-code': 'code I wrote was wrong',
  '3-fumbled-edit': 'edit target did not match (fumble)',
  '4-bad-arguments': 'bad tool arguments (fumble)',
  '5-wrong-path': 'wrong path / range',
  '6-timeout': 'timed out (too heavy)',
  '7-capability-edge': 'capability edge of the tool',
  '8-environment': 'environment / network fault',
  '9-interrupted': 'interrupted / cancelled',
  '10-policy': 'policy / config gate',
  '11-residual': 'residual',
};

export function groupOf(cause) {
  return GROUP_OF[cause] || '11-residual';
}

/** Classify one normalized record. */
export function classify(rec) {
  if (rec.ie && !rec.tl) return 'Y-empty-error';
  if (!rec.ie) return rec.tl ? 'ok' : 'N-empty-result';
  const raw = rec.tx || '';
  if (/code run failed \(abort\)/i.test(raw) || /^\[object Object\]/.test(core(raw))) return 'E-user-abort';
  const head = core(raw).split('\n')[0];
  for (const rule of RULES) if (rule[0].test(head)) return rule[1];
  const full = core(raw);
  for (const rule of RULES) if (rule[0].test(full)) return rule[1];
  return 'Z-other';
}

export function normalizePath(s) {
  let t = s.replace(/"[^"]*"/g, (m) => {
    const inner = m.slice(1, -1);
    const isPath = /^[A-Za-z]:[\\/]/.test(inner) || inner.startsWith('/') || inner.includes('\\');
    return isPath ? '"PATH"' : m;
  });
  t = t.replace(/[A-Za-z]:[\\/][^\s"',;)]+/g, 'PATH');
  t = t.replace(/(?:^|\s)\/(?:[\w.\-]+\/)+[\w.\-]*/g, ' PATH');
  t = t.replace(/https?:\/\/[^\s"')]+/g, 'URL');
  return t;
}

const SIG_RULES = [
  [/Expected a semicolon/, 'Expected a semicolon'],
  [/Expected ',', got '([^']*)'/, (m) => "Expected ',', got '" + m[1] + "'"],
  [/Expected ';', '\}' or <eof>/, "Expected ';', '}' or <eof>"],
  [/Unterminated template/, 'Unterminated template'],
  [/Expected unicode escape/, 'Expected unicode escape'],
  [/[Uu]nterminated (?:string|regexp)/, 'unterminated literal'],
  [/Unexpected character '([^']*)'/, (m) => "Unexpected character '" + m[1] + "'"],
  [/Expression expected/, 'Expression expected'],
  [/Unexpected token/, 'Unexpected token'],
  [/(TypeError|ReferenceError): ([A-Za-z_.$]+ (?:is not|Cannot read)[^ ]*)/, (m) => m[1] + ': ' + m[2]],
  [/missing required property ("[^"]+")/, (m) => 'missing required property ' + m[1]],
  [/unknown property '?([^'" )]+)'?/, (m) => 'unknown property ' + m[1]],
  [/unsupported content type ("[^"]+")/, (m) => 'unsupported content type ' + m[1]],
];

/** Human-stable signature: strip paths, ids and numbers so identical failures collapse. */
export function signature(rec) {
  let s = normalizePath(core(rec.tx || '').replace(/\n\s*at [\s\S]*$/, ''));
  s = s.replace(/[0-9a-f]{8,}/g, 'X').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
  for (const rule of SIG_RULES) {
    const m = s.match(rule[0]);
    if (m) return typeof rule[1] === 'function' ? rule[1](m) : rule[1];
  }
  return s.slice(0, 95);
}

/** Markers that mean "this call says it succeeded but the output says otherwise". */
export const SILENT_MARKS = [
  [/\[exit code: [1-9]\d*\]/, 'exit-marker'],
  [/Traceback \(most recent/, 'traceback'],
  [/^\s*\[stderr\]/m, 'stderr-block'],
  [/\bENOENT\b/, 'ENOENT'],
  [/command not found/, 'cmd-not-found'],
  [/No such file or directory/, 'no-such-file'],
  [/exit=[1-9]/, 'exit=N'],
  [/HTTP [45]\d\d/, 'http-4xx5xx'],
  [/permission denied/i, 'permission-denied'],
  [/^Error: /m, 'Error: line'],
  [/FAILED: /, 'build-FAILED'],
  [/^\s*error(\[|:)/m, 'error-line'],
];

export function silentMarks(text) {
  const out = [];
  for (const m of SILENT_MARKS) if (m[0].test(text || '')) out.push(m[1]);
  return out;
}

/** Session directory names encode paths as --X-Y-~4F18~5316-- ; decode for display. */
export function decodeProjectName(p) {
  if (!p) return '?';
  let s = String(p).replace(/^--/, '').replace(/--$/, '');
  s = s.replace(/~([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/-/g, '/');
}