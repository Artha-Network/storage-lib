import { ethers } from "ethers";
import { type ResolveTicket } from "@trust-escrow/tickets-lib";

export class EscrowClient {
  constructor(
    private provider: ethers.JsonRpcProvider, 
    private contractAddress: string
  ) {}

  async createEscrow(dealId: string, seller: string, amount: bigint) {
    const signer = await this.provider.getSigner();
    const contract = new ethers.Contract(this.contractAddress, ["function createDeal(bytes32,address,uint256)"], signer);
    
    // Hash string to bytes32
    const dealIdBytes = ethers.id(dealId);
    
    const tx = await contract.createDeal(dealIdBytes, seller, 30 * 86400); // 30 day timeout
    return tx.wait();
  }

  async submitResolution(ticket: ResolveTicket, signature: string) {
    // Bridges the gap between your tickets-lib and the blockchain
    const signer = await this.provider.getSigner();
    const contract = new ethers.Contract(this.contractAddress, ["function resolve(bytes32,bytes)"], signer);
    
    return contract.resolve(ethers.id(ticket.deal_id), signature);
  }
}
