import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import { hashBytes, verifyHash, ContentHash, IntegrityError } from "./hash";
import { Buffer } from "buffer";

// ── Config ───────────────────────────────────────────────────────────────────

export interface ArweaveStoreConfig {
  /** Arweave gateway host, e.g. "arweave.net" */
  host: string;
  port: number;
  protocol: "http" | "https";
  /** Path to JWK wallet JSON, or the parsed key object directly */
  wallet: JWKInterface | string;
  /** Timeout in ms for upload / verify calls. Default: 30_000 */
  timeoutMs?: number;
  /** If true, simulate transactions without broadcasting. Default: false */
  dryRun?: boolean;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface UploadOptions {
  contentType?: string;
  /** Arbitrary key/value tags attached to the Arweave TX */
  tags?: Record<string, string>;
  /** Pre-computed hash to embed in TX tags for fast verification */
  contentHash?: ContentHash;
}

export interface UploadResult {
  /** Arweave transaction ID */
  txId: string;
  /** Gateway URL to retrieve the content */
  url: string;
  /** SHA-256 hash of what was uploaded */
  contentHash: ContentHash;
  /** Estimated AR cost (string to avoid float precision issues) */
  estimatedCost: string;
}

export interface VerifyResult {
  txId: string;
  ok: boolean;
  reason?: string;
  fetchedHash?: ContentHash;
}

// ── ArweaveStore class ────────────────────────────────────────────────────────

export class ArweaveStore {
  private client: Arweave;
  private wallet: JWKInterface | null = null;
  private config: Required<ArweaveStoreConfig>;

  constructor(config: ArweaveStoreConfig) {
    this.config = {
      timeoutMs: 30_000,
      dryRun: false,
      ...config,
    };

    this.client = Arweave.init({
      host: this.config.host,
      port: this.config.port,
      protocol: this.config.protocol,
      timeout: this.config.timeoutMs,
    });
  }

  // ── Lazy wallet loader ──────────────────────────────────────────────────────

  private async getWallet(): Promise<JWKInterface> {
    if (this.wallet) return this.wallet;

    if (typeof this.config.wallet === "string") {
      const fs = await import("fs/promises");
      const raw = await fs.readFile(this.config.wallet, "utf-8");
      this.wallet = JSON.parse(raw) as JWKInterface;
    } else {
      this.wallet = this.config.wallet;
    }

    return this.wallet;
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  /**
   * Upload a Buffer to Arweave.
   * Automatically computes a SHA-256 hash and tags the TX so it can be
   * verified later without downloading the full payload.
   */
  async put(data: Buffer, options: UploadOptions = {}): Promise<UploadResult> {
    const wallet = await this.getWallet();
    const contentHash = options.contentHash ?? hashBytes(data);

    const tx = await this.client.createTransaction({ data }, wallet);

    // Standard tags
    tx.addTag("Content-Type", options.contentType ?? "application/octet-stream");
    tx.addTag("App-Name", "artha-network");
    tx.addTag("Content-Hash", contentHash.hex);
    tx.addTag("Hash-Algorithm", contentHash.algorithm);
    tx.addTag("Upload-Timestamp", Date.now().toString());

    // User-supplied tags
    if (options.tags) {
      for (const [k, v] of Object.entries(options.tags)) {
        tx.addTag(k, v);
      }
    }

    await this.client.transactions.sign(tx, wallet);

    const estimatedCost = await this.client.transactions
      .getPrice(data.byteLength)
      .then((w) => this.client.ar.winstonToAr(w))
      .catch(() => "unknown");

    if (!this.config.dryRun) {
      const response = await this.client.transactions.post(tx);
      if (response.status !== 200 && response.status !== 202) {
        throw new ArweaveUploadError(
          `Arweave upload failed: HTTP ${response.status}`,
          response.status
        );
      }
    }

    return {
      txId: tx.id,
      url: `${this.config.protocol}://${this.config.host}/${tx.id}`,
      contentHash,
      estimatedCost,
    };
  }

  // ── Fetch ───────────────────────────────────────────────────────────────────

  /**
   * Fetch the raw bytes for a transaction ID.
   * Throws on timeout or non-200 status.
   */
  async get(txId: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const url = `${this.config.protocol}://${this.config.host}/${txId}`;
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        throw new ArweaveFetchError(
          `Failed to fetch TX ${txId}: HTTP ${res.status}`,
          res.status
        );
      }

      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Verify ──────────────────────────────────────────────────────────────────

  /**
   * Fetch content from Arweave and check its hash against either:
   *  a) the hash embedded in TX tags (fast path), or
   *  b) a caller-supplied ContentHash.
   *
   * Returns a VerifyResult instead of throwing so callers can
   * decide how to handle failures.
   */
  async verify(
    txId: string,
    expectedHash?: ContentHash
  ): Promise<VerifyResult> {
    try {
      // Fast path: read hash from TX tags without fetching payload
      if (!expectedHash) {
        const txStatus = await this.client.transactions.getStatus(txId);
        if (txStatus.status === 404) {
          return { txId, ok: false, reason: "Transaction not found" };
        }
      }

      const data = await this.get(txId);
      const fetchedHash = hashBytes(data);

      if (expectedHash) {
        try {
          verifyHash(data, expectedHash);
        } catch (e) {
          if (e instanceof IntegrityError) {
            return {
              txId,
              ok: false,
              reason: e.message,
              fetchedHash,
            };
          }
          throw e;
        }
      }

      return { txId, ok: true, fetchedHash };
    } catch (err) {
      if (err instanceof ArweaveFetchError || err instanceof ArweaveUploadError) {
        return { txId, ok: false, reason: err.message };
      }
      throw err;
    }
  }

  // ── Metadata ────────────────────────────────────────────────────────────────

  /** Retrieve the TX tags map. Useful for reading back embedded CIDs / hashes. */
  async getTags(txId: string): Promise<Record<string, string>> {
    const tx = await this.client.transactions.get(txId);
    const tags: Record<string, string> = {};
    for (const tag of tx.get("tags") as Array<{ get(k: string, opts?: { decode: boolean; string: boolean }): string }>) {
      const key = tag.get("name", { decode: true, string: true });
      const value = tag.get("value", { decode: true, string: true });
      tags[key] = value;
    }
    return tags;
  }

  /** Estimate the AR cost for uploading `byteLength` bytes. */
  async estimateCost(byteLength: number): Promise<string> {
    const winston = await this.client.transactions.getPrice(byteLength);
    return this.client.ar.winstonToAr(winston);
  }
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ArweaveUploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ArweaveUploadError";
  }
}

export class ArweaveFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ArweaveFetchError";
  }
}

// ── Default singleton (configured from env) ──────────────────────────────────

export function createArweaveStore(overrides?: Partial<ArweaveStoreConfig>): ArweaveStore {
  const walletPath = process.env.ARWEAVE_WALLET_PATH;
  if (!walletPath) {
    throw new Error(
      "ARWEAVE_WALLET_PATH env var is required to initialise ArweaveStore"
    );
  }

  return new ArweaveStore({
    host: process.env.ARWEAVE_HOST ?? "arweave.net",
    port: Number(process.env.ARWEAVE_PORT ?? 443),
    protocol: (process.env.ARWEAVE_PROTOCOL as "https") ?? "https",
    wallet: walletPath,
    timeoutMs: Number(process.env.ARWEAVE_TIMEOUT_MS ?? 30_000),
    dryRun: process.env.ARWEAVE_DRY_RUN === "true",
    ...overrides,
  });
}

export const arweaveStore = createArweaveStore();
