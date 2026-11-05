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
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.length > 1 && (s[0] === '{' || s[0] === '[') && (s[s.length - 1] === '}' || s[s.length - 1] === ']')) {
      try { return asText(JSON.parse(s)); } catch { return v; }
    }
    return v;
  }
  if (Array.isArray(v)) {
    const parts = v.map((x) => asText(x)).filter((x) => x !== '');
    return parts.length ? parts.join('\n') : JSON.stringify(v);
  }
  if (typeof v === 'object') {
    if ('error' in v) return 'Error: ' + (typeof v.error === 'string' ? v.error : JSON.stringify(v.error));
    const bits = [];
    if (typeof v.stdout === 'string' && v.stdout) bits.push(v.stdout);
    if (typeof v.stderr === 'string' && v.stderr) bits.push(v.stderr);
    if (typeof v.output === 'string' && !bits.length) bits.push(asText(v.output));
    let code = typeof v.exit_code === 'number' ? v.exit_code : (v.metadata && typeof v.metadata.exit_code === 'number' ? v.metadata.exit_code : null);
    let text = bits.join('\n');
    if (code !== null && code !== 0) text += (text ? '\n' : '') + '[exit code: ' + code + ']';
    return text || JSON.stringify(v);
  }
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
  const callSpecs = mapping.records.filter((r) => r.kind === 'call');
  const resultSpecs = mapping.records.filter((r) => r.kind === 'result');
  if (!callSpecs.length || !resultSpecs.length) throw new Error('mapping needs at least one kind:"call" and one kind:"result" record spec');

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
        for (const callSpec of callSpecs) {
          if (!matches(o, callSpec.where)) continue;
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
        for (const resultSpec of resultSpecs) {
          if (!matches(o, resultSpec.where)) continue;
          const holder = resultSpec.each ? getPath(o, resultSpec.each) : o;
          const items = Array.isArray(holder) ? holder : [holder];
          for (const it of items) {
            if (!matches(it, resultSpec.eachWhere)) continue;
            const id = getPath(it, resultSpec.id);
            if (id === undefined || id === null) continue;
            const call = calls.get(String(id)) || {};
            const text = asText(getPath(it, resultSpec.text));
            const errPaths = Array.isArray(resultSpec.error) ? resultSpec.error : (resultSpec.error ? [resultSpec.error] : []);
            let isErr = false;
            for (const p of errPaths) {
              const v = getPath(it, p);
              if (typeof v === 'boolean') { isErr = v; break; }
            }
            if (!isErr && resultSpec.errorPattern) isErr = new RegExp(resultSpec.errorPattern, 'i').test(text);
            const model = call.m || getPath(o, resultSpec.model) || curModel;
            if (call.m) curModel = call.m;
            const tt = typeof t === 'number' ? t : (Date.parse(t) || 0);
            const rec = {
              t: tt,
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