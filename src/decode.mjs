import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Decode a log file buffer to text.
 * Handles zstd multi-frame logs (as written by append-only session stores) and plain text.
 */
export function decodeBuffer(buf) {
  if (!buf || !buf.length) return '';
  if (!buf.includes(ZSTD_MAGIC.slice(0, 4)) && buf.subarray(0, 4).compare(ZSTD_MAGIC) !== 0) {
    return buf.toString('utf8');
  }
  const parts = [];
  let i = 0;
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) {
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(i)));
    } catch {
      // trailing partial frame while a session is still being written
    }
    i += 4;
  }
  if (!parts.length) return buf.toString('utf8');
  return Buffer.concat(parts).toString('utf8');
}

export function isZstd(buf) {
  return !!buf && buf.length >= 4 && buf.subarray(0, 4).compare(ZSTD_MAGIC) === 0;
}
