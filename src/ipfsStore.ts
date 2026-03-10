import { Buffer } from "buffer";
import { hashBytes, verifyHash, ContentHash, IntegrityError } from "./hash";

// ── Config ────────────────────────────────────────────────────────────────────

export interface IPFSStoreConfig {
  /** IPFS gateway base URL, e.g. "https://ipfs.io" */
  gatewayUrl: string;
  /** Pinning service API endpoint, e.g. "https://api.pinata.cloud" */
  pinningServiceUrl: string;
  /** Bearer token for the pinning service */
  pinningToken: string;
  /** Timeout in ms. Default: 30_000 */
  timeoutMs?: number;
  /** Whether to verify integrity after every upload. Default: true */
  verifyOnUpload?: boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IPFSUploadResult {
  /** IPFS CID (v1 by default) */
  cid: string;
  /** Public gateway URL */
  url: string;
  /** SHA-256 of the uploaded content */
  contentHash: ContentHash;
  /** Pin job ID returned by the pinning service */
  pinId?: string;
  /** Pin status at time of upload */
  pinStatus: PinStatus;
}

export type PinStatus = "pinned" | "pinning" | "queued" | "failed" | "unknown";

export interface IPFSVerifyResult {
  cid: string;
  ok: boolean;
  reason?: string;
  fetchedHash?: ContentHash;
  pinStatus?: PinStatus;
}

export interface PinJobStatus {
  pinId: string;
  cid: string;
  status: PinStatus;
  created: string;
  delegates: string[];
}

// ── IPFSStore class ───────────────────────────────────────────────────────────

export class IPFSStore {
  private config: Required<IPFSStoreConfig>;

  constructor(config: IPFSStoreConfig) {
    this.config = {
      timeoutMs: 30_000,
      verifyOnUpload: true,
      ...config,
    };
  }

  // ── Upload + Pin ─────────────────────────────────────────────────────────────

  /**
   * Upload `data` to IPFS via the configured pinning service and immediately
   * pin it. Returns the CID plus integrity metadata.
   *
   * Strategy: POST to pinning service's `/pinning/pinFileToIPFS` endpoint
   * (Pinata-compatible API, also used by Web3.Storage and NFT.Storage adapters).
   */
  async put(
    data: Buffer,
    fileName = "evidence",
    contentType = "application/octet-stream"
  ): Promise<IPFSUploadResult> {
    const contentHash = hashBytes(data);

    const formData = new FormData();
    const blob = new Blob([data], { type: contentType });
    formData.append("file", blob, fileName);
    formData.append(
      "pinataMetadata",
      JSON.stringify({
        name: fileName,
        keyvalues: {
          "content-hash": contentHash.hex,
          "hash-algorithm": contentHash.algorithm,
          "upload-ts": Date.now().toString(),
          "app-name": "artha-network",
        },
      })
    );
    formData.append(
      "pinataOptions",
      JSON.stringify({ cidVersion: 1 })
    );

    const res = await this.fetchWithTimeout(
      `${this.config.pinningServiceUrl}/pinning/pinFileToIPFS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.pinningToken}` },
        body: formData,
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new IPFSUploadError(
        `Pinning service upload failed: HTTP ${res.status} — ${body}`,
        res.status
      );
    }

    const json = (await res.json()) as { IpfsHash: string; PinSize: number; Timestamp: string };
    const cid = json.IpfsHash;

    // Optional integrity check: fetch back and re-hash
    if (this.config.verifyOnUpload) {
      const verification = await this.verify(cid, contentHash);
      if (!verification.ok) {
        throw new IPFSIntegrityError(
          `Post-upload verification failed for CID ${cid}: ${verification.reason}`
        );
      }
    }

