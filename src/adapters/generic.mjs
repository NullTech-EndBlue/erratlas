import { silentMarks } from '../classify.mjs';

/**
 * Mapping-driven adapter. Lets erratlas read any JSONL agent log without code changes.
 * See presets/ for examples.
 */

function getPath(obj, expr) {
  if (!expr) return undefined;
  let cur = obj;
  for (const seg of String(expr).split('.')) {
    if (cur === undefined || cur === null) return undefined;
    const arr = seg.endsWith('[]');
    const key = arr ? seg.slice(0, -2) : seg;
    cur = key === '' ? cur : cur[key];
    if (arr) return cur;
  }
  return cur;
}

function asText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    let s = '';
    for (const x of v) {
      if (typeof x === 'string') s += x;
      else if (x && typeof x.text === 'string') s += x.text;
      else if (x && typeof x.content === 'string') s += x.content;
    }
    return s || JSON.stringify(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function matches(obj, where) {
  if (!where) return true;
  for (const k of Object.keys(where)) {
    const v = getPath(obj, k);
    const want = where[k];
    if (Array.isArray(want) ? !want.includes(v) : v !== want) return false;
  }
  return true;
}

export function makeAdapter(mapping) {
  if (!mapping || !Array.isArray(mapping.records)) {
    throw new Error('mapping must include a records[] array');
  }
  const callSpec = mapping.records.find((r) => r.kind === 'call');
  const resultSpec = mapping.records.find((r) => r.kind === 'result');
  if (!callSpec || !resultSpec) throw new Error('mapping needs one kind:"call" and one kind:"result" record spec');

  return {
    name: mapping.name || 'generic',
    include: mapping.include || ['**/*.jsonl'],
    root: mapping.root || null,
    metaOf(rel) {
      const parts = rel.split(/[\\/]/);
      return { proj: mapping.projectFromPath ? parts[0] : (parts[0] || ''), sid: parts.length > 1 ? parts[1] : rel, rel };
    },
    scan(lines, meta) {
      const calls = new Map();
      let curModel = mapping.defaultModel || '?';
      const recs = [];
      for (const line of lines) {
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const t = mapping.time ? getPath(o, mapping.time) : o.timestamp || o.time || 0;
        // calls
        if (matches(o, callSpec.where)) {
          const holder = callSpec.each ? getPath(o, callSpec.each) : o;
          const items = Array.isArray(holder) ? holder : [holder];
          for (const it of items) {
            if (!matches(it, callSpec.eachWhere)) continue;
            const id = getPath(it, callSpec.id);
            if (id === undefined || id === null) continue;
            calls.set(String(id), {
              n: getPath(it, callSpec.tool),
              a: asText(getPath(it, callSpec.args)),
              m: getPath(it, callSpec.model) || getPath(o, callSpec.model) || curModel,
            });
          }
        }
        // results
        if (matches(o, resultSpec.where)) {
          const holder = resultSpec.each ? getPath(o, resultSpec.each) : o;
          const items = Array.isArray(holder) ? holder : [holder];
          for (const it of items) {
            if (!matches(it, resultSpec.eachWhere)) continue;
            const id = getPath(it, resultSpec.id);
            if (id === undefined || id === null) continue;
            const call = calls.get(String(id)) || {};
            const text = asText(getPath(it, resultSpec.text));
            let isErr = getPath(it, resultSpec.error) === true;
            if (!isErr && resultSpec.errorPattern) isErr = new RegExp(resultSpec.errorPattern, 'i').test(text);
            const model = call.m || getPath(o, resultSpec.model) || curModel;
            if (call.m) curModel = call.m;
            const rec = {
              t: typeof t === 'number' ? t : (Date.parse(t) || 0),
              tool: call.n || '?', model, sid: meta.sid, proj: meta.proj,
              ie: isErr ? 1 : 0, en: '', ec: '', tl: text.length,
            };
            if (isErr) { rec.tx = text.slice(0, 3000); rec.args = String(call.a || '').slice(0, 400); }
            else { rec.sm = silentMarks(text); }
            recs.push(rec);
          }
        }
      }
      return recs;
    },
  };
}
