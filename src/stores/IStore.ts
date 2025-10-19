// src/stores/IStore.ts
// Unified storage adapter interface for @trust-escrow/storage-lib.
// Implementations: IpfsStore, ArweaveStore.

import type { ContentLike, PutOptions, StoredRef } from '../types.js';

/**
 * IStore defines the minimal contract each storage backend must satisfy.
 *
 * Semantics:
 * - put:    uploads bytes; MAY enforce integrity (throw on mismatch).
 * - get:    returns the raw bytes for a given CID/TxID via a readable gateway/API.
 * - head:   lightweight metadata probe; SHOULD NOT download the whole body.
 * - verify: convenience method: downloads and validates SHA-256 equals expected.
 */
export interface IStore {
  /**
   * Upload content.
   * Implementations SHOULD:
   *  - Compute SHA-256 internally and compare to opts.integrityHash if provided, throwing on mismatch.
   *  - Return a canonical identifier (CID for IPFS, TxID for Arweave) and a best-effort public URL.
   */
  put(content: ContentLike, opts?: PutOptions): Promise<StoredRef>;

  /**
   * Fetch raw bytes by identifier (CID/TxID).
   * MUST throw on non-2xx or connectivity errors.
   */
  get(cid: string): Promise<Uint8Array>;

  /**
   * Lightweight metadata probe for an identifier.
   * SHOULD attempt a HEAD request when possible.
   * Return null if metadata cannot be determined but the identifier may still exist.
   */
  head(cid: string): Promise<{ contentType?: string; size?: number } | null>;

  /**
   * End-to-end integrity check:
   * Downloads the object and compares its SHA-256 to the expected hex string.
   * MUST return true on exact match; false otherwise. MUST NOT throw for a simple mismatch.
   * (Network/transport errors may still throw.)
   */
  verify(cid: string, expectedSha256: string): Promise<boolean>;
}
