import fs from 'node:fs';
import path from 'node:path';
import { decodeBuffer } from './decode.mjs';
import { findFiles, expandHome } from './glob.mjs';
import { loadCache, saveCache, fileKey } from './cache.mjs';

/**
 * Scan a log tree with an adapter, reusing cached per-file records when the file is unchanged.
 */
export function scanTree(opts) {
  const { root, adapter, cachePath, refresh = false, noCache = false } = opts;
  const t0 = Date.now();
  const absRoot = path.resolve(expandHome(root));
  const cache = noCache ? { v: 0, files: {} } : loadCache(cachePath);
  const files = findFiles(absRoot, adapter.include);
  const nextFiles = {};
  const recs = [];
  let reused = 0;
  let scanned = 0;
  let bad = 0;

  for (const f of files) {
    const rel = f.rel;
    let st;
    try { st = fs.statSync(f.abs); } catch { bad++; continue; }
    const key = fileKey(st);
    const prev = cache.files[rel];
    let r;
    if (!refresh && prev && prev.k === key) {
      r = prev.r;
      reused++;
    } else {
      let text;
      try { text = decodeBuffer(fs.readFileSync(f.abs)); } catch { bad++; continue; }
      if (!text) { bad++; continue; }
      r = adapter.scan(text.split(/\r?\n/), adapter.metaOf(rel));
      scanned++;
    }
    nextFiles[rel] = { k: key, r };
    for (const x of r) recs.push(x);
  }

  const changed = !noCache && (scanned > 0 || Object.keys(nextFiles).length !== Object.keys(cache.files).length);
  if (changed) saveCache(cachePath, { v: 1, built: Date.now(), files: nextFiles });

  return { recs, stats: { root: absRoot, files: files.length, reused, scanned, bad, ms: Date.now() - t0 } };
}
