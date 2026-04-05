/**
 * encryption.ts
 * AES-256-GCM envelope encryption for evidence content before upload.
 * Keys are derived from a passphrase using PBKDF2-SHA256.
 *
 * Envelope layout (all big-endian):
 *   [1 byte: version]
 *   [16 bytes: salt]
 *   [12 bytes: IV]
 *   [4 bytes: iterations]
 *   [4 bytes: ciphertext length]
 *   [16 bytes: GCM auth tag]
 *   [N bytes: ciphertext]
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const ENVELOPE_VERSION = 0x01;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_SIZE = 1 + SALT_BYTES + IV_BYTES + 4 + 4 + TAG_BYTES; // 53 bytes

// ─── Key Derivation ───────────────────────────────────────────────────────────

export interface DerivedKey {
  key: Buffer;
  salt: Buffer;
  iterations: number;
}

export function deriveKey(
  passphrase: string,
  salt?: Buffer,
  iterations = 100_000
): DerivedKey {
  const s = salt ?? randomBytes(SALT_BYTES);
  const key = pbkdf2Sync(passphrase, s, iterations, KEY_BYTES, "sha256");
  return { key, salt: s, iterations };
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

export interface EncryptOptions {
  passphrase?: string;
  derivedKey?: DerivedKey;
  /** PBKDF2 iterations. Default: 100_000. */
  iterations?: number;
}

export interface EncryptResult {
  envelope: Uint8Array;
  salt: string;   // hex
  iv: string;     // hex
  tag: string;    // hex
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Must provide either passphrase or derivedKey.
 */
export function encrypt(
  plaintext: Uint8Array,
  opts: EncryptOptions
): EncryptResult {
  if (!opts.passphrase && !opts.derivedKey) {
    throw new Error("Must provide passphrase or derivedKey.");
  }

  const dk =
    opts.derivedKey ??
    deriveKey(opts.passphrase!, undefined, opts.iterations ?? 100_000);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dk.key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope = new Uint8Array(HEADER_SIZE + ciphertext.byteLength);
  const view = new DataView(envelope.buffer);
  let offset = 0;

  // version
  view.setUint8(offset, ENVELOPE_VERSION); offset += 1;
  // salt
  envelope.set(dk.salt, offset); offset += SALT_BYTES;
  // IV
  envelope.set(iv, offset); offset += IV_BYTES;
  // iterations
  view.setUint32(offset, dk.iterations, false); offset += 4;
  // ciphertext length
  view.setUint32(offset, ciphertext.byteLength, false); offset += 4;
  // auth tag
  envelope.set(tag, offset); offset += TAG_BYTES;
  // ciphertext
  envelope.set(ciphertext, offset);

  return {
    envelope,
    salt: Buffer.from(dk.salt).toString("hex"),
    iv: Buffer.from(iv).toString("hex"),
    tag: Buffer.from(tag).toString("hex"),
  };
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypt an envelope produced by encrypt().
 * Must provide the same passphrase used during encryption.
 */
export function decrypt(
  envelope: Uint8Array,
  passphrase: string
): Uint8Array {
  if (envelope.byteLength < HEADER_SIZE) {
    throw new Error("Envelope too short — likely corrupted.");
  }

  const view = new DataView(envelope.buffer, envelope.byteOffset);
  let offset = 0;

  const version = view.getUint8(offset); offset += 1;
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: 0x${version.toString(16)}`);
  }

  const salt = envelope.slice(offset, offset + SALT_BYTES); offset += SALT_BYTES;
  const iv = envelope.slice(offset, offset + IV_BYTES); offset += IV_BYTES;
  const iterations = view.getUint32(offset, false); offset += 4;
  const ciphertextLength = view.getUint32(offset, false); offset += 4;
  const tag = envelope.slice(offset, offset + TAG_BYTES); offset += TAG_BYTES;
  const ciphertext = envelope.slice(offset, offset + ciphertextLength);

  if (ciphertext.byteLength !== ciphertextLength) {
    throw new Error("Ciphertext length mismatch — envelope is truncated.");
  }

  const { key } = deriveKey(passphrase, Buffer.from(salt), iterations);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(tag));

  try {
    return new Uint8Array(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext)),
        decipher.final(),
      ])
    );
  } catch {
    throw new Error(
      "Decryption failed — wrong passphrase or corrupted envelope."
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Round-trip helper: encrypt then immediately decrypt.
 * Used in tests to verify the implementation.
 */
export function roundTrip(
  plaintext: Uint8Array,
  passphrase: string
): { ok: boolean; match: boolean } {
  try {
    const { envelope } = encrypt(plaintext, { passphrase });
    const decrypted = decrypt(envelope, passphrase);
    const match =
      plaintext.length === decrypted.length &&
      plaintext.every((b, i) => b === decrypted[i]);
    return { ok: true, match };
  } catch {
    return { ok: false, match: false };
  }
}
