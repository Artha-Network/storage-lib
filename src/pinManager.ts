/**
 * pinManager.ts
 * Dual-pin orchestrator — attempts to pin content to both Arweave and IPFS.
 * Tracks pin status per CID, supports retry with configurable backoff,
 * and emits a simple event log for observability.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PinBackend = "arweave" | "ipfs";

export type PinStatus = "pending" | "pinned" | "failed" | "unreachable";

export interface PinRecord {
  cid: string;
  backend: PinBackend;
  status: PinStatus;
  attempts: number;
  lastAttemptAt: number | null;
  pinnedAt: number | null;
  errorMessage: string | null;
}

export interface PinResult {
  cid: string;
  arweave: PinRecord;
  ipfs: PinRecord;
  fullyPinned: boolean;
}

export interface PinBackendAdapter {
  name: PinBackend;
  pin(cid: string, content: Uint8Array): Promise<void>;
  verify(cid: string): Promise<boolean>;
}

export interface PinManagerOptions {
  maxAttempts?: number;
  backoffBaseMs?: number;
  requireBothBackends?: boolean;
}

// ─── PinManager ───────────────────────────────────────────────────────────────

export class PinManager {
  private readonly backends: Map<PinBackend, PinBackendAdapter> = new Map();
  private readonly registry: Map<string, PinResult> = new Map();
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly requireBoth: boolean;
  private readonly eventLog: Array<{ ts: number; msg: string }> = [];

  constructor(opts: PinManagerOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.requireBoth = opts.requireBothBackends ?? false;
  }

  registerBackend(adapter: PinBackendAdapter): this {
    this.backends.set(adapter.name, adapter);
    return this;
  }

  /**
   * Pin content to all registered backends.
   * Returns a PinResult with per-backend status.
   */
  async pin(cid: string, content: Uint8Array): Promise<PinResult> {
    const existing = this.registry.get(cid);
    const result: PinResult = existing ?? {
      cid,
      arweave: makePending(cid, "arweave"),
      ipfs: makePending(cid, "ipfs"),
      fullyPinned: false,
    };
    this.registry.set(cid, result);

    const tasks = Array.from(this.backends.values()).map((backend) =>
      this.pinToBackend(backend, cid, content, result)
    );
    await Promise.allSettled(tasks);

    result.fullyPinned = this.requireBoth
      ? result.arweave.status === "pinned" && result.ipfs.status === "pinned"
      : result.arweave.status === "pinned" || result.ipfs.status === "pinned";

    this.log(
      `pin(${cid}) complete — arweave:${result.arweave.status} ipfs:${result.ipfs.status}`
    );
    return result;
  }

  /**
   * Re-attempt failed backends for a previously attempted CID.
   */
  async retry(cid: string, content: Uint8Array): Promise<PinResult | null> {
    const result = this.registry.get(cid);
    if (!result) return null;

    const tasks = Array.from(this.backends.values())
      .filter((b) => {
        const rec = result[b.name];
        return rec.status === "failed" && rec.attempts < this.maxAttempts;
      })
      .map((b) => this.pinToBackend(b, cid, content, result));

    await Promise.allSettled(tasks);

    result.fullyPinned = this.requireBoth
      ? result.arweave.status === "pinned" && result.ipfs.status === "pinned"
      : result.arweave.status === "pinned" || result.ipfs.status === "pinned";

    return result;
  }

  /**
   * Verify a CID is retrievable from all pinned backends.
   */
  async verify(cid: string): Promise<Record<PinBackend, boolean>> {
    const out: Record<PinBackend, boolean> = { arweave: false, ipfs: false };
    for (const [name, adapter] of this.backends) {
      try {
        out[name] = await adapter.verify(cid);
      } catch {
        out[name] = false;
      }
    }
    return out;
  }

  getRecord(cid: string): PinResult | undefined {
    return this.registry.get(cid);
  }

  listAll(): PinResult[] {
    return Array.from(this.registry.values());
  }

  listFailed(): PinResult[] {
    return this.listAll().filter(
      (r) => r.arweave.status === "failed" || r.ipfs.status === "failed"
    );
  }

  getEventLog(): Array<{ ts: number; msg: string }> {
    return [...this.eventLog];
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async pinToBackend(
    backend: PinBackendAdapter,
    cid: string,
    content: Uint8Array,
    result: PinResult
  ): Promise<void> {
    const rec = result[backend.name];
    if (rec.status === "pinned") return;

    let delay = this.backoffBaseMs;
    while (rec.attempts < this.maxAttempts) {
      rec.attempts++;
      rec.lastAttemptAt = Date.now();
      try {
        await backend.pin(cid, content);
        rec.status = "pinned";
        rec.pinnedAt = Date.now();
        rec.errorMessage = null;
        this.log(`${backend.name} pinned ${cid} on attempt ${rec.attempts}`);
        return;
      } catch (err) {
        rec.errorMessage =
          err instanceof Error ? err.message : String(err);
        this.log(
          `${backend.name} failed ${cid} attempt ${rec.attempts}: ${rec.errorMessage}`
        );
        if (rec.attempts < this.maxAttempts) {
          await sleep(delay);
          delay *= 2;
        }
      }
    }
    rec.status = "failed";
  }

  private log(msg: string): void {
    this.eventLog.push({ ts: Date.now(), msg });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePending(cid: string, backend: PinBackend): PinRecord {
  return {
    cid,
    backend,
    status: "pending",
    attempts: 0,
    lastAttemptAt: null,
    pinnedAt: null,
    errorMessage: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
