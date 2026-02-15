import { useState } from 'react';
import { arweaveStore } from '@trust-escrow/storage-lib';

export function EvidenceUpload({ dealId }: { dealId: string }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);

    try {
      const file = e.target.files[0];
      const buffer = await file.arrayBuffer();
      
      // Use your storage-lib
      const cid = await arweaveStore.put(Buffer.from(buffer), {
        contentType: file.type,
        tags: { Type: 'Evidence', Deal: dealId }
      });
      
      console.log("Evidence pinned at:", cid);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border border-dashed">
      <input type="file" onChange={handleFile} disabled={uploading} />
      {uploading && <p>Pinning to Arweave...</p>}
    </div>
  );
}
