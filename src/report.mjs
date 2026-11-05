import { classify, signature, groupOf } from './classify.mjs';

const ZH = {
  '1-tool-friction': '编辑版本摩擦',
  '2-bad-code': '代码写错',
  '3-fumbled-edit': '编辑没对准(手滑)',
  '4-bad-arguments': '参数写错(手滑)',
  '5-wrong-path': '路径/范围猜错',
  '6-timeout': '超时(太重)',
  '7-capability-edge': '工具能力边界',
  '8-environment': '系统/环境故障',
  '9-interrupted': '被打断/中止',
  '10-policy': '策略/配置限制',
  '11-residual': '其它零散',
};

const EN = {
  '1-tool-friction': 'editor version friction',
  '2-bad-code': 'my code was wrong',
  '3-fumbled-edit': 'edit target mismatch (fumble)',
  '4-bad-arguments': 'bad arguments (fumble)',
  '5-wrong-path': 'wrong path or range',
  '6-timeout': 'timeout (too heavy)',
  '7-capability-edge': 'tool capability edge',
  '8-environment': 'environment or network fault',
  '9-interrupted': 'interrupted or cancelled',
  '10-policy': 'policy or config gate',
  '11-residual': 'residual',
};

export function groupLabel(key, zh) {
  return (zh ? ZH[key] : EN[key]) || key;
}

export function pct(a, b) {
  return (100 * a / Math.max(b, 1)).toFixed(1) + '%';
}

