const { utils, BigNumber, providers, Wallet } = require('ethers')
const { ethers } = require('hardhat')
const { Bridge } = require('arb-ts')
const { arbLog, requireEnvVariables } = require('arb-shared-dependencies')
const { parseEther } = utils
require('dotenv').config()
requireEnvVariables(['DEVNET_PRIVKEY', 'L2RPC', 'L1RPC'])

/**
 * Set up: instantiate L1 / L2 wallets connected to providers
 */

const walletPrivateKey = process.env.DEVNET_PRIVKEY

const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC)
const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC)

const l1Wallet = new Wallet(walletPrivateKey, l1Provider)
const l2Wallet = new Wallet(walletPrivateKey, l2Provider)

/**
 * Set the amount of token to be deposited in L2
 */
const ethFlag = process.env.ETH_FLAG
const tokenDepositAmount = BigNumber.from(process.env.DEPOSIT_AMOUNT)
const ethToL2DepositAmount = parseEther(process.env.ETH_DEPOSIT)

const main = async () => {
  console.log('~~~~~~~~Beginning ETH balance L1:', l1Wallet.address, ethers.utils.formatEther(await l1Provider.getBalance(l1Wallet.address)));
  console.log('~~~~~~~~Beginning ETH balance L2:', l2Wallet.address, ethers.utils.formatEther(await l2Provider.getBalance(l2Wallet.address)));

  await arbLog('Deposit token using arb-ts')
  /**
   * Use wallets to create an arb-ts bridge instance
   * We'll use bridge for its convenience methods around depositing tokens to L2
   */
  const bridge = await Bridge.init(l1Wallet, l2Wallet)
  console.log('Done with bridge')
  /**
   * For the purpose of our tests, here we deploy an standard ERC20 token (DappToken) to L1
   * It sends it's deployer (us) the initial supply of 1000000000000000
   */
  let erc20Address;
  let l1DappToken;
  let l2DappToken;
  const contractName = 'DappToken3';

  if (process.env.DAPP_CONTRACT) {
    erc20Address = process.env.DAPP_CONTRACT
    l2DappAddress = await bridge.getERC20L2Address(erc20Address)
    console.log(`Using deployed DappToken address L1: ${erc20Address} and L2: ${l2DappAddress}`)
    l1DappToken = await (await ethers.getContractAt(contractName, erc20Address)).connect(l1Wallet)
    l2DappToken = await (await ethers.getContractAt(contractName, l2DappAddress)).connect(l2Wallet)
  } else {
    const L1DappToken = await (
      await ethers.getContractFactory(contractName)
    ).connect(l1Wallet)
    console.log('Deploying the test DappToken to L1')
    l1DappToken = await L1DappToken.deploy(100000)
    await l1DappToken.deployed()
    console.log(`DappToken is deployed to L1 at ${l1DappToken.address}`)
    erc20Address = l1DappToken.address
    l2DappAddress = await bridge.getERC20L2Address(erc20Address)
    l2DappToken = await (await ethers.getContractAt(contractName, l2DappAddress)).connect(l2Wallet)
    console.log(`DappToken is deployed to L2 at ${l2DappToken.address}`)
  }
  console.log(erc20Address)

  console.log('***** Dapp balance L1: ', l1Wallet.address, await l1DappToken.connect(l1Wallet).balanceOf(l1Wallet.address))
  console.log('***** Dapp balance L2: ', l2Wallet.address, await l2DappToken.connect(l2Wallet).balanceOf(l2Wallet.address))

  console.log(await bridge.getERC20L2Address(erc20Address))

  let depositTx
  if (ethFlag) {
    /**
     * Deposit ether from L1 to L2
     * This convenience method automatically queries for the retryable's max submission cost and forwards the appropriate amount to L2
     */
    console.log('Depositing ETH...')
    depositTx = await bridge.depositETH(ethToL2DepositAmount)
  } else {
    /**
     * The Standard Gateway contract will ultimately be making the token transfer call; thus, that's the contract we need to approve.
     * bridge.approveToken handles this approval
     */
    const approveTx = await bridge.approveToken(erc20Address)
    const approveRec = await approveTx.wait()
    console.log(
      `You successfully allowed the Arbitrum Bridge to spend DappToken ${approveRec.transactionHash}`
    )

    /**
     * Deposit DappToken to L2 using Bridge. This will escrows funds in the Gateway contract on L1, and send a message to mint tokens on L2.
     * The bridge.deposit method handles computing the necessary fees for automatic-execution of retryable tickets — maxSubmission cost & l2 gas price * gas — and will automatically forward the fees to L2 as callvalue
     * Also note that since this is the first DappToken deposit onto L2, a standard Arb ERC20 contract will automatically be deployed.
     */
    depositTx = await bridge.deposit({ 'erc20L1Address': erc20Address, 'amount': tokenDepositAmount })
  }

  const depositRec = await depositTx.wait()
  console.log('Deposited', depositRec.transactionHash);

  /**
   * Now we track the status of our retryable ticket
   */

  //  First, we get our txn's sequence number from the event logs (using a handy utility method). This number uniquely identifies our L1 to L2 message (i.e., our token deposit)
  const seqNumArr = await bridge.getInboxSeqNumFromContractTransaction(
    depositRec
  )

  /**
   * Note that a single txn could (in theory) trigger many l1-to-l2 messages; we know ours only triggered 1 tho.
   */
  const seqNum = seqNumArr[0]
  console.log(
    `Sequence number for your transaction found: ${seqNum.toNumber()}`
  )

  let redeemTransaction
  if (ethFlag) {
    redeemTransaction = await bridge.calculateL2TransactionHash(seqNum)
  } else {
    /**
     *  Now we can get compute the txn hashes of the transactions associated with our retryable ticket:
     * (Note that we don't necessarily need all of these (and will only use one of them ), but we include them all for completeness)
     */
    // // retryableTicket: quasi-transaction that can be redeemed, triggering some L2 message
    // const retryableTicket = await bridge.calculateL2TransactionHash(seqNum)
    // //  autoRedeem: record that "automatic" redemption successfully occurred
    // const autoRedeem = await bridge.calculateRetryableAutoRedeemTxnHash(seqNum)
    // L2 message (in our case, mint new token)
    redeemTransaction = await bridge.calculateL2RetryableTransactionHash(
      seqNum
    )
  }
  console.log('l2TxHash is: ' + redeemTransaction)

  /** Now, we have to wait for the L2 tx to go through; i.e., for the Sequencer to include it in its off-chain queue. This should take ~10 minutes at most
   * If the redeem succeeds, that implies that the retryableTicket has been included, and autoRedeem succeeded as well
   */
  console.log('waiting for L2 transaction:')
  const l2TxnRec = await l2Provider.waitForTransaction(
    redeemTransaction,
    undefined,
    1000 * 60 * 10
  )

  console.log(
    `L2 transaction found! Your DappToken balance is updated! ${l2TxnRec.transactionHash}`
  )

  // /**
  //  * Not that our txn has succeeded, we know that a token contract has been deployed on L2, and our tokens have been deposited onto it.
  //  * Let's confirm our new token balance on L2!
  //  */

  console.log('***** Dapp balance L1: ', l1Wallet.address, await l1DappToken.balanceOf(l1Wallet.address))
  console.log('***** Dapp balance L2: ', l2Wallet.address, await l2DappToken.balanceOf(l2Wallet.address))
  console.log('~~~~~~~~ETH balance L1:', l1Wallet.address, ethers.utils.formatEther(await l1Provider.getBalance(l1Wallet.address)));
  console.log('~~~~~~~~ETH balance L2:', l2Wallet.address, ethers.utils.formatEther(await l2Provider.getBalance(l2Wallet.address)));

  // Master clone contract
  let masterAddress;
  let l2MasterContract;
  const masterName = 'ChildContract'

  if (process.env.MASTER_CONTRACT) {
    masterAddress = process.env.MASTER_CONTRACT
    console.log(`Using deployed Master contract ${masterAddress}`)
    l2MasterContract = await (await ethers.getContractAt(masterName, masterAddress)).connect(l2Wallet)
  } else {
    const L2MasterContract = await (
      await ethers.getContractFactory(masterName)
    ).connect(l2Wallet)
    console.log('Deploying the test master contract to L2')
    l2MasterContract = await L2MasterContract.deploy()
    await l2MasterContract.deployed()
    console.log(`Master contract is deployed to L2 at ${l2MasterContract.address}`)
    masterAddress = l2MasterContract.address
  }

  // Contract factory
  let factoryAddress;
  let l2FactoryContract;
  const factoryName = 'ContractFactory'

  if (process.env.FACTORY_CONTRACT) {
    factoryAddress = process.env.CHILD_CONTRACT
    console.log(`Using deployed Factory contract ${factoryAddress}`)
    l2FactoryContract = await (await ethers.getContractAt(factoryName, factoryAddress)).connect(l2Wallet)
  } else {
    const L2FactoryContract = await (
      await ethers.getContractFactory(factoryName)
    ).connect(l2Wallet)
    console.log('Deploying the test factory contract to L2')
    l2FactoryContract = await L2FactoryContract.deploy(l2DappAddress, masterAddress)
    await l2FactoryContract.deployed()
    console.log(`Factory contract is deployed to L2 at ${l2FactoryContract.address}`)
    factoryAddress = l2FactoryContract.address
  }

  // Child clone contract
  let newChildAddress;
  let l2ChildContract;
  const ID = 123

  if (process.env.CHILD_CONTRACT) {
    newChildAddress = process.env.CHILD_CONTRACT
    console.log(`Using deployed Child contract ${newChildAddress}`)
    l2ChildContract = await (await ethers.getContractAt(masterName, newChildAddress)).connect(l2Wallet)

    console.log('~~~~~~~~ ETH balance contract: ', newChildAddress, ethers.utils.formatEther(await l2Provider.getBalance(newChildAddress)))

    if (ethFlag) {
      console.log('Depositing ETH into child', newChildAddress, ethToL2DepositAmount)
      // Transfer ETH from L2 to child address
      await l2Wallet.sendTransaction({
        to: newChildAddress,
        value: ethToL2DepositAmount,
        gasLimit: 1000000,
      });
    } else {
      // Transfer from L2 wallet to child address
      console.log(`Transferring ${tokenDepositAmount / 100} Dapp_Token from ${l2Wallet.address} to ${newChildAddress}`)
      await l2DappToken.connect(l2Wallet).transfer(newChildAddress, tokenDepositAmount)
    }
  } else {
    console.log('Deploying the test child contract to L2')
    if (!ethFlag) {
      await l2DappToken.approve(l2FactoryContract.address, tokenDepositAmount)
    }
    l2Child = await l2FactoryContract.createChild(ID, l2DappAddress)
    newChildAddress = await l2FactoryContract.getChildAddress(ID)
    l2ChildContract = await (await ethers.getContractAt(masterName, newChildAddress)).connect(l2Wallet)

    if (ethFlag) {
      console.log('Depositing ETH into child', newChildAddress, ethToL2DepositAmount)
      // Transfer ETH from L2 to child address
      await l2ChildContract.receiveEth({value: ethToL2DepositAmount})
    }
    console.log(`Child contract is deployed to L2 at ${newChildAddress}`)
  }

  console.log('***** Dapp balance L1: ', l1Wallet.address, await l1DappToken.balanceOf(l1Wallet.address))
  console.log('***** Dapp balance L2: ', l2Wallet.address, await l2DappToken.balanceOf(l2Wallet.address))
  console.log('***** Dapp balance contract: ', newChildAddress, await l2DappToken.balanceOf(newChildAddress))
  console.log('~~~~~~~~ETH balance L1:', l1Wallet.address, ethers.utils.formatEther(await l1Provider.getBalance(l1Wallet.address)))
  console.log('~~~~~~~~ETH balance L2:', l2Wallet.address, ethers.utils.formatEther(await l2Provider.getBalance(l2Wallet.address)))
  console.log('~~~~~~~~ETH balance contract: ', newChildAddress, ethers.utils.formatEther(await l2Provider.getBalance(newChildAddress)))

  console.log('Withdrawing...')

  /**
   * ... Okay, Now we begin withdrawing DappToken from L2. To withdraw, we'll use the arb-ts helper method withdrawERC20
   * withdrawERC20 will call our L2 Gateway Router to initiate a withdrawal via the Standard ERC20 gateway
   * This transaction is constructed and paid for like any other L2 transaction (it just happens to (ultimately) make a call to ArbSys.sendTxToL1)
   */

  const tokenDepositAmount = BigNumber.from(process.env.WITHDRAW_AMOUNT)
  const ethToL2DepositAmount = parseEther(process.env.ETH_WITHDRAWAL)

  // Withdraw tokens from contract
  if(ethFlag) {
    await l2ChildContract.withdrawEth(l2Wallet.address, {value: ethFromL2WithdrawAmount})
  } else {
    await l2ChildContract.withdraw(l2Wallet.address)
  }

  let withdrawTx

  if (ethFlag) {
    withdrawTx = await bridge.withdrawETH(ethFromL2WithdrawAmount)
  } else {
    withdrawTx = await bridge.withdrawERC20(
      erc20Address,
      tokenWithdrawAmount
    )
  }

  const withdrawRec = await withdrawTx.wait()

  /**
   * And with that, our withdrawal is initiated! No additional time-sensitive actions are required.
   * Any time after the transaction's assertion is confirmed, funds can be transferred out of the bridge via the outbox contract
   * We'll display the withdrawals event data here:
   */

  const withdrawEventData = (
    await bridge.getWithdrawalsInL2Transaction(withdrawRec)
  )[0]

  console.log(`Token withdrawal initiated! 🥳 ${withdrawRec.transactionHash}`)
  console.log('Withdrawal data:', withdrawEventData)

  console.log(
    `To to claim funds (after dispute period), see outbox-execute repo ✌️`
  )

  console.log('***** Dapp balance L1 after: ', l1Wallet.address, await l1DappToken.balanceOf(l1Wallet.address))
  console.log('***** Dapp balance L2 after: ', l2Wallet.address, await l2DappToken.balanceOf(l2Wallet.address))
  console.log('***** Dapp balance contract after: ', newChildAddress, await l2DappToken.balanceOf(newChildAddress))
  console.log('~~~~~~~~Ending ETH balance L1:', l1Wallet.address, ethers.utils.formatEther(await l1Provider.getBalance(l1Wallet.address)));
  console.log('~~~~~~~~Ending ETH balance L2:', l2Wallet.address, ethers.utils.formatEther(await l2Provider.getBalance(l2Wallet.address)));
  console.log('~~~~~~~~Ending ETH balance contract: ', newChildAddress, ethers.utils.formatEther(await l2Provider.getBalance(newChildAddress)))

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
