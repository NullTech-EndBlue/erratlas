/**
 * Redaction for sharing session logs outside your machine.
 *
 * Text: absolute paths, emails, URLs, IPs, tokens and long hashes are replaced
 * with <placeholders>. Session ids and project folder names are replaced with
 * stable aliases (S01, project-a, ...) so tables stay readable and joinable.
 */

const CREDENTIAL = /\b(?:sk|ghp|gho|ghs|ghu|npm|xox[baprs])[-_]?[A-Za-z0-9_-]{12,}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL = /https?:\/\/[^\s"'`)<>\]]+/g;
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const LONG_HEX = /\b[0-9a-fA-F]{32,}\b/g;
const WIN_PATH = /\b[A-Za-z]:[\\/][^\s"'`,;:)\]]*/g;
const UNIX_PATH = /(^|[\s"'(=])((?:\/[\w.\-]+){2,}\/?[\w.\-]*)/g;
const UNC_PATH = /\\\\[\w.$-]+\\[^\s"',;)\]]*/g;
const TILDE_PATH = /(^|[\s"'(=])~\/[^\s"',;)\]]*/g;

/** Scrub free text. Order matters: credentials and emails before paths. */
export function scrub(text) {
  if (!text) return text;
  let s = String(text);
  s = s.replace(CREDENTIAL, '<token>');
  s = s.replace(EMAIL, '<email>');
  s = s.replace(URL, '<url>');
  s = s.replace(UNC_PATH, '<path>');
  s = s.replace(WIN_PATH, '<path>');
  s = s.replace(UNIX_PATH, (m, lead, _path) => lead + '<path>');
  s = s.replace(TILDE_PATH, (m, lead) => lead + '<path>');
  s = s.replace(IPV4, '<ip>');
  s = s.replace(LONG_HEX, '<hex>');
  return s;
}

function aliasMap(values, make) {
  const uniq = [...new Set(values)].sort();
  const m = new Map();
  uniq.forEach((v, i) => m.set(v, make(i)));
  return m;
}

/**
 * Return a redacted copy of the record list.
 * Classification runs on the redacted text afterwards, so counts stay comparable:
 * every rule keys on wording, not on paths.
 */
export function redactRecords(recs) {
  const sidAlias = aliasMap(recs.map((r) => r.sid), (i) => 'S' + String(i + 1).padStart(2, '0'));
  const projAlias = aliasMap(recs.map((r) => r.proj), (i) => 'project-' + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? '-' + Math.floor(i / 26) : ''));
  return recs.map((r) => {
    const out = Object.assign({}, r);
    out.sid = sidAlias.get(r.sid) || r.sid;
    out.proj = projAlias.get(r.proj) || r.proj;
    if (r.tx) out.tx = scrub(r.tx);
    if (r.args) out.args = scrub(r.args);
    return out;
  });
}
