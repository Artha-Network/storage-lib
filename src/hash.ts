import { createHash, createHmac } from "crypto";
import { Buffer } from "buffer";

export type HashAlgorithm = "sha256" | "sha512" | "blake2b512";

export interface ContentHash {
  algorithm: HashAlgorithm;
  hex: string;
  base64: string;
  byteLength: number;
}

export interface HashMismatchError {
  expected: string;
  received: string;
  algorithm: HashAlgorithm;
}

/**
 * Compute a deterministic hash of arbitrary bytes.
 * Defaults to SHA-256 which is what Arweave & IPFS both verify against.
 */
export function hashBytes(
  data: Buffer | Uint8Array,
  algorithm: HashAlgorithm = "sha256"
): ContentHash {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const algo = algorithm === "blake2b512" ? "blake2b512" : algorithm;

  const hex = createHash(algo).update(buf).digest("hex");
  const base64 = createHash(algo).update(buf).digest("base64");

  return {
    algorithm,
    hex,
    base64,
    byteLength: buf.byteLength,
  };
}

/**
 * Hash a plain UTF-8 string.
 */
export function hashString(
  content: string,
  algorithm: HashAlgorithm = "sha256"
): ContentHash {
  return hashBytes(Buffer.from(content, "utf-8"), algorithm);
}

/**
 * Hash a JSON-serialisable object deterministically.
 * Keys are sorted before serialisation to prevent ordering differences.
 */
export function hashObject(
  obj: Record<string, unknown>,
  algorithm: HashAlgorithm = "sha256"
): ContentHash {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return hashString(sorted, algorithm);
}

/**
 * Verify that `data` matches a previously recorded ContentHash.
 * Throws a descriptive error on mismatch — never silently passes.
 */
export function verifyHash(
  data: Buffer | Uint8Array,
  expected: ContentHash
): true {
  const actual = hashBytes(data, expected.algorithm);

  if (actual.hex !== expected.hex) {
    const err: HashMismatchError = {
      expected: expected.hex,
      received: actual.hex,
      algorithm: expected.algorithm,
    };
    throw new IntegrityError(
      `Hash mismatch [${expected.algorithm}]: expected ${err.expected}, got ${err.received}`,
      err
    );
  }
  return true;
}

/**
 * Produce a keyed HMAC tag — useful for signing evidence payloads before upload.
 */
export function hmacSign(
  data: Buffer | Uint8Array,
  secret: string,
  algorithm: "sha256" | "sha512" = "sha256"
): string {
  return createHmac(algorithm, secret)
    .update(Buffer.isBuffer(data) ? data : Buffer.from(data))
    .digest("hex");
}

/**
 * Compare two hex strings in constant time to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Error types ──────────────────────────────────────────────────────────────

export class IntegrityError extends Error {
  public readonly mismatch: HashMismatchError;

  constructor(message: string, mismatch: HashMismatchError) {
    super(message);
    this.name = "IntegrityError";
    this.mismatch = mismatch;
  }
}
