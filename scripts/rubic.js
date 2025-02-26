require("dotenv").config();
const { ethers } = require("ethers");
const colors = require("colors");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  WMON_CONTRACT,
  [
    "function deposit() public payable",
    "function withdraw(uint256 amount) public",
  ],
  wallet
);

function getRandomAmount() {
  const min = 0.01;
  const max = 0.05;
  const randomAmount = Math.random() * (max - min) + min;
  return ethers.utils.parseEther(randomAmount.toFixed(4));
}

function getRandomDelay() {
  const minDelay = 1 * 60 * 1000;
  const maxDelay = 3 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

async function wrapMON(amount) {
  try {
    console.log(
      `🔄 Wrapping ${ethers.utils.formatEther(amount)} MON into WMON...`.magenta
    );
    const tx = await contract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️  Wrap MON → WMON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
  } catch (error) {
    console.error("❌ Error wrapping MON:".red, error);
    throw error;
  }
}

async function unwrapMON(amount) {
  try {
    console.log(
      `🔄 Unwrapping ${ethers.utils.formatEther(amount)} WMON back to MON...`
        .magenta
    );
    const tx = await contract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️  Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
  } catch (error) {
    console.error("❌ Error unwrapping WMON:".red, error);
    throw error;
  }
}

async function main() {
  const startCycle = parseInt(process.argv[2] || 1);
  const remainingCycles = parseInt(process.argv[3] || 50);
  const totalCycles = startCycle + remainingCycles - 1;

  console.log(`Starting swap cycles from ${startCycle} to ${totalCycles}...`.green);

  for (let i = startCycle; i <= totalCycles; i++) {
    try {
      console.log(`Cycle ${i} of ${totalCycles}:`.magenta);
      
      const randomAmount = getRandomAmount();
      await wrapMON(randomAmount);
      await unwrapMON(randomAmount);

      const randomDelay = getRandomDelay();
      console.log(
        `Waiting for ${randomDelay / 1000} seconds before next cycle...`.yellow
      );
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    } catch (error) {
      console.error(`❌ Cycle ${i} failed:`.red, error.message);
      break;
    }
  }

  console.log(`All cycles from ${startCycle} to ${totalCycles} completed`.green);
}

main().catch(console.error);