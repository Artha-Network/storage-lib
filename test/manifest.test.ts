import { describe, it, expect } from "vitest";
import { ManifestBuilder } from "../src/manifest.js";

function makeEntry(cid: string) {
  return {
    cid,
    backend: "dual" as const,
    role: "rationale" as const,
    label: `Evidence ${cid.slice(0, 6)}`,
    sizeBytes: 1024,
    sha256Hex: "a".repeat(64),
  };
}

describe("ManifestBuilder", () => {
  it("builds a manifest with correct structure", () => {
    const m = new ManifestBuilder("deal-001")
      .add(makeEntry("cid-1"))
      .build();

    expect(m.dealId).toBe("deal-001");
    expect(m.version).toBe(1);
    expect(m.entries).toHaveLength(1);
    expect(typeof m.manifestHash).toBe("string");
    expect(m.manifestHash).toHaveLength(64);
  });

  it("deduplicates entries with the same CID", () => {
    const b = new ManifestBuilder("deal-002")
      .add(makeEntry("cid-x"))
      .add(makeEntry("cid-x"));
    expect(b.entryCount).toBe(1);
  });

  it("removes an entry by CID", () => {
    const b = new ManifestBuilder("deal-003")
      .add(makeEntry("cid-a"))
      .add(makeEntry("cid-b"))
      .remove("cid-a");
    expect(b.entryCount).toBe(1);
    expect(b.build().entries[0]?.cid).toBe("cid-b");
  });

  it("filters entries by role", () => {
    const b = new ManifestBuilder("deal-004")
      .add({ ...makeEntry("cid-1"), role: "rationale" })
      .add({ ...makeEntry("cid-2"), role: "attachment" });
    expect(b.byRole("rationale")).toHaveLength(1);
    expect(b.byRole("attachment")).toHaveLength(1);
  });

  it("verifies its own manifest hash", () => {
    const m = new ManifestBuilder("deal-005").add(makeEntry("cid-z")).build();
    expect(ManifestBuilder.verify(m)).toBe(true);
  });

  it("fails verification when entries are tampered", () => {
    const m = new ManifestBuilder("deal-006").add(makeEntry("cid-q")).build();
    m.entries[0]!.sizeBytes = 9999;
    expect(ManifestBuilder.verify(m)).toBe(false);
  });

  it("round-trips through JSON", () => {
    const original = new ManifestBuilder("deal-007").add(makeEntry("cid-r")).build();
    const restored = ManifestBuilder.fromJSON(JSON.stringify(original));
    expect(restored.dealId).toBe("deal-007");
    expect(restored.entries).toHaveLength(1);
  });

  it("round-trips through binary format", () => {
    const b = new ManifestBuilder("deal-008").add(makeEntry("cid-s"));
    const bytes = b.toBinary();
    const restored = ManifestBuilder.fromBinary(bytes);
    expect(restored.dealId).toBe("deal-008");
  });

  it("calculates totalSizeBytes correctly", () => {
    const b = new ManifestBuilder("deal-009")
      .add(makeEntry("cid-1"))
      .add({ ...makeEntry("cid-2"), sizeBytes: 2048 });
    expect(b.totalSizeBytes).toBe(1024 + 2048);
  });

  it("throws on empty dealId", () => {
    expect(() => new ManifestBuilder("  ")).toThrow();
  });
});
