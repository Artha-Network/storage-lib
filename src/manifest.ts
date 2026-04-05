/**
 * manifest.ts
 * Evidence manifest for a deal — collects all pinned CIDs, their roles,
 * and metadata into a signable, serializable document.
 * Supports both JSON and a simple length-prefixed binary format.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvidenceRole =
  | "rationale"
  | "attachment"
  | "signature"
  | "screenshot"
  | "contract"
  | "other";

export interface EvidenceEntry {
  cid: string;
  backend: "arweave" | "ipfs" | "dual";
  role: EvidenceRole;
  label: string;
  sizeBytes: number;
  sha256Hex: string;
  addedAt: number;
}

export interface DealManifest {
  version: number;
  dealId: string;
  createdAt: number;
  updatedAt: number;
  entries: EvidenceEntry[];
  manifestHash: string;
}

// ─── ManifestBuilder ─────────────────────────────────────────────────────────

export class ManifestBuilder {
  private readonly dealId: string;
  private readonly entries: EvidenceEntry[] = [];
  private readonly createdAt: number;
  static readonly VERSION = 1;

  constructor(dealId: string) {
    if (!dealId.trim()) throw new Error("dealId must be non-empty.");
    this.dealId = dealId;
    this.createdAt = Date.now();
  }

  /**
   * Add an evidence entry to the manifest.
   */
  add(entry: Omit<EvidenceEntry, "addedAt">): this {
    const existing = this.entries.find((e) => e.cid === entry.cid);
    if (existing) {
      Object.assign(existing, entry);
      return this;
    }
    this.entries.push({ ...entry, addedAt: Date.now() });
    return this;
  }

  /**
   * Remove an entry by CID.
   */
  remove(cid: string): this {
    const idx = this.entries.findIndex((e) => e.cid === cid);
    if (idx !== -1) this.entries.splice(idx, 1);
    return this;
  }

  /**
   * Return all entries matching a given role.
   */
  byRole(role: EvidenceRole): EvidenceEntry[] {
    return this.entries.filter((e) => e.role === role);
  }

  /**
   * Build and return the finalized manifest, including a deterministic hash.
   */
  build(): DealManifest {
    const partial = {
      version: ManifestBuilder.VERSION,
      dealId: this.dealId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      entries: this.entries.map((e) => ({ ...e })),
    };
    const manifestHash = hashManifest(partial);
    return { ...partial, manifestHash };
  }

  /**
   * Serialize the manifest to a JSON string.
   */
  toJSON(): string {
    return JSON.stringify(this.build(), null, 2);
  }

  /**
   * Serialize to a compact binary format:
   * [4 bytes: version][8 bytes: createdAt ms][N bytes: UTF-8 JSON]
   */
  toBinary(): Uint8Array {
    const manifest = this.build();
    const json = JSON.stringify(manifest);
    const jsonBytes = new TextEncoder().encode(json);

    const buf = new ArrayBuffer(12 + jsonBytes.byteLength);
    const view = new DataView(buf);
    view.setUint32(0, manifest.version, false);
    view.setBigUint64(4, BigInt(manifest.createdAt), false);
    new Uint8Array(buf, 12).set(jsonBytes);
    return new Uint8Array(buf);
  }

  /**
   * Deserialize a manifest from binary format.
   */
  static fromBinary(bytes: Uint8Array): DealManifest {
    if (bytes.byteLength < 12) {
      throw new Error("Binary manifest too short.");
    }
    const jsonBytes = bytes.slice(12);
    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json) as DealManifest;
  }

  /**
   * Deserialize from JSON string.
   */
  static fromJSON(json: string): DealManifest {
    const parsed = JSON.parse(json) as DealManifest;
    if (typeof parsed.dealId !== "string" || !Array.isArray(parsed.entries)) {
      throw new Error("Invalid manifest JSON structure.");
    }
    return parsed;
  }

  /**
   * Verify the manifest hash matches the content.
   */
  static verify(manifest: DealManifest): boolean {
    const { manifestHash, ...rest } = manifest;
    const expected = hashManifest(rest);
    return expected === manifestHash;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  get totalSizeBytes(): number {
    return this.entries.reduce((acc, e) => acc + e.sizeBytes, 0);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashManifest(partial: Omit<DealManifest, "manifestHash">): string {
  const stable = JSON.stringify({
    version: partial.version,
    dealId: partial.dealId,
    createdAt: partial.createdAt,
    entries: partial.entries
      .slice()
      .sort((a, b) => a.cid.localeCompare(b.cid)),
  });
  return createHash("sha256").update(stable).digest("hex");
}
