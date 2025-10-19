// src/types.ts
// Shared types for @trust-escrow/storage-lib

/**
 * Bytes or text payload accepted by the library.
 * - Prefer Buffer/Uint8Array for binary files (PDF, images, etc.)
 * - String will be UTF-8 encoded internally
 */
export type ContentLike = Buffer | Uint8Array | string;

/**
 * Options accepted by storage adapters and StorageLib.dualPin.
 */
export interface PutOptions {
  /** MIME type of the content, e.g., 'application/pdf', 'text/plain' */
  contentType?: string;

  /** Optional filename hint (may be used by certain endpoints/pinners) */
  filename?: string;

  /** Optional key/value tags for backends that support metadata tagging */
  tags?: Record<string, string>;

  /**
   * Expected SHA-256 (hex). If provided and it does not match the computed hash,
   * the upload MUST throw to prevent tampered or corrupted content.
   */
  integrityHash?: string;
}

/**
 * Canonical reference to stored content on a backend.
 * - For IPFS: `cid` is the CID string.
 * - For Arweave: `cid` is the transaction id.
 * - `url` is a best-effort public gateway URL for reads/HEAD.
 */
export interface StoredRef {
  cid: string;
  backend: 'arweave' | 'ipfs';
  url?: string;
}

/**
 * Result returned by StorageLib.dualPin.
 * - `primary` is Arweave (by default)
 * - `mirror`  is IPFS   (by default)
 * - `integrity` includes the computed SHA-256 and whether it matched the
 *   provided `integrityHash` (if any).
 */
export interface DualPinResult {
  primary: StoredRef;
  mirror: StoredRef;
  integrity: {
    computedSha256: string;
    matches?: boolean;
  };
}

/**
 * Row shape for the optional PostgreSQL audit/metadata table.
 * This is what gets inserted when StorageLib is instantiated with Postgres
 * and both `dealId` and `party` are provided on dualPin().
 */
export interface EvidenceRecord {
  dealId: string;
  party: 'buyer' | 'seller' | 'system';
  sha256: string;
  primaryCid: string;
  mirrorCid: string;
  contentType?: string;
  createdAt?: Date;
}
