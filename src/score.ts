type UserHistory = {
  completedDeals: number;
  disputedDeals: number;
  totalVolume: bigint;
};

export function calculateTrustScore(history: UserHistory): number {
  if (history.completedDeals === 0) return 0;

  const disputeRate = history.disputedDeals / history.completedDeals;
  
  // Simple algorithm: Start at 100, deduct for disputes
  let score = 100 * (1 - disputeRate);
  
  // Boost for volume (logarithmic scale)
  const volumeBonus = Math.log10(Number(history.totalVolume)); 
  
  return Math.min(100, Math.max(0, score + volumeBonus));
}