export function pad(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

export function dayOf(ms, offsetMin) {
  const off = (offsetMin || 0) * 60000;
  const d = new Date((ms || 0) + off);
  return isNaN(d.getTime()) ? '?' : d.toISOString().slice(0, 10);
}

export function weekOf(ms, offsetMin) {
  const off = (offsetMin || 0) * 60000;
  const d = new Date((ms || 0) + off);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function bar(v, max, width) {
  return '#'.repeat(Math.max(v > 0 ? 1 : 0, Math.round(width * v / Math.max(max, 1))));
}

function tally(recs, keyFn) {
  const m = new Map();
  for (const r of recs) {
    const k = keyFn(r);
    const v = m.get(k) || { n: 0, e: 0 };
    v.n++;
    if (r.ie) v.e++;
    m.set(k, v);
  }
  return m;
}

/** Full analysis bundle; both the text and markdown renderers consume this. */
export function analyze(recs, opts) {
  const o = opts || {};
  const errs = recs.filter((r) => r.ie);
  const causes = new Map();
  for (const r of errs) {
    const c = classify(r);
    causes.set(c, (causes.get(c) || 0) + 1);
  }
  const groups = new Map();
  for (const [c, n] of causes) {
    const g = groupOf(c);
    groups.set(g, (groups.get(g) || 0) + n);
  }
  const sigs = new Map();
  for (const r of errs) {
    const k = classify(r) + ' | ' + signature(r);
    sigs.set(k, (sigs.get(k) || 0) + 1);
  }
  const silent = [];
  let silentN = 0;
  let nonErr = 0;
  for (const r of recs) {
    if (r.ie) continue;
    nonErr++;
    if (r.sm && r.sm.length) { silentN++; silent.push(r); }
  }
  return {
    total: recs.length,
    errors: errs.length,
    recs,
    errs,
    tools: tally(recs, (r) => r.tool),
    models: tally(recs, (r) => r.model),
    causes,
    groups,
    sigs,
    silent,
    silentN,
    nonErr,
    o,
  };
}

export function renderText(a, st, zh) {
  const L = [];
  const off = a.o.tzOffsetMin || 0;
  const ts = a.recs.map((r) => r.t).filter(Boolean);
  L.push('root=' + st.root + '  files=' + st.files + '  undecodable=' + st.bad +
    '  cache: reused=' + st.reused + ' scanned=' + st.scanned + ' in ' + st.ms + 'ms');
  if (ts.length) L.push('window=' + dayOf(Math.min(...ts), off) + '..' + dayOf(Math.max(...ts), off));
  L.push('tool results=' + a.total + '  isError=true ' + a.errors + ' (' + pct(a.errors, a.total) + ')');
  L.push('');

  const top = a.o.top || 20;
  const minTool = a.total < 50 ? 1 : 5;
  const minModel = a.total < 50 ? 1 : 20;
  L.push('-- by tool --');
  for (const kv of [...a.tools.entries()].sort((x, y) => y[1].e - x[1].e)) {
    if (kv[1].n < minTool || kv[1].e === 0) continue;
    L.push(pad(kv[1].e, 5) + ' / ' + pad(kv[1].n, 6) + ' ' + pct(kv[1].e, kv[1].n) + '  ' + kv[0]);
  }
  L.push('');

  L.push('-- by model --');
  for (const kv of [...a.models.entries()].sort((x, y) => y[1].e - x[1].e)) {
    if (kv[1].n < minModel || kv[1].e === 0) continue;
    L.push(pad(kv[1].e, 5) + ' / ' + pad(kv[1].n, 6) + ' ' + pct(kv[1].e, kv[1].n) + '  ' + kv[0]);
  }
  L.push('');

  L.push('-- whose problem --');
  for (const kv of [...a.groups.entries()].sort((x, y) => y[1] - x[1])) {
    L.push(pad(kv[1], 5) + ' ' + pct(kv[1], a.errors).padStart(6) + '  ' + groupLabel(kv[0], zh));
  }
  L.push('');

  L.push('-- by cause --');
  for (const kv of [...a.causes.entries()].sort((x, y) => y[1] - x[1])) {
    const tools = [];
    for (const r of a.errs) {
      if (classify(r) !== kv[0]) continue;
      const i = tools.findIndex((t) => t[0] === r.tool);
      if (i >= 0) tools[i][1]++; else tools.push([r.tool, 1]);
    }
    tools.sort((x, y) => y[1] - x[1]);
    L.push(pad(kv[1], 5) + '  ' + kv[0].padEnd(21) + ' ' + tools.slice(0, 5).map((t) => t[0] + ':' + t[1]).join(' '));
  }
  L.push('');

  L.push('-- top signatures --');
  for (const kv of [...a.sigs.entries()].sort((x, y) => y[1] - x[1]).slice(0, top)) {
    L.push(pad(kv[1], 5) + '  ' + kv[0]);
  }
  L.push('');
  return L.join('\n');
}

export function renderDayText(a, mode, offsetMin) {
  const key = mode === 'week' ? weekOf : dayOf;
  const m = new Map();
  for (const r of a.recs) {
    const k = key(r.t, offsetMin);
    const v = m.get(k) || { n: 0, e: 0 };
    v.n++; if (r.ie) v.e++;
    m.set(k, v);
  }
  const maxE = Math.max(...[...m.values()].map((x) => x.e), 1);
  const L = ['-- by ' + mode + ' --'];
  for (const k of [...m.keys()].sort()) {
    const v = m.get(k);
    L.push(k + '  err=' + pad(v.e, 4) + ' calls=' + pad(v.n, 6) + ' ' + pct(v.e, v.n).padStart(6) + '  ' + bar(v.e, maxE, 46));
  }
  return L.join('\n');
}

export function renderSilentText(a, top) {
  const buck = new Map();
  for (const r of a.silent) {
    const k = r.tool + ' :: ' + r.sm[0];
    const v = buck.get(k) || { n: 0, all: {} };
    v.n++;
    for (const s of r.sm) v.all[s] = (v.all[s] || 0) + 1;
    buck.set(k, v);
  }
  const L = ['-- silent failures: isError=false but the output says otherwise --'];
  L.push('total ' + a.silentN + ' / ' + a.nonErr + ' non-error results (' + pct(a.silentN, a.nonErr) + ')');
  for (const kv of [...buck.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, top)) {
    const ex = Object.entries(kv[1].all).sort((x, y) => y[1] - x[1]).map((x) => x[0] + ':' + x[1]).join(' ');
    L.push(pad(kv[1].n, 5) + '  ' + kv[0].padEnd(38) + ' ' + ex);
  }
  return L.join('\n');
}

export function renderSessionsText(a, top, offsetMin) {
  const m = new Map();
  for (const r of a.recs) {
    const v = m.get(r.sid) || { n: 0, e: 0, m: r.model, proj: r.proj, t: r.t };
    v.n++; if (r.ie) v.e++;
    if (r.t && (!v.t || r.t < v.t)) v.t = r.t;
    m.set(r.sid, v);
  }
  const L = ['-- top sessions --'];
  for (const kv of [...m.entries()].sort((x, y) => y[1].e - x[1].e).slice(0, top)) {
    L.push(pad(kv[1].e, 4) + ' / ' + pad(kv[1].n, 4) + ' ' + pct(kv[1].e, kv[1].n).padStart(6) + '  ' +
      dayOf(kv[1].t, offsetMin) + '  ' + String(kv[1].m).padEnd(16) + ' ' + String(kv[1].proj).slice(0, 40));
  }
  return L.join('\n');
}

export function toMarkdown(a, st) {
  const L = [];
  const off = a.o.tzOffsetMin || 0;
  const ts = a.recs.map((r) => r.t).filter(Boolean);
  L.push('# Tool failure analysis');
  L.push('');
  L.push('> ' + st.files + ' log files | ' + a.total + ' tool calls | ' + a.errors + ' failures (' + pct(a.errors, a.total) + ')' +
    (ts.length ? ' | ' + dayOf(Math.min(...ts), off) + ' .. ' + dayOf(Math.max(...ts), off) : ''));
  L.push('');
  L.push('Failure signal: the harness error flag on each tool result. Everything below is derived from that.');
  L.push('');
  L.push('## Whose problem');
  L.push('');
  L.push('| group | count | share |');
  L.push('|---|---:|---:|');
  for (const kv of [...a.groups.entries()].sort((x, y) => y[1] - x[1])) {
    L.push('| ' + groupLabel(kv[0], false) + ' | ' + kv[1] + ' | ' + pct(kv[1], a.errors) + ' |');
  }
  L.push('');
  L.push('## By cause');
  L.push('');
  L.push('| cause | count |');
  L.push('|---|---:|');
  for (const kv of [...a.causes.entries()].sort((x, y) => y[1] - x[1])) L.push('| ' + kv[0] + ' | ' + kv[1] + ' |');
  L.push('');
  L.push('## By tool');
  L.push('');
  L.push('| tool | failures / calls | rate |');
  L.push('|---|---:|---:|');
  for (const kv of [...a.tools.entries()].sort((x, y) => y[1].e - x[1].e)) {
    if (kv[1].n < 5 || kv[1].e === 0) continue;
    L.push('| ' + kv[0] + ' | ' + kv[1].e + ' / ' + kv[1].n + ' | ' + pct(kv[1].e, kv[1].n) + ' |');
  }
  L.push('');
  L.push('## By model');
  L.push('');
  L.push('| model | failures / calls | rate |');
  L.push('|---|---:|---:|');
  for (const kv of [...a.models.entries()].sort((x, y) => y[1].e - x[1].e)) {
    if (kv[1].n < 20 || kv[1].e === 0) continue;
    L.push('| ' + kv[0] + ' | ' + kv[1].e + ' / ' + kv[1].n + ' | ' + pct(kv[1].e, kv[1].n) + ' |');
  }
  L.push('');
  L.push('## Top signatures');
  L.push('');
  L.push('| count | signature |');
  L.push('|---:|---|');
  for (const kv of [...a.sigs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40)) {
    L.push('| ' + kv[1] + ' | ' + kv[0].replace(/\|/g, '\\|') + ' |');
  }
  L.push('');
  L.push('## Silent failures');
  L.push('');
  L.push('Tool said success, output says otherwise: **' + a.silentN + ' / ' + a.nonErr + ' (' + pct(a.silentN, a.nonErr) + ')**');
  L.push('');
  return L.join('\n');
}

export function toJson(a) {
  return a.errs.map((r) => ({
    time: new Date(r.t).toISOString(),
    tool: r.tool,
    model: r.model,
    session: r.sid,
    project: r.proj,
    cause: classify(r),
    group: groupOf(classify(r)),
    signature: signature(r),
    error: r.en,
    code: r.ec,
    args: r.args,
    text: r.tx,
  }));
}