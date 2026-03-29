/**
 * Shared type definitions for @trust-escrow/storage-lib
 *
 * These types are the canonical interfaces consumed by services that
 * interact with Arweave, IPFS, or the dual-pin layer.
 */

// ── Hash Types ──────────────────────────────────────────────────────────

export type HashAlgorithm = "sha256" | "sha512" | "blake2b512";

export interface HashResult {
  /** Hex-encoded digest */
  hex: string;
  /** Base64-encoded digest */
  base64: string;
  /** Algorithm used */
  algorithm: HashAlgorithm;
  /** Raw byte length of the input */
  byteLength: number;
}

export interface IntegrityProof {
  contentHash: string;
  algorithm: HashAlgorithm;
  timestamp: number;
}

// ── Storage Result Types ────────────────────────────────────────────────

export interface ArweaveUploadResult {
  /** Arweave transaction ID */
  txId: string;
  /** Full gateway URL */
  url: string;
  /** SHA-256 hash of uploaded content */
  contentHash: string;
  /** Estimated cost in Winston */
  costWinston?: string;
}

export interface IPFSUploadResult {
  /** Content identifier (CIDv1 preferred) */
  cid: string;
  /** Full gateway URL */
  url: string;
  /** SHA-256 hash of uploaded content */
  contentHash: string;
  /** Pin status from the pinning service */
  pinStatus?: PinStatus;
}

export type PinStatus = "pinned" | "pinning" | "queued" | "failed" | "unknown";

export interface DualPinResult {
  /** Arweave result (undefined if Arweave upload failed in partial mode) */
  arweave?: ArweaveUploadResult;
  /** IPFS result (undefined if IPFS upload failed in partial mode) */
  ipfs?: IPFSUploadResult;
  /** Shared content hash (should match across both stores) */
  contentHash: string;
  /** Errors encountered during partial uploads */
  errors: StorageError[];
}

// ── Verification Types ──────────────────────────────────────────────────

export interface VerifyResult {
  /** Whether the content matches the expected hash */
  valid: boolean;
  /** Store that was verified */
  store: "arweave" | "ipfs";
  /** Expected hash */
  expectedHash: string;
  /** Actual hash of fetched content */
  actualHash?: string;
  /** Error message if verification failed */
  error?: string;
}

export interface DualVerifyResult {
  arweave: VerifyResult;
  ipfs: VerifyResult;
  /** True only if both stores verify successfully */
  bothValid: boolean;
}

// ── Error Types ─────────────────────────────────────────────────────────

export type StorageErrorCode =
  | "UPLOAD_FAILED"
  | "FETCH_FAILED"
  | "INTEGRITY_MISMATCH"
  | "TIMEOUT"
  | "AUTH_FAILED"
  | "NOT_FOUND";

export interface StorageError {
  code: StorageErrorCode;
  store: "arweave" | "ipfs";
  message: string;
  cause?: unknown;
}

// ── Evidence Types ──────────────────────────────────────────────────────

export type EvidenceKind =
  | "text"
  | "image"
  | "document"
  | "video"
  | "chat_log"
  | "transaction"
  | "other";

export interface EvidenceMetadata {
  dealId: string;
  submittedBy: string;
  kind: EvidenceKind;
  description?: string;
  mimeType?: string;
  sizeBytes: number;
  timestamp: number;
}

export interface StoredEvidence {
  /** Primary storage identifier (Arweave txId or IPFS CID) */
  storageId: string;
  /** Which store holds the primary copy */
  primaryStore: "arweave" | "ipfs";
  /** Content hash for integrity verification */
  contentHash: string;
  /** Evidence metadata */
  metadata: EvidenceMetadata;
  /** Backup location (if dual-pinned) */
  backupId?: string;
  backupStore?: "arweave" | "ipfs";
}

// ── Configuration Types ─────────────────────────────────────────────────

export type FailureMode = "strict" | "partial";

export interface DualPinConfig {
  /** How to handle single-store failures */
  failureMode: FailureMode;
  /** Whether to verify content after upload */
  verifyOnUpload: boolean;
  /** Timeout per store operation in ms */
  timeoutMs: number;
}
