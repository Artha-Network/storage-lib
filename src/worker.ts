import { arweaveStore } from "@trust-escrow/storage-lib";
import { sign, schema } from "@trust-escrow/tickets-lib";
import { Queue } from "bullmq";

const disputeQueue = new Queue("disputes");

disputeQueue.process(async (job) => {
  const { evidenceCid, dealId } = job.data;

  // 1. Fetch Evidence
  const evidenceJson = await arweaveStore.get(evidenceCid);
  const evidence = JSON.parse(evidenceJson.toString());

  // 2. Automated Judgment Logic (Simple Example)
  // In reality, this might query an AI model or wait for human input
  const action = evidence.sellerDelivered ? "RELEASE" : "REFUND";

  // 3. Create Ticket
  const ticket = schema.parse({
    schema: "escrow.v1.ResolveTicket",
    deal_id: dealId,
    action: action,
    split_bps: 0,
    rationale_cid: evidenceCid,
    confidence: 1.0,
    nonce: Date.now(),
    expires_at: Math.floor(Date.now()/1000) + 3600
  });

  // 4. Sign and Broadcast
  // Returns the signed bytes to be sent to the chain
  return sign(ticket, process.env.ORACLE_PRIVATE_KEY!);
});
