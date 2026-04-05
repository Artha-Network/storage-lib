/**
 * contentAddressable.ts
 * CID normalization, content fingerprinting, dedup registry,
 * and format detection utilities for Arweave TX IDs and IPFS CIDv1.
 */

import { createHash } from "crypto";

// ─── CID Format Detection ────────────────────────────────────────────────────

const IPFS_CIDv0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const IPFS_CIDv1_RE = /^b[a-z2-7]{58,}$/i;
const ARWEAVE_TXID_RE = /^[a-zA-Z0-9_-]{43}$/;

export type CIDKind = "ipfs-v0" | "ipfs-v1" | "arweave" | "unknown";

export function detectCIDKind(cid: string): CIDKind {
  if (IPFS_CIDv0_RE.test(cid)) return "ipfs-v0";
  if (IPFS_CIDv1_RE.test(cid)) return "ipfs-v1";
  if (ARWEAVE_TXID_RE.test(cid)) return "arweave";
  return "unknown";
}

export function isIPFSCID(cid: string): boolean {
  const k = detectCIDKind(cid);
  return k === "ipfs-v0" || k === "ipfs-v1";
}

export function isArweaveTxID(cid: string): boolean {
  return detectCIDKind(cid) === "arweave";
}

// ─── Fingerprinting ──────────────────────────────────────────────────────────

export interface ContentFingerprint {
  sha256Hex: string;
  sizeBytes: number;
  detectedMime: string;
}

const MAGIC_BYTES: Array<{ prefix: number[]; mime: string }> = [
  { prefix: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" },
  { prefix: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { prefix: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { prefix: [0x47, 0x49, 0x46], mime: "image/gif" },
  { prefix: [0x7b], mime: "application/json" },
  { prefix: [0x1f, 0x8b], mime: "application/gzip" },
];

export function detectMimeType(buf: Uint8Array): string {
  for (const { prefix, mime } of MAGIC_BYTES) {
    if (prefix.every((b, i) => buf[i] === b)) return mime;
  }
  const isText = buf.slice(0, 512).every((b) => b >= 0x09 && b <= 0x7e);
  return isText ? "text/plain" : "application/octet-stream";
}

export function fingerprint(content: Uint8Array): ContentFingerprint {
  return {
    sha256Hex: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
    detectedMime: detectMimeType(content),
  };
}

// ─── Dedup Registry ──────────────────────────────────────────────────────────

export interface DedupEntry {
  sha256Hex: string;
  cids: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  sizeBytes: number;
}

/**
 * Maps content SHA-256 → known CIDs.
 * Avoids re-uploading identical content across multiple deals.
 */
export class ContentDedupRegistry {
  private readonly byHash = new Map<string, DedupEntry>();
  private readonly byCID = new Map<string, string>(); // cid → sha256Hex

  /**
   * Register a CID for content identified by its SHA-256.
   */
  register(sha256Hex: string, cid: string, sizeBytes: number): DedupEntry {
    let entry = this.byHash.get(sha256Hex);
    if (!entry) {
      entry = {
        sha256Hex,
        cids: [],
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        sizeBytes,
      };
      this.byHash.set(sha256Hex, entry);
    }
    if (!entry.cids.includes(cid)) {
      entry.cids.push(cid);
    }
    entry.lastSeenAt = Date.now();
    this.byCID.set(cid, sha256Hex);
    return entry;
  }

  /**
   * Look up existing CIDs for a given SHA-256.
   * Returns empty array if content has never been registered.
   */
  lookupByHash(sha256Hex: string): string[] {
    return this.byHash.get(sha256Hex)?.cids ?? [];
  }

  lookupByCID(cid: string): DedupEntry | undefined {
    const hash = this.byCID.get(cid);
    return hash ? this.byHash.get(hash) : undefined;
  }

  hasHash(sha256Hex: string): boolean {
    return this.byHash.has(sha256Hex);
  }

  hasCID(cid: string): boolean {
    return this.byCID.has(cid);
  }

  stats(): { totalHashes: number; totalCIDs: number; totalSizeBytes: number } {
    let totalSizeBytes = 0;
    for (const e of this.byHash.values()) {
      totalSizeBytes += e.sizeBytes;
    }
    return {
      totalHashes: this.byHash.size,
      totalCIDs: this.byCID.size,
      totalSizeBytes,
    };
  }

  all(): DedupEntry[] {
    return Array.from(this.byHash.values());
  }

  clear(): void {
    this.byHash.clear();
    this.byCID.clear();
  }
}
