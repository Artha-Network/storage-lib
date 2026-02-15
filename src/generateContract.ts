import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

export async function generateLegalAgreement(dealData: any) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const text = `
    DIGITAL SERVICE AGREEMENT
    
    Date: ${new Date().toISOString()}
    Blockchain Deal ID: ${dealData.id}
    
    Parties:
    Buyer (Wallet): ${dealData.buyer}
    Seller (Wallet): ${dealData.seller}
    
    Terms:
    The Seller agrees to provide services as defined in the hash ${dealData.termsHash}.
    The Buyer agrees to deposit ${dealData.amount} USDC into the Trust Escrow Smart Contract.
    
    Dispute Resolution:
    Both parties agree to be bound by the on-chain resolution mechanism provided by Trust Escrow.
  `;

  page.drawText(text, { x: 50, y: 700, size: 12, font });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes; // Returns buffer to be emailed or pinned to IPFS
}