    return {
      cid,
      url: `${this.config.gatewayUrl}/ipfs/${cid}`,
      contentHash,
      pinStatus: "pinned",
    };
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  /**
   * Retrieve raw bytes by CID.
   * Tries the configured gateway first; does not fall back automatically
   * (callers can retry with a different gateway if needed).
   */
  async get(cid: string): Promise<Buffer> {
    const url = `${this.config.gatewayUrl}/ipfs/${cid}`;
    const res = await this.fetchWithTimeout(url, { method: "GET" });

    if (!res.ok) {
      throw new IPFSFetchError(
        `Failed to fetch CID ${cid} from gateway: HTTP ${res.status}`,
        res.status
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ── Verify ────────────────────────────────────────────────────────────────────

  /**
   * Fetch content by CID and optionally verify against an expected ContentHash.
   * Also queries pin status so callers can detect silently unpinned content.
   */
  async verify(
    cid: string,
    expectedHash?: ContentHash
  ): Promise<IPFSVerifyResult> {
    // Step 1 — check pin status in parallel with fetch
    const [pinStatus, fetchResult] = await Promise.allSettled([
      this.getPinStatus(cid),
      this.get(cid),
    ]);

    const resolvedPinStatus: PinStatus =
      pinStatus.status === "fulfilled" ? pinStatus.value : "unknown";

    if (fetchResult.status === "rejected") {
      return {
        cid,
        ok: false,
        reason: fetchResult.reason instanceof Error
          ? fetchResult.reason.message
          : String(fetchResult.reason),
        pinStatus: resolvedPinStatus,
      };
    }

    const data = fetchResult.value;
    const fetchedHash = hashBytes(data);

    if (expectedHash) {
      try {
        verifyHash(data, expectedHash);
      } catch (e) {
        if (e instanceof IntegrityError) {
          return {
            cid,
            ok: false,
            reason: e.message,
            fetchedHash,
            pinStatus: resolvedPinStatus,
          };
        }
        throw e;
      }
    }

    return { cid, ok: true, fetchedHash, pinStatus: resolvedPinStatus };
  }

  // ── Pin management ────────────────────────────────────────────────────────────

  /** Query the pinning service for the current status of a CID. */
  async getPinStatus(cid: string): Promise<PinStatus> {
    const res = await this.fetchWithTimeout(
      `${this.config.pinningServiceUrl}/pinning/pinJobs?ipfs_pin_hash=${cid}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${this.config.pinningToken}` },
      }
    );

    if (!res.ok) return "unknown";

    const json = (await res.json()) as { rows?: Array<{ status: string }> };
    const row = json.rows?.[0];
    if (!row) return "unknown";

    const statusMap: Record<string, PinStatus> = {
      pinned: "pinned",
      pinning: "pinning",
      queued: "queued",
      failed: "failed",
    };

    return statusMap[row.status] ?? "unknown";
  }

  /** Unpin a CID from the pinning service. */
  async unpin(cid: string): Promise<void> {
    const res = await this.fetchWithTimeout(
      `${this.config.pinningServiceUrl}/pinning/unpin/${cid}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.config.pinningToken}` },
      }
    );

    if (!res.ok && res.status !== 404) {
      throw new IPFSUploadError(
        `Failed to unpin CID ${cid}: HTTP ${res.status}`,
        res.status
      );
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new IPFSTimeoutError(`Request to ${url} timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Error types ───────────────────────────────────────────────────────────────

export class IPFSUploadError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "IPFSUploadError";
  }
}

export class IPFSFetchError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "IPFSFetchError";
  }
}

export class IPFSIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IPFSIntegrityError";
  }
}

export class IPFSTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IPFSTimeoutError";
  }
}

// ── Default singleton (configured from env) ───────────────────────────────────

export function createIPFSStore(overrides?: Partial<IPFSStoreConfig>): IPFSStore {
  const token = process.env.IPFS_PINNING_TOKEN;
  if (!token) {
    throw new Error("IPFS_PINNING_TOKEN env var is required to initialise IPFSStore");
  }

  return new IPFSStore({
    gatewayUrl: process.env.IPFS_GATEWAY_URL ?? "https://ipfs.io",
    pinningServiceUrl: process.env.IPFS_PINNING_SERVICE_URL ?? "https://api.pinata.cloud",
    pinningToken: token,
    timeoutMs: Number(process.env.IPFS_TIMEOUT_MS ?? 30_000),
    verifyOnUpload: process.env.IPFS_VERIFY_ON_UPLOAD !== "false",
    ...overrides,
  });
}

export const ipfsStore = createIPFSStore();
