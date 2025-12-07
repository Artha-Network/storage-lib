import type { ContentStore, ByteLike, PutOptions } from "./types";
import { sha256 } from "./hash";

export interface IpfsConfig {
  gatewayUrl: string;
  pinningToken?: string;
}

/**
 * Placeholder IPFS store. Swappable with real IPFS client later.
 */
export class IpfsStore implements ContentStore {
  constructor(private readonly config: IpfsConfig) {}

  async put(data: ByteLike, _opts?: PutOptions): Promise<string> {
    // TODO: call IPFS HTTP API or pinning service.
    // For now, treat SHA-256 as a fake CID.
    return sha256(data);
  }

  async get(_cid: string): Promise<Uint8Array> {
    // TODO: Implement fetch from IPFS gateway.
    throw new Error("IpfsStore.get is not implemented yet");
  }

  async verify(_cid: string): Promise<boolean> {
    // TODO: Download and re-hash for integrity check.
    return false;
  }
}

export function createIpfsStore(config: IpfsConfig): IpfsStore {
  return new IpfsStore(config);
}

export const ipfsStore = new IpfsStore({
  gatewayUrl: "https://ipfs.io/ipfs/",
});
