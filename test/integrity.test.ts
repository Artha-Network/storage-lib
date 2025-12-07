import { describe, it, expect } from "vitest";
import { sha256 } from "../src/hash";
import { arweaveStore } from "../src/arweaveStore";

describe("hash utilities", () => {
  it("produces stable sha256 for same input", () => {
    const a = sha256("hello");
    const b = sha256("hello");
    expect(a).toBe(b);
  });
});

describe("arweaveStore placeholder", () => {
  it("returns deterministic id for same content", async () => {
    const id1 = await arweaveStore.put("hello");
    const id2 = await arweaveStore.put("hello");
    expect(id1).toBe(id2);
  });
});
