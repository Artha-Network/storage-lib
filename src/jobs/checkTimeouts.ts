import { ethers } from "ethers";

// Run this via Cron every hour
export async function checkTimeouts() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDR, ABI, provider);

  // This requires an event indexer (like the Subgraph) to find candidates efficiently
  const openDeals = await fetchOpenDealsFromSubgraph();

  for (const deal of openDeals) {
    if (deal.timeout < Date.now() / 1000) {
      console.log(`Deal ${deal.id} expired. Triggering refund.`);
      
      const wallet = new ethers.Wallet(process.env.KEEPER_KEY, provider);
      await contract.connect(wallet).expireDeal(deal.id);
    }
  }
}
