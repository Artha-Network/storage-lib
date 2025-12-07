import type { ContentStore, ByteLike, PutOptions } from "./types";
import { sha256 } from "./hash";

export interface ArweaveConfig {
  gatewayUrl: string;
  key?: unknown; // replace with real key type when you integrate SDK
}

/**
 * Very thin placeholder store. Right now it's just hashing locally and
 * pretending the hash is the "id". Real network integration can be
 * swapped in later without changing the public API.
 */
export class ArweaveStore implements ContentStore {
  constructor(private readonly config: ArweaveConfig) {}

  async put(data: ByteLike, _opts?: PutOptions): Promise<string> {
    // TODO: call Arweave gateway with this.config + key.
    // For now: deterministic, testable local id.
    return sha256(data);
  }

  async get(_id: string): Promise<Uint8Array> {
    // TODO: Implement fetch from Arweave gateway.
    throw new Error("ArweaveStore.get is not implemented yet");
  }

  async verify(_id: string): Promise<boolean> {
    // TODO: Implement verification logic once get() works.
    // For now, always false to avoid lying.
    return false;
  }
}

export function createArweaveStore(config: ArweaveConfig): ArweaveStore {
  return new ArweaveStore(config);
}

// Default instance users can override if they want their own.
export const arweaveStore = new ArweaveStore({
  gatewayUrl: "https://arweave.net",
});
