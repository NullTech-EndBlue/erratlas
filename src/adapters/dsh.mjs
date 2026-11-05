import path from 'node:path';
import { silentMarks } from '../classify.mjs';

/**
 * Adapter for DeepSeek Harness session logs.
 * Layout: <root>/<encoded-project>/<session-id>/session.v4.jsonl.zstd
 * Ground truth: data.message.isError on tool/result records.
 */
export const name = 'dsh';

export const include = ['**/*.jsonl.zstd', '**/*.jsonl'];

export function metaOf(rel) {
  const parts = rel.split(path.sep);
  return {
    proj: parts[0] || '',
    sid: parts.length > 2 ? parts[1] : (parts[0] || rel),
    rel,
  };
}

export function scan(lines, meta) {
  const calls = new Map();
  const callModel = new Map();
  let curModel = '?';
  const recs = [];
  for (const line of lines) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const d = o.data;
    if (!d) continue;
    if (o.type === 'request/context') { if (d.model) curModel = d.model; continue; }
    if (o.type === 'assistant/message') {
      const msg = d.message || {};
      const src = msg.source || {};
      if (src.model) curModel = src.model;
      for (const x of (msg.content || [])) {
        if (x && x.type === 'tool-call' && x.id) callModel.set(x.id, src.model || curModel);
      }
      continue;
    }
    if (o.type === 'tool/call') {
      calls.set(d.callId, { n: d.name, a: d.arguments });
      if (!callModel.has(d.callId)) callModel.set(d.callId, curModel);
      continue;
    }
    if (o.type !== 'tool/result') continue;
    const m = d.message || {};
    let text = '';
    for (const x of (m.content || [])) if (x && x.type === 'text') text += (x.text || '');
    const ca = calls.get(m.toolCallId) || {};
    const isErr = m.isError === true;
    const rec = {
      t: o.time || 0,
      tool: ca.n || '?',
      model: callModel.get(m.toolCallId) || curModel,
      sid: meta.sid,
      proj: meta.proj,
      ie: isErr ? 1 : 0,
      en: (d.error && d.error.name) || '',
      ec: (d.error && d.error.code) || '',
      tl: text.length,
    };
    if (isErr) { rec.tx = text.slice(0, 3000); rec.args = String(ca.a || '').slice(0, 400); }
    else { rec.sm = silentMarks(text); }
    recs.push(rec);
  }
  return recs;
}
