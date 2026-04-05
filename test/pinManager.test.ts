import { describe, it, expect, vi } from "vitest";
import {
  PinManager,
  type PinBackendAdapter,
} from "../src/pinManager.js";

const mockContent = new Uint8Array([1, 2, 3]);
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

function makeAdapter(
  name: "arweave" | "ipfs",
  fail = false
): PinBackendAdapter {
  return {
    name,
    pin: vi.fn(async () => {
      if (fail) throw new Error(`${name} unavailable`);
    }),
    verify: vi.fn(async () => !fail),
  };
}

describe("PinManager", () => {
  it("pins to both backends successfully", async () => {
    const pm = new PinManager()
      .registerBackend(makeAdapter("arweave"))
      .registerBackend(makeAdapter("ipfs"));

    const result = await pm.pin(CID, mockContent);
    expect(result.arweave.status).toBe("pinned");
    expect(result.ipfs.status).toBe("pinned");
    expect(result.fullyPinned).toBe(true);
  });

  it("marks backend as failed after maxAttempts", async () => {
    const pm = new PinManager({ maxAttempts: 2, backoffBaseMs: 0 })
      .registerBackend(makeAdapter("arweave", true))
      .registerBackend(makeAdapter("ipfs"));

    const result = await pm.pin(CID, mockContent);
    expect(result.arweave.status).toBe("failed");
    expect(result.arweave.attempts).toBe(2);
    expect(result.ipfs.status).toBe("pinned");
  });

  it("fullyPinned is false when requireBoth=true and one backend fails", async () => {
    const pm = new PinManager({
      maxAttempts: 1,
      backoffBaseMs: 0,
      requireBothBackends: true,
    })
      .registerBackend(makeAdapter("arweave", true))
      .registerBackend(makeAdapter("ipfs"));

    const result = await pm.pin(CID, mockContent);
    expect(result.fullyPinned).toBe(false);
  });

  it("verify returns per-backend boolean", async () => {
    const pm = new PinManager()
      .registerBackend(makeAdapter("arweave"))
      .registerBackend(makeAdapter("ipfs", true));

    const v = await pm.verify(CID);
    expect(v.arweave).toBe(true);
    expect(v.ipfs).toBe(false);
  });

  it("retry re-attempts only failed backends", async () => {
    let arweaveFail = true;
    const adapter: PinBackendAdapter = {
      name: "arweave",
      pin: vi.fn(async () => {
        if (arweaveFail) throw new Error("down");
      }),
      verify: vi.fn(async () => true),
    };

    const pm = new PinManager({ maxAttempts: 1, backoffBaseMs: 0 })
      .registerBackend(adapter)
      .registerBackend(makeAdapter("ipfs"));

    await pm.pin(CID, mockContent);
    arweaveFail = false;

    const retried = await pm.retry(CID, mockContent);
    expect(retried?.arweave.status).toBe("pinned");
  });

  it("listFailed returns only records with at least one failed backend", async () => {
    const pm = new PinManager({ maxAttempts: 1, backoffBaseMs: 0 })
      .registerBackend(makeAdapter("arweave", true))
      .registerBackend(makeAdapter("ipfs"));

    await pm.pin(CID, mockContent);
    expect(pm.listFailed()).toHaveLength(1);
  });

  it("emits event log entries", async () => {
    const pm = new PinManager()
      .registerBackend(makeAdapter("arweave"))
      .registerBackend(makeAdapter("ipfs"));

    await pm.pin(CID, mockContent);
    expect(pm.getEventLog().length).toBeGreaterThan(0);
    expect(pm.getEventLog().every((e) => typeof e.ts === "number")).toBe(true);
  });
});
