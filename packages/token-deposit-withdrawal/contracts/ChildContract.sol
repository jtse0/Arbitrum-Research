pragma solidity >=0.4.22;
//pragma solidity 0.5.12;

import "./DappToken3.sol";

contract ChildContract{

    DappToken3 public token;
    
    function initializeChild(address _token) external payable {
      token = DappToken3(_token);
    }

    function receiveEth() external payable {
      
    }

    function withdraw(address user) external {
      token.transfer(user, token.balanceOf(address(this)));
    }

    function withdrawEth(address payable user) external payable {
      user.transfer(msg.value);
    }


}