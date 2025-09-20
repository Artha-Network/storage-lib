# storage-lib
Arweave/IPFS abstraction, hashing, dual-pin, integrity verification.

---
```md
# @trust-escrow/storage-lib

Thin abstraction over **Arweave** and **IPFS** for evidence & rationale:
- Upload, pin, verify integrity
- Hashing utilities
- Dual-pin strategy

## Install
```bash
pnpm add @trust-escrow/storage-lib
Usage
import { arweaveStore, ipfsStore } from "@trust-escrow/storage-lib";

const cid = await arweaveStore.put(Buffer.from("hello"), { contentType: "text/plain" });
const ok  = await arweaveStore.verify(cid);
Config

Arweave gateway + key

IPFS gateway + pinning service token

Tests

Integrity round-trip

Failure paths (timeouts, corrupt content)

License

MIT
