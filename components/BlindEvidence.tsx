// This component strips identifying metadata so jurors are unbiased
export function BlindEvidence({ cid }: { cid: string }) {
  // Fetch data from storage-lib, render without user names
  const { data, type } = useArweaveData(cid);

  if (type === 'image/png') {
    return <img src={data} alt="Evidence" className="blur-sm hover:blur-none transition" />;
  }
  
  return <div className="text-gray-800">{data}</div>;
}
