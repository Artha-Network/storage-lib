// src/hasher.ts
// SHA-256 helpers for @trust-escrow/storage-lib

import { createHash } from 'node:crypto';
import type { ContentLike } from './types.js';

/**
 * Normalize supported payload types to a Node Buffer (UTF-8 for strings).
 */
function toBuffer(data: ContentLike): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  // Buffer is a Uint8Array subclass; returning as-is is fine.
  return data as Buffer;
}

/**
 * Compute SHA-256 and return hex string (lowercase, 64 chars).
 * Intended for integrity checks and audit trails.
 */
export async function sha256Hex(data: ContentLike): Promise<string> {
  const buf = toBuffer(data);
  const hex = createHash('sha256').update(buf).digest('hex');
  return hex;
}

/**
 * Compute SHA-256 and return raw bytes (32 bytes).
 * Useful if a caller needs the digest in binary form.
 */
export async function sha256Bytes(data: ContentLike): Promise<Uint8Array> {
  const buf = toBuffer(data);
  const out = createHash('sha256').update(buf).digest();
  return new Uint8Array(out);
}
