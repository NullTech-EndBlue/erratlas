import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CACHE_VERSION = 1;

export function defaultCachePath() {
  return path.join(os.homedir(), '.erratlas', 'cache.json');
}

export function loadCache(cachePath) {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.v === CACHE_VERSION && j.files && typeof j.files === 'object') return j;
  } catch {
    // missing or corrupt cache is not an error
  }
  return { v: CACHE_VERSION, files: {} };
}

export function saveCache(cachePath, cache) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function fileKey(st) {
  return String(Math.round(st.mtimeMs)) + '|' + String(st.size);
}
