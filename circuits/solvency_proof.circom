template SolvencyProof() {
    // Private Inputs (User keeps these secret)
    signal input userBalance;
    signal input userSalt;
    
    // Public Inputs (Everyone sees these)
    signal input dealAmount;
    signal input balanceCommitment; // Hash of balance + salt

    // 1. Verify the commitment matches the user's claimed balance hash
    component hasher = Poseidon(2);
    hasher.inputs[0] <== userBalance;
    hasher.inputs[1] <== userSalt;
    balanceCommitment === hasher.out;

    // 2. Verify user has enough funds for the deal
    // Creates a constraint: userBalance >= dealAmount
    component ge = GreaterEqThan(252); 
    ge.in[0] <== userBalance;
    ge.in[1] <== dealAmount;
    ge.out === 1;
}

component main = SolvencyProof();
