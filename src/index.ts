// src/index.ts
// @trust-escrow/storage-lib – package entry
// Provides StorageLib (dual-pin to Arweave + IPFS), optional PostgreSQL metadata,
// and re-exports useful types/utilities for consumers.

import { sha256Hex } from './hasher.js';
import { ArweaveStore } from './stores/arweaveStore.js';
import { IpfsStore } from './stores/ipfsStore.js';
import { EvidenceRepo } from './postgres/metadata.js';

import type {
  ContentLike,
  DualPinResult,
  PutOptions
} from './types.js';

/**
 * StorageLib
 * - Dual-pins payloads: Arweave (primary) + IPFS (mirror)
 * - Computes SHA-256 for every upload (tamper-evidence)
 * - Optionally records evidence metadata in PostgreSQL (dealId, party, CIDs, contentType, timestamp)
 *
 * Usage:
 *  const lib = new StorageLib(true);
 *  await lib.init();
 *  const res = await lib.dualPin(Buffer.from('hello'), { dealId:'DEAL-1', party:'buyer', contentType:'text/plain' });
 */
export class StorageLib {
  private ar: ArweaveStore;
  private ipfs: IpfsStore;
  private repo?: EvidenceRepo;

  /**
   * @param withPostgres when true, enables PostgreSQL registry (EvidenceRepo)
   */
  constructor(withPostgres = false) {
    this.ar = new ArweaveStore();
    this.ipfs = new IpfsStore();
    this.repo = withPostgres ? new EvidenceRepo() : undefined;
  }

  /**
   * Initialize resources that require setup (e.g., create DB table).
   */
  async init(): Promise<void> {
    if (this.repo) {
      await this.repo.migrate();
    }
  }

  /**
   * Dual-pin content to Arweave (primary) and IPFS (mirror).
   * Computes SHA-256 and enforces optional integrity check.
   *
   * When withPostgres=true and both dealId & party are provided,
   * a row is recorded in evidence_records.
   */
  async dualPin(
    content: ContentLike,
    opts?: PutOptions & {
      dealId?: string;
      party?: 'buyer' | 'seller' | 'system';
    }
  ): Promise<DualPinResult> {
    // Compute integrity hash for auditing (and default strictness if not provided)
    const computedSha = await sha256Hex(content);
    const putOpts: PutOptions = {
      ...opts,
      integrityHash: opts?.integrityHash ?? computedSha,
    };

    // Primary upload (Arweave) + mirror (IPFS)
    const primary = await this.ar.put(content, putOpts);
    const mirror  = await this.ipfs.put(content, putOpts);

    const result: DualPinResult = {
      primary,
      mirror,
      integrity: {
        computedSha256: computedSha,
        matches: (opts?.integrityHash ?? computedSha) === computedSha
      }
    };

    // Persist metadata if configured and sufficient audit info is provided
    if (this.repo && opts?.dealId && opts?.party) {
      await this.repo.add({
        dealId: opts.dealId,
        party: opts.party,
        sha256: computedSha,
        primaryCid: primary.cid,
        mirrorCid: mirror.cid,
        contentType: opts.contentType,
        createdAt: new Date()
      });
    }

    return result;
  }

  // Optional convenience getters for advanced users who want direct access
  // to the underlying stores. These are intentionally read-only.
  get arweave() { return this.ar; }
  get ipfs()    { return this.ipfs; }
}

// ----------------------------
// Re-exports for consumers
// ----------------------------
export { sha256Hex } from './hasher.js';
export { ArweaveStore } from './stores/arweaveStore.js';
export { IpfsStore } from './stores/ipfsStore.js';
export { EvidenceRepo } from './postgres/metadata.js';
export type { ContentLike, PutOptions, DualPinResult } from './types.js';
