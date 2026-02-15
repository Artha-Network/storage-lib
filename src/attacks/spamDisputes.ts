import { EscrowClient } from "@trust-escrow/sdk-core";
import { faker } from "@faker-js/faker";

// ATTACK VECTOR: Open 10,000 disputes in 1 minute to clog the Oracle Node
async function floodDisputes() {
  const clients = createRandomWallets(100); // Create 100 fake users
  
  console.log("☠️ Unleashing Chaos Monkey: Dispute Flood ☠️");
  
  const attacks = clients.map(async (client) => {
    for (let i = 0; i < 100; i++) {
      try {
        const dealId = faker.string.uuid();
        await client.createEscrow(dealId, faker.finance.ethereumAddress(), 100n);
        // Immediately dispute it with garbage data
        await client.raiseDispute(dealId, "Automatic Chaos Test");
      } catch (e) {
        console.log("System resisted attack:", e.message);
      }
    }
  });

  await Promise.all(attacks);
}
