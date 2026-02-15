// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TrustEscrow {
    struct Deal {
        address buyer;
        address seller;
        uint256 amount;
        uint256 timeout;
        bool isLocked;
    }

    mapping(bytes32 => Deal) public deals;
    IERC20 public stablecoin;

    event DealCreated(bytes32 indexed dealId, address buyer, address seller);
    event DealResolved(bytes32 indexed dealId, uint8 outcome);

    constructor(address _token) {
        stablecoin = IERC20(_token);
    }

    function createDeal(bytes32 _dealId, address _seller, uint256 _timeout) external {
        require(deals[_dealId].buyer == address(0), "Deal ID exists");
        
        // Lock funds
        uint256 amount = 1000 * 10**18; // Example fixed amount
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        deals[_dealId] = Deal(msg.sender, _seller, amount, _timeout, true);
        emit DealCreated(_dealId, msg.sender, _seller);
    }

    // Verify signature from tickets-lib here
    function resolve(bytes32 _dealId, bytes calldata _signature) external {
        Deal storage deal = deals[_dealId];
        require(deal.isLocked, "Already resolved");
        
        // TODO: Validate Ed25519 signature against Oracle public key
        // If valid, release funds to seller or refund buyer
        
        deal.isLocked = false;
        emit DealResolved(_dealId, 1);
    }
}
