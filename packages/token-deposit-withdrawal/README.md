# token-deposit Tutorial

`token-deposit` demonstrates moving a token from Ethereum (Layer 1) into the Arbitrum (Layer 2) chain using the Standard Token Gateway in Arbitrum's token bridging system.

For info on how it works under the hood, see our [token bridging docs](https://developer.offchainlabs.com/docs/bridging_assets).

NOTE: This is a modified version of the `token-deposit` tutorial that includes both token & ETH deposits as well as withdrawals.  Intended as a simple POC for handling Arbitrum transactions from contracts between L1 and L2.

#### **Standard ERC20 Deposit**

Depositing an ERC20 token into the Arbitrum chain is done via our the Arbitrum token bridge.

Here, we deploy a [demo token](./contracts/DappToken.sol) and trigger a deposit; by default, the deposit will be routed through the standard ERC20 gateway, where on initial deposit, a standard arb erc20 contract will automatically be deployed to L2.

We use our [arb-ts](https://github.com/OffchainLabs/arbitrum/tree/master/packages/arb-ts) library to initiate and verify the deposit.

See [./exec.js](./scripts/exec.js) for inline explanation.

### Config Environment Variables

Set the values shown in `.env-sample` as environmental variables. To copy it into a `.env` file:

```bash
cp .env-sample .env
```

(you'll still need to edit some variables, i.e., `DEVNET_PRIVKEY`)

The following environment variables were added to the modified version of this tutorial:

```
ETH_FLAG - Set to `true` to set deposits and withdrawals for ETH, default deposits and withdrawals use DappTokens
DEPOSIT_AMOUNT - Amount of DappTokens to deposit into L2
ETH_DEPOSIT - Amount of ETH to deposit into L2 (in ETH)
WITHDRAW_AMOUNT - Amount of DappTokens to withdraw from L2 back to L1
ETH_WITHDRAWAL - Amount of ETH to withdraw from L2 back to L1 (in ETH)

DAPP_CONTRACT - DappToken contract address (set this to re-use deployed contracts)
FACTORY_CONTRACT - Clone factory contract address (set this to re-use deployed contracts)
MASTER_CONTRACT - Master contract address (set this to re-use deployed contracts)
CHILD_CONTRACT - Child clone contract address (set this to re-use deployed contracts)
```

### Run:

```
yarn run token-deposit
```

### Updates made to Arbitrum Deposit Tutorial 

Script consists of following parts:
- Deploy Dapp Token contract if needed and grab relevant contract objects/addresses
- Make transfer from L1 to L2 (takes around 12 minutes)
- Deploy master contract or get deployed master contract address
- Deploy factory contract or get deployed factory contract address
- Deploy child contract or get deployed child contract address & transfer funds into child
- Initiate withdrawal of funds from L2 back to L1 (1 week)


<p align="center"><img src="../../assets/offchain_labs_logo.png" width="600"></p>
