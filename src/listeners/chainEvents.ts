import { ethers } from "ethers";
import { sendEmail } from "../transports/email";

export function listenForEvents() {
  const contract = new ethers.Contract(ADDRESS, ABI, PROVIDER);

  contract.on("DealResolved", async (dealId, outcome) => {
    // 1. Lookup user email from your database (not on-chain)
    const userEmail = await db.getEmailForDeal(dealId);
    
    // 2. Send alert
    const status = outcome === 1 ? "Released" : "Refunded";
    await sendEmail(userEmail, `Escrow Update`, `Your deal ${dealId} has been ${status}.`);
  });
}
