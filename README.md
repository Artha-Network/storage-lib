# @trust-escrow/storage-lib

Type-safe wrapper over **Arweave** and **IPFS** for **evidence storage** in decentralized escrow (Artha Network).

- **Dual-pin**: Arweave (immutability) + IPFS (distribution)
- **SHA-256 integrity** (computed on every upload; optional strict check)
- Optional **PostgreSQL** registry for audits/disputes (dealId, party, CIDs, contentType, timestamps)
- ESM, Node 20+, TypeScript

---

## Table of contents
- [Features](#features)
- [Architecture](#architecture)
- [Install](#install)
- [Requirements](#requirements)
- [Environment](#environment)
- [Quick start](#quick-start)
- [Usage examples](#usage-examples)
  - [A) Dual-pin a text payload](#a-dual-pin-a-text-payload)
  - [B) Dual-pin a file from disk](#b-dual-pin-a-file-from-disk)
  - [C) Strict integrity check with expected hash](#c-strict-integrity-check-with-expected-hash)
- [API Reference](#api-reference)
- [Errors](#errors)
- [Local development](#local-development)
- [Testing](#testing)
- [Security & privacy](#security--privacy)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [License](#license)
- [Maintainers](#maintainers)

---

## Features
- **Dual-pin once → two refs** (Arweave TX id + IPFS CID)
- **Integrity-by-default**: SHA-256 of every upload (optionally enforce with `integrityHash`)
- **Portable design**: storage adapters behind a clean interface
- **Auditable**: optional PostgreSQL table capturing evidence metadata

---

## Architecture

```
App ─▶ StorageLib.dualPin(content, opts)
      ├─▶ ArweaveStore.put(...)  → txId (primary)
      └─▶ IpfsStore.put(...)     → cid  (mirror)
           └─▶ sha256(content)

(when enabled)
PostgreSQL ◀─ EvidenceRepo.add(dealId, party, sha256, primaryCid, mirrorCid, contentType, createdAt)
```

---

## Install

```bash
pnpm add @trust-escrow/storage-lib
# or
npm i @trust-escrow/storage-lib
```

---

## Requirements
- **Node.js 20+**
- **Arweave** upload endpoint (e.g., Bundlr or a gateway that accepts uploads)
- **IPFS** API/pinning endpoint (Infura, web3.storage, Pinata, etc.)
- *(Optional)* **PostgreSQL** 13+ (or managed instance)

---

## Environment

```dotenv
# Storage backends
ARWEAVE_ENDPOINT=https://arweave.net           # or a Bundlr-like uploader
ARWEAVE_API_KEY=                               # optional if your endpoint requires auth

IPFS_ENDPOINT=https://ipfs.infura.io:5001      # base; library appends /api/v0 internally
IPFS_TOKEN=Bearer <your_ipfs_token>

# Public gateways used for GET/HEAD
IPFS_PUBLIC_GATEWAY=https://ipfs.io/ipfs/
ARWEAVE_PUBLIC_GATEWAY=https://arweave.net/

# PostgreSQL (optional but recommended for audits)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

> **Note:** For Arweave mainnet, teams typically use **Bundlr** or signed transactions. This lib assumes an upload-accepting endpoint; swap via env without code changes.

---

## Quick start

```ts
import { StorageLib } from '@trust-escrow/storage-lib';

const storage = new StorageLib(true); // true = enable PostgreSQL registry
await storage.init();                  // creates evidence table if needed

const payload = Buffer.from('hello artha');
const res = await storage.dualPin(payload, {
  dealId: 'DEAL-001',
  party: 'buyer',                      // 'buyer' | 'seller' | 'system'
  contentType: 'text/plain'
});

console.log('Primary (Arweave):', res.primary.url); // e.g., https://arweave.net/<txId>
console.log('Mirror  (IPFS)   :', res.mirror.url);  // e.g., https://ipfs.io/ipfs/<cid>
console.log('SHA-256          :', res.integrity.computedSha256);
```

---

## Usage examples

### A) Dual-pin a text payload
```ts
import { StorageLib } from '@trust-escrow/storage-lib';

const lib = new StorageLib(true);
await lib.init();

const out = await lib.dualPin(Buffer.from('escrow invoice #123'), {
  dealId: 'DEAL-123',
  party: 'seller',
  contentType: 'text/plain'
});

console.log(out.primary.cid, out.mirror.cid);
```

### B) Dual-pin a file from disk
```ts
import { readFile } from 'node:fs/promises';
import { StorageLib } from '@trust-escrow/storage-lib';

const lib = new StorageLib(true);
await lib.init();

const pdf = await readFile('./evidence/invoice.pdf');
const out = await lib.dualPin(pdf, {
  dealId: 'DEAL-777',
  party: 'buyer',
  contentType: 'application/pdf',
  filename: 'invoice.pdf'
});

console.log(out.primary.url); // Arweave
console.log(out.mirror.url);  // IPFS
```

### C) Strict integrity check with expected hash
```ts
import { StorageLib } from '@trust-escrow/storage-lib';
import { createHash } from 'node:crypto';

const lib = new StorageLib(false);

const file = Buffer.from('immutable content');
const expected = createHash('sha256').update(file).digest('hex');

// If computed hash differs from 'expected', the call will throw.
const out = await lib.dualPin(file, {
  contentType: 'text/plain',
  integrityHash: expected
});

console.log(out.integrity.computedSha256 === expected); // true
```

---

## API Reference

### `StorageLib`

```ts
new StorageLib(withPostgres?: boolean)

await storage.init()

await storage.dualPin(
  content: Buffer | Uint8Array | string,
  opts?: {
    // Storage meta
    contentType?: string;
    filename?: string;
    tags?: Record<string, string>;
    integrityHash?: string; // if provided, throws on mismatch

    // Audit meta (PostgreSQL)
    dealId?: string;
    party?: 'buyer' | 'seller' | 'system';
  }
): Promise<{
  primary:  { cid: string; backend: 'arweave'; url?: string };
  mirror:   { cid: string;  backend: 'ipfs';   url?: string };
  integrity:{ computedSha256: string; matches?: boolean };
}>
```

*Notes*
- When `withPostgres === true`, successful uploads are recorded in `evidence_records`:
  `(deal_id, party, sha256, primary_cid, mirror_cid, content_type, created_at)`.

---

## Errors
- **Integrity mismatch** — If `integrityHash` is provided and differs from the computed SHA-256, the upload throws.
- **Gateway errors** — Non-2xx from Arweave/IPFS upload/download/HEAD throws with HTTP status.
- **DB not configured** — `withPostgres=true` but `DATABASE_URL` absent → constructor throws.

**Tip:** Implement retries/backoff at the app edge; always log both primary and mirror IDs.

---

## Local development
```bash
pnpm i
pnpm build
pnpm test   # if tests are enabled
```

Recommended `.gitignore`:
```
node_modules/
dist/
.env
coverage/
```

---

## Testing
If you enable tests (requires reachable endpoints or mocks):

```bash
pnpm test
```

---

## Security & privacy
- Don’t upload raw PII/PHI/secrets to public storage. Prefer **client-side encryption** (recipient public key).
- Keep `.env` out of git; rotate tokens regularly.
- Add **size limits** and consider **AV scanning** before upload.
- IPFS is content-addressed (not immutable by policy); Arweave aims for durable, long-term availability (subject to funding/endpoint).

---

## Roadmap
- Client-side encryption (XChaCha20-Poly1305)
- Streaming uploads for large files
- Mirror-repair cron (periodic HEAD checks)
- Pluggable pinners/gateways & retry policies
- Optional S3/MinIO cold backup mirror

---

 
---

## License
MIT

---

## Maintainers
- **Sampada Dhungana** – Maintainer  
- Bijay Prasai – Maintainer
- Birochan Mainali - Maintainer
- Tanchopa - Mainatainer
- Artha Network team
