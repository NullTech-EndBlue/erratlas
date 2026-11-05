import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Minimal glob: '**' spans directories, '*' and '?' stay inside one segment. */
function toRegExp(pattern) {
  const norm = pattern.split(path.sep).join('/');
  let re = '';
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch === '*') {
      if (norm[i + 1] === '*') {
        re += '.*';
        i++;
        if (norm[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp('^' + re + '$');
}

/** Walk a root directory and return files matching any include glob (relative to root). */
export function findFiles(rootDir, includePatterns) {
  const regexes = includePatterns.map(toRegExp);
  const out = [];
  const walk = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + path.sep + e.name : e.name;
      if (e.isDirectory()) walk(abs, r);
      else {
        const slash = r.split(path.sep).join('/');
        if (regexes.some((re) => re.test(slash))) out.push({ abs, rel: r });
      }
    }
  };
  walk(rootDir, '');
  return out;
}
