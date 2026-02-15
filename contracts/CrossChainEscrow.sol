// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

contract CrossChainEscrow {
    IRouterClient router;

    // Send a message to the escrow contract on another chain to "Unlock" funds
    function unlockOnDestination(uint64 destinationChainSelector, address receiver, string memory dealId) external payable {
        Client.EVM2AnyMessage memory evm2AnyMessage = Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: abi.encode(dealId, "UNLOCK"),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 200_000})),
            feeToken: address(0)
        });

        uint256 fees = router.getFee(destinationChainSelector, evm2AnyMessage);
        router.ccipSend{value: fees}(destinationChainSelector, evm2AnyMessage);
    }
}
