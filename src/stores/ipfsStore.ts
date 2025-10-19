// src/stores/ipfsStore.ts
// IPFS implementation of IStore for @trust-escrow/storage-lib

import type { IStore } from './IStore.js';
import type { ContentLike, PutOptions, StoredRef } from '../types.js';
import { sha256Hex } from '../hasher.js';
import { loadConfig } from '../config.js';
import { fetch, File } from 'undici';
// NOTE: undici@6 exposes Fetch API, but not FormData's File in all envs.
// We import File from undici and use global FormData (Node 20+).

function toBuffer(data: ContentLike): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  return data as Buffer;
}

export class IpfsStore implements IStore {
  private endpoint: string;
  private token?: string;
  private publicGateway: string;

  constructor() {
    const cfg = loadConfig();
    if (!cfg.ipfs?.endpoint) {
      throw new Error('IPFS_ENDPOINT is required');
    }
    this.endpoint = cfg.ipfs.endpoint.replace(/\/+$/, ''); // trim trailing '/'
    this.token = cfg.ipfs.token;
    this.publicGateway = (cfg.publicGateway?.ipfs || 'https://ipfs.io/ipfs/').replace(/([^/])$/, '$1/');
  }

  async put(content: ContentLike, opts?: PutOptions): Promise<StoredRef> {
    const data = toBuffer(content);

    // Build multipart form for /api/v0/add
    const form = new FormData();
    const filename = opts?.filename || 'blob';
    const file = new File([data], filename, { type: opts?.contentType || 'application/octet-stream' });
    form.set('file', file);

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = this.token;

    const url = `${this.endpoint}/api/v0/add?pin=true&wrap-with-directory=false`;
    const res = await fetch(url, { method: 'POST', body: form as any, headers });

    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`IPFS add failed: ${res.status} ${res.statusText} ${body ? `- ${body}` : ''}`.trim());
    }

    // The IPFS add endpoint commonly returns newline-delimited JSON; last one contains final Hash
    const text = await res.text();
    const lastLine = text.trim().split('\n').filter(Boolean).pop();
    if (!lastLine) throw new Error('IPFS add: empty response');
    const parsed = JSON.parse(lastLine);
    const cid: string = parsed.Hash || parsed.Cid || parsed.cid;
    if (!cid) throw new Error('IPFS add: missing CID in response');

    // Integrity check (if requested)
    const computed = await sha256Hex(data);
    if (opts?.integrityHash && opts.integrityHash !== computed) {
      throw new Error(`Integrity mismatch (IPFS): expected ${opts.integrityHash}, got ${computed}`);
    }

    return { cid, backend: 'ipfs', url: this.publicGateway + cid } satisfies StoredRef;
  }

  async get(cid: string): Promise<Uint8Array> {
    const res = await fetch(this.publicGateway + cid);
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`IPFS get failed: ${res.status} ${res.statusText} ${body ? `- ${body}` : ''}`.trim());
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf;
  }

  async head(cid: string): Promise<{ contentType?: string; size?: number } | null> {
    const res = await fetch(this.publicGateway + cid, { method: 'HEAD' });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || undefined;
    const sizeH = res.headers.get('content-length');
    const size = sizeH ? Number(sizeH) : undefined;
    return { contentType, size };
  }

  async verify(cid: string, expectedSha256: string): Promise<boolean> {
    try {
      const data = await this.get(cid);
      const got = await sha256Hex(Buffer.from(data));
      return got === expectedSha256;
    } catch {
      // network errors may throw; treat as failure to verify
      return false;
    }
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}
