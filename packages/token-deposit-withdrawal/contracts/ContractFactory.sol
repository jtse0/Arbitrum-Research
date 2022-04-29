pragma solidity >=0.4.22;
//pragma solidity 0.5.12;

import "./CloneFactory.sol";
import "./ChildContract.sol";
import "./DappToken3.sol";

contract ContractFactory is CloneFactory{

  address public token;
  address public master;

  mapping(uint256 => address) public childAddressList;

  constructor(
      address _token,
      address payable _masterContract
  ) {
      require(_token != address(0), "Zero addr");
      require(_masterContract != address(0), "Zero addr");
      token = _token;
      master = _masterContract;
  }

  function setTokenContract(address newToken) external {
    require(newToken != address(0), "Zero addr");
    token = newToken;
  }

  function setMaster(address newMaster) external {
      require(newMaster != address(0), "Zero addr");
      master = newMaster;
  }

  function createChild(uint256 contractID, address paymentToken) external payable {
      ChildContract child = ChildContract(createClone(master));
      uint256 allowance = DappToken3(paymentToken).allowance(msg.sender, address(this));
      DappToken3(paymentToken).transferFrom(msg.sender, address(child), allowance);
      child.initializeChild{ value: msg.value }(paymentToken);
      childAddressList[contractID] = address(child);
  }

  function getChildAddress(uint256 contractID) external view returns (address) {
      return childAddressList[contractID];
  }


}