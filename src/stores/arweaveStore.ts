// src/stores/arweaveStore.ts
// Arweave implementation of IStore for @trust-escrow/storage-lib
//
// ──────────────────────────────────────────────────────────────────────────────
// PURPOSE
// This adapter provides a minimal, HTTP-based way to persist evidence bytes on
// Arweave and fetch them later via a public gateway. It is designed for the
// "dual-pin" flow where Arweave is PRIMARY (immutability/finality) and IPFS is
// MIRROR (distribution).
//
// IMPORTANT (PRODUCTION):
// • For mainnet-grade durability and predictable UX, teams typically use
//   Bundlr or sign Arweave transactions with a wallet. This adapter assumes an
//   "upload-accepting" endpoint (e.g., Bundlr-compatible or a custom gateway)
//   that returns a transaction id as plain text.
// • If your infra signs transactions server-side, swap the POST logic to call
//   your signing service and/or Bundlr SDK, then return the tx id.
//
// SECURITY & PRIVACY:
// • Do NOT upload plaintext PII/PHI/secrets to public Arweave. Prefer
//   client-side encryption (recipient public key) and upload ciphertext.
// • Enforce size limits at the application layer; add AV scanning hooks prior
//   to upload if your threat model requires it.
// • This adapter supports an optional Authorization header via ARWEAVE_API_KEY.
//   Use HTTPS for all endpoints.
//
// INTEGRITY MODEL:
// • Every upload should have a SHA-256 computed. If the caller provides
//   `integrityHash`, the adapter MUST throw on mismatch. Otherwise, the adapter
//   returns the computed hash to the caller (via StorageLib).
//
// OPERATIONAL NOTES:
// • `put()` expects a raw POST that yields the Arweave tx id as text.
// • `get()`/`head()` read from a public gateway base (defaults to arweave.net/).
// • Handle non-2xx as hard errors and include status text for triage.
// • Retries/backoff are intentionally not built-in; implement at call site,
//   so you can centralize rate-limit and circuit-breaker policy.
//
// CONFIG (see src/config.ts):
// • ARWEAVE_ENDPOINT               – uploader/gateway (no trailing slash required)
// • ARWEAVE_API_KEY (optional)     – Authorization header value if required
// • ARWEAVE_PUBLIC_GATEWAY (read)  – base URL for GET/HEAD (must end with '/')
//
// ──────────────────────────────────────────────────────────────────────────────

import type { IStore } from './IStore.js';
import type { ContentLike, PutOptions, StoredRef } from '../types.js';
import { sha256Hex } from '../hasher.js';
import { loadConfig } from '../config.js';
import { fetch } from 'undici';

function toBuffer(data: ContentLike): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  return data as Buffer;
}

/**
 * ArweaveStore
 *
 * Minimal HTTP adapter that:
 *  - POSTs bytes to ARWEAVE_ENDPOINT and expects a tx id text response.
 *  - Reads via ARWEAVE_PUBLIC_GATEWAY (HEAD/GET).
 */
export class ArweaveStore implements IStore {
  private endpoint: string;
  private apiKey?: string;
  private publicGateway: string;

  constructor() {
    const cfg = loadConfig();

    // Trim trailing slashes for endpoint; ensure gateway ends with a slash.
    this.endpoint = (cfg.arweave?.endpoint || 'https://arweave.net').replace(/\/+$/, '');
    this.apiKey = cfg.arweave?.apiKey;
    this.publicGateway = (cfg.publicGateway?.arweave || 'https://arweave.net/').replace(/([^/])$/, '$1/');
  }

  /**
   * Upload content to Arweave.
   *
   * @param content  Bytes or string (UTF-8). Prefer Buffer/Uint8Array for binaries.
   * @param opts     contentType, filename, tags (unused here), integrityHash.
   * @returns        StoredRef with tx id (as `cid`) and a public gateway URL.
   *
   * BEHAVIOR:
   * - Sends a raw POST with content-type = opts.contentType || application/octet-stream.
   * - If ARWEAVE_API_KEY is set, adds Authorization header.
   * - Expects response body = tx id text (non-empty).
   * - Computes SHA-256 of the uploaded bytes; if opts.integrityHash is provided
   *   and mismatches, throws an Error.
   *
   * ERRORS:
   * - Non-2xx ⇒ Error with HTTP status and a short snippet of response text (if available).
   * - Empty response ⇒ Error("... empty transaction id").
   * - Integrity mismatch ⇒ Error("Integrity mismatch (Arweave): ...").
   */
  async put(content: ContentLike, opts?: PutOptions): Promise<StoredRef> {
    const data = toBuffer(content);

    const headers: Record<string, string> = {
      'content-type': opts?.contentType || 'application/octet-stream',
    };
    if (this.apiKey) headers['Authorization'] = this.apiKey;

    // NOTE: If your infrastructure requires a sub-path (e.g., /tx or /upload),
    // adjust the URL here or make it env-driven.
    const res = await fetch(this.endpoint, { method: 'POST', body: data, headers });

    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(
        `Arweave upload failed: ${res.status} ${res.statusText}${body ? ` - ${clip(body)}` : ''}`
      );
    }

    // Expect the response body to be the Arweave transaction id (string).
    const txId = (await res.text()).trim();
    if (!txId) throw new Error('Arweave upload: empty transaction id');

    // Integrity enforcement (optional strictness)
    const computed = await sha256Hex(data);
    if (opts?.integrityHash && opts.integrityHash !== computed) {
      throw new Error(`Integrity mismatch (Arweave): expected ${opts.integrityHash}, got ${computed}`);
    }

    return { cid: txId, backend: 'arweave', url: this.publicGateway + txId } satisfies StoredRef;
  }

  /**
   * Fetch raw bytes via the public gateway.
   *
   * @param cid  Arweave transaction id.
   * @returns    Uint8Array of the content.
   *
   * ERRORS:
   * - Non-2xx ⇒ Error with HTTP status and short response text (if available).
   */
  async get(cid: string): Promise<Uint8Array> {
    const res = await fetch(this.publicGateway + cid);
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(
        `Arweave get failed: ${res.status} ${res.statusText}${body ? ` - ${clip(body)}` : ''}`
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * HEAD probe for lightweight metadata (content-type, size if advertised).
   *
   * @param cid  Arweave transaction id.
   * @returns    { contentType?: string; size?: number } | null
   *             Returns null on non-2xx (e.g., gateway unavailability or missing object).
   */
  async head(cid: string): Promise<{ contentType?: string; size?: number } | null> {
    const res = await fetch(this.publicGateway + cid, { method: 'HEAD' });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || undefined;
    const len = res.headers.get('content-length');
    const size = len ? Number(len) : undefined;

    return { contentType, size };
  }

  /**
   * End-to-end integrity check by reading bytes back and comparing SHA-256.
   *
   * @param cid             Arweave transaction id.
   * @param expectedSha256  Expected hex digest (lowercase).
   * @returns               true if digest matches; false if mismatch or if a recoverable
   *                        network error occurs (we intentionally do not throw on mismatch).
   */
  async verify(cid: string, expectedSha256: string): Promise<boolean> {
    try {
      const data = await this.get(cid);
      const got = await sha256Hex(Buffer.from(data));
      return got === expectedSha256;
    } catch {
      // Treat transient network/transport errors as a failed verification,
      // but do not throw so callers can decide retry policy.
      return false;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers for safer error messages
// ──────────────────────────────────────────────────────────────────────────────

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

/**
 * Clip long response bodies to keep thrown errors readable.
 * Adjust the limit to your logging budget if needed.
 */
function clip(s: string, max = 240): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
