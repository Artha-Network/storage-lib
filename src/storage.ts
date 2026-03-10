import { describe, it, expect, vi, beforeEach } from "vitest";
import { Buffer } from "buffer";
import {
  hashBytes,
  hashString,
  hashObject,
  verifyHash,
  hmacSign,
  safeCompare,
  IntegrityError,
} from "../src/hash";
import { ArweaveStore } from "../src/arweaveStore";
import { IPFSStore } from "../src/ipfsStore";
import { DualPinService } from "../src/dualPin";

// ─────────────────────────────────────────────────────────────────────────────
// hash.ts tests
// ─────────────────────────────────────────────────────────────────────────────

describe("hash utilities", () => {
  const HELLO = Buffer.from("hello world");

  describe("hashBytes", () => {
    it("returns consistent sha256 hex", () => {
      const result = hashBytes(HELLO);
      expect(result.algorithm).toBe("sha256");
      expect(result.hex).toHaveLength(64);
      expect(result.byteLength).toBe(HELLO.byteLength);
    });

    it("produces the same hash for identical inputs", () => {
      const a = hashBytes(HELLO);
      const b = hashBytes(Buffer.from("hello world"));
      expect(a.hex).toBe(b.hex);
    });

    it("produces different hashes for different inputs", () => {
      const a = hashBytes(Buffer.from("foo"));
      const b = hashBytes(Buffer.from("bar"));
      expect(a.hex).not.toBe(b.hex);
    });

    it("supports sha512", () => {
      const result = hashBytes(HELLO, "sha512");
      expect(result.algorithm).toBe("sha512");
      expect(result.hex).toHaveLength(128);
    });

    it("accepts Uint8Array input", () => {
      const uint = new Uint8Array(Buffer.from("hello world"));
      const result = hashBytes(uint);
      expect(result.hex).toBe(hashBytes(HELLO).hex);
    });
  });

  describe("hashString", () => {
    it("matches hashBytes on UTF-8 encoded string", () => {
      const fromStr = hashString("hello world");
      const fromBuf = hashBytes(Buffer.from("hello world", "utf-8"));
      expect(fromStr.hex).toBe(fromBuf.hex);
    });
  });

  describe("hashObject", () => {
    it("is deterministic regardless of key insertion order", () => {
      const a = hashObject({ z: 1, a: 2 });
      const b = hashObject({ a: 2, z: 1 });
      expect(a.hex).toBe(b.hex);
    });

    it("distinguishes objects with different values", () => {
      const a = hashObject({ key: "value1" });
      const b = hashObject({ key: "value2" });
      expect(a.hex).not.toBe(b.hex);
    });
  });

  describe("verifyHash", () => {
    it("returns true when hash matches", () => {
      const h = hashBytes(HELLO);
      expect(verifyHash(HELLO, h)).toBe(true);
    });

    it("throws IntegrityError when hash does not match", () => {
      const h = hashBytes(HELLO);
      const tampered = Buffer.from("hello WORLD");
      expect(() => verifyHash(tampered, h)).toThrow(IntegrityError);
    });

    it("IntegrityError contains expected and received hex", () => {
      const h = hashBytes(HELLO);
      const tampered = Buffer.from("tampered");
      try {
        verifyHash(tampered, h);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrityError);
        const ie = e as IntegrityError;
        expect(ie.mismatch.expected).toBe(h.hex);
        expect(ie.mismatch.received).toHaveLength(64);
      }
    });
  });

  describe("hmacSign", () => {
    it("returns a hex string", () => {
      const sig = hmacSign(HELLO, "secret");
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("different secrets produce different signatures", () => {
      const a = hmacSign(HELLO, "secret1");
      const b = hmacSign(HELLO, "secret2");
      expect(a).not.toBe(b);
    });
  });

  describe("safeCompare", () => {
    it("returns true for equal strings", () => {
      expect(safeCompare("abc", "abc")).toBe(true);
    });

    it("returns false for different strings of same length", () => {
      expect(safeCompare("abc", "xyz")).toBe(false);
    });

    it("returns false for different length strings", () => {
      expect(safeCompare("ab", "abc")).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ArweaveStore tests (mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe("ArweaveStore", () => {
  const mockWallet = { kty: "RSA", n: "test", e: "AQAB" } as any;
  const testData = Buffer.from("artha escrow evidence");

  function makeStore(dryRun = true) {
    return new ArweaveStore({
      host: "arweave.net",
      port: 443,
      protocol: "https",
      wallet: mockWallet,
      dryRun,
    });
  }

  describe("put (dry run)", () => {
    it("returns a txId and contentHash in dry-run mode", async () => {
      const store = makeStore(true);

      // Arweave client calls need to be mocked at a low level
      // Minimal mock: override createTransaction + sign + getPrice
      const mockTx = {
        id: "mock-tx-id-0000",
        addTag: vi.fn(),
        get: () => [],
      };
      (store as any).client = {
        createTransaction: vi.fn().mockResolvedValue(mockTx),
        transactions: {
          sign: vi.fn().mockResolvedValue(undefined),
          post: vi.fn().mockResolvedValue({ status: 200 }),
          getPrice: vi.fn().mockResolvedValue("100"),
          getStatus: vi.fn().mockResolvedValue({ status: 200 }),
          get: vi.fn().mockResolvedValue({ get: () => [] }),
        },
        ar: {
          winstonToAr: vi.fn().mockReturnValue("0.000001"),
        },
      };

      const result = await store.put(testData, { contentType: "text/plain" });
      expect(result.txId).toBe("mock-tx-id-0000");
      expect(result.contentHash.algorithm).toBe("sha256");
      expect(result.contentHash.hex).toHaveLength(64);
    });
  });

  describe("verify", () => {
    it("returns ok:false when transaction is not found", async () => {
      const store = makeStore();
      (store as any).client = {
        transactions: {
          getStatus: vi.fn().mockResolvedValue({ status: 404 }),
        },
      };

      const result = await store.verify("nonexistent-tx");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/not found/i);
    });

    it("detects hash mismatch after fetch", async () => {
      const store = makeStore();
      const expected = hashBytes(Buffer.from("original content"));

      // Simulate fetch returning tampered data
      vi.spyOn(store, "get").mockResolvedValue(Buffer.from("tampered content"));

      const result = await store.verify("some-tx-id", expected);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/hash mismatch/i);
    });

    it("returns ok:true when hash matches fetched content", async () => {
      const store = makeStore();
      const content = Buffer.from("real evidence payload");
      const expected = hashBytes(content);

      vi.spyOn(store, "get").mockResolvedValue(content);

      const result = await store.verify("some-tx-id", expected);
      expect(result.ok).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPFSStore tests (mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe("IPFSStore", () => {
  const token = "test-pinning-token";

  function makeStore(verifyOnUpload = false) {
    return new IPFSStore({
      gatewayUrl: "https://ipfs.io",
      pinningServiceUrl: "https://api.pinata.cloud",
      pinningToken: token,
      verifyOnUpload,
    });
  }

  describe("put", () => {
    it("calls pinning service and returns CID", async () => {
      const store = makeStore(false);
      const mockCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ IpfsHash: mockCid, PinSize: 100, Timestamp: new Date().toISOString() }),
      } as any);

      const result = await store.put(Buffer.from("test"), "test.txt", "text/plain");
      expect(result.cid).toBe(mockCid);
      expect(result.url).toContain(mockCid);
      expect(result.contentHash.hex).toHaveLength(64);
    });

    it("throws IPFSUploadError on non-200 response", async () => {
      const store = makeStore(false);
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      } as any);

      await expect(store.put(Buffer.from("test"))).rejects.toThrow("401");
    });
  });

  describe("verify", () => {
    it("returns ok:true when fetched content matches expected hash", async () => {
      const store = makeStore(false);
      const content = Buffer.from("evidence payload");
      const expected = hashBytes(content);
      const cid = "bafytest";

      vi.spyOn(store, "get").mockResolvedValue(content);
      vi.spyOn(store, "getPinStatus").mockResolvedValue("pinned");

      const result = await store.verify(cid, expected);
      expect(result.ok).toBe(true);
      expect(result.pinStatus).toBe("pinned");
    });

    it("returns ok:false with reason when fetch fails", async () => {
      const store = makeStore(false);
      vi.spyOn(store, "get").mockRejectedValue(new Error("gateway timeout"));
      vi.spyOn(store, "getPinStatus").mockResolvedValue("pinned");

      const result = await store.verify("bafyfailcid");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/gateway timeout/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DualPinService tests
// ─────────────────────────────────────────────────────────────────────────────

describe("DualPinService", () => {
  const testData = Buffer.from("escrow dispute evidence");

  function makeMockIPFS(): IPFSStore {
    return {
      put: vi.fn().mockResolvedValue({
        cid: "bafymockcid",
        url: "https://ipfs.io/ipfs/bafymockcid",
        contentHash: hashBytes(testData),
        pinStatus: "pinned",
      }),
      verify: vi.fn().mockResolvedValue({ cid: "bafymockcid", ok: true }),
      get: vi.fn(),
      getPinStatus: vi.fn().mockResolvedValue("pinned"),
      unpin: vi.fn(),
    } as unknown as IPFSStore;
  }

  function makeMockArweave(): ArweaveStore {
    return {
      put: vi.fn().mockResolvedValue({
        txId: "mock-arweave-txid",
        url: "https://arweave.net/mock-arweave-txid",
        contentHash: hashBytes(testData),
        estimatedCost: "0.000001",
      }),
      verify: vi.fn().mockResolvedValue({ txId: "mock-arweave-txid", ok: true }),
      get: vi.fn(),
      getTags: vi.fn(),
      estimateCost: vi.fn(),
    } as unknown as ArweaveStore;
  }

  it("pins to both stores and returns DualPinResult", async () => {
    const service = new DualPinService(makeMockIPFS(), makeMockArweave());
    const result = await service.pin(testData);

    expect(result.cid).toBe("bafymockcid");
    expect(result.txId).toBe("mock-arweave-txid");
    expect(result.urls.ipfs).toContain("bafymockcid");
    expect(result.urls.arweave).toContain("mock-arweave-txid");
    expect(result.contentHash.hex).toHaveLength(64);
  });

  it("throws in strict mode when IPFS fails", async () => {
    const ipfs = makeMockIPFS();
    (ipfs.put as any) = vi.fn().mockRejectedValue(new Error("IPFS down"));
    const service = new DualPinService(ipfs, makeMockArweave());

    await expect(service.pin(testData, { failureMode: "strict" })).rejects.toThrow("IPFS down");
  });

  it("returns partial result in partial mode when Arweave fails", async () => {
    const arweave = makeMockArweave();
    (arweave.put as any) = vi.fn().mockRejectedValue(new Error("Arweave timeout"));
    const service = new DualPinService(makeMockIPFS(), arweave);

    const result = (await service.pin(testData, { failureMode: "partial" })) as any;
    expect(result.cid).toBe("bafymockcid");
    expect(result.txId).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].store).toBe("arweave");
  });

  it("verifyBoth reports per-store ok status", async () => {
    const ipfs = makeMockIPFS();
    const arweave = makeMockArweave();
    (arweave.verify as any) = vi.fn().mockResolvedValue({
      txId: "mock-arweave-txid",
      ok: false,
      reason: "hash mismatch",
    });

    const service = new DualPinService(ipfs, arweave);
    const result = await service.verifyBoth("bafymockcid", "mock-arweave-txid");

    expect(result.ipfsOk).toBe(true);
    expect(result.arweaveOk).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatch(/Arweave/);
  });
});
