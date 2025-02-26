require("dotenv").config();
const ethers = require("ethers");
const colors = require("colors");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const contractAddress = "0x2c9C959516e9AAEdB2C748224a41249202ca8BE7";
const gasLimitStake = 500000;
const gasLimitUnstake = 800000;

// RPC bağlantı hata kontrolü için try-catch ekleme ve yeniden deneme fonksiyonu
async function getProvider(maxRetries = 3, retryDelay = 10000) {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      // RPC bağlantısının aktif olduğunu kontrol et
      await provider.getNetwork();
      console.log("✅ RPC bağlantısı başarılı".green);
      return provider;
    } catch (error) {
      attempt++;
      console.error(`❌ RPC bağlantı hatası (${attempt}/${maxRetries}): ${error.message}`.red);
      
      if (attempt < maxRetries) {
        console.log(`⏱️ ${retryDelay / 1000} saniye sonra tekrar denenecek...`.yellow);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error("❌ Maksimum yeniden deneme sayısına ulaşıldı.".red);
        throw new Error(`RPC bağlantısı kurulamadı: ${error.message}`);
      }
    }
  }
}

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to stake MON...`.magenta);

    const stakeAmount = getRandomAmount();
    console.log(
      `Random stake amount: ${ethers.utils.formatEther(stakeAmount)} MON`
    );

    const tx = {
      to: contractAddress,
      data: "0xd5575982",
      gasLimit: ethers.utils.hexlify(gasLimitStake),
      value: stakeAmount,
    };

    console.log("🔄 Sending stake transaction...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for transaction confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake successful!`.green.underline);

    return { receipt, stakeAmount };
  } catch (error) {
    console.error("❌ Staking failed:".red, error.message);
    
    // RPC hatası durumunda bekleme ve yeniden deneme
    if (error.code === "SERVER_ERROR" || error.code === "NETWORK_ERROR") {
      console.log("⚠️ RPC sunucu hatası. Bekleniyor...".yellow);
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 saniye bekle
    }
    
    throw error;
  }
}

async function unstakeGMON(wallet, amountToUnstake, cycleNumber) {
  try {
    console.log(
      `\n[Cycle ${cycleNumber}] Preparing to unstake gMON...`.magenta
    );
    console.log(
      `Amount to unstake: ${ethers.utils.formatEther(amountToUnstake)} gMON`
    );

    const functionSelector = "0x6fed1ea7";
    const paddedAmount = ethers.utils.hexZeroPad(
      amountToUnstake.toHexString(),
      32
    );
    const data = functionSelector + paddedAmount.slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitUnstake),
    };

    console.log("🔄 Sending unstake transaction...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for transaction confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Unstake successful!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Unstaking failed:".red, error.message);
    
    // RPC hatası durumunda bekleme ve yeniden deneme
    if (error.code === "SERVER_ERROR" || error.code === "NETWORK_ERROR") {
      console.log("⚠️ RPC sunucu hatası. Bekleniyor...".yellow);
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 saniye bekle
    }
    
    throw error;
  }
}

async function main() {
  const startCycle = parseInt(process.argv[2] || 1);
  const remainingCycles = parseInt(process.argv[3] || 50);
  const totalCycles = startCycle + remainingCycles - 1;

  console.log(`Starting staking cycles from ${startCycle} to ${totalCycles}...`.green);
  
  let successfulCycles = 0;
  let provider;
  
  try {
    // İlk olarak provider bağlantısını kontrol et
    provider = await getProvider();
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    if (!PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY çevre değişkeni bulunamadı! .env dosyasını kontrol edin.");
    }
    
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    for (let i = startCycle; i <= totalCycles; i++) {
      try {
        console.log(`Cycle ${i} of ${totalCycles}:`.magenta);

        const { stakeAmount } = await stakeMON(wallet, i);

        const delayTime = getRandomDelay();
        console.log(`Waiting for ${delayTime / 1000} seconds before unstaking...`);
        await delay(delayTime);

        await unstakeGMON(wallet, stakeAmount, i);
        
        successfulCycles++;

        if (i < totalCycles) {
          const interCycleDelay = getRandomDelay();
          console.log(
            `\nWaiting ${interCycleDelay / 1000} seconds before next cycle...`
          );
          await delay(interCycleDelay);
        }
      } catch (error) {
        console.error(`❌ Cycle ${i} failed:`.red, error.message);
        
        // Ciddi hata durumunda kalan döngüleri atlayabilirsiniz veya 
        // burada daha fazla yeniden deneme mantığı ekleyebilirsiniz
        
        // 1 dakika bekleyip sonraki döngüyü deneyelim
        console.log(`⏱️ 1 dakika bekleniyor, sonraki döngü denenecek...`.yellow);
        await delay(60000);
        
        // Arka arkaya 3 hata durumunda döngüyü kıralım
        if (i > startCycle + 2 && 
            i - successfulCycles > 3) {
          console.error(`❌ Arka arkaya çok fazla hata oluştu, çıkılıyor.`.red);
          break;
        }
      }
    }
  } catch (error) {
    console.error(`❌ Fatal error:`.red, error.message);
  } finally {
    console.log(`Completed ${successfulCycles} of ${remainingCycles} cycles`.green);
    if (successfulCycles === 0) {
      console.log(`❌ No cycles were completed successfully. Check RPC connection.`.red);
      process.exit(1); // Hata kodu ile çık
    } else if (successfulCycles < remainingCycles) {
      console.log(`⚠️ Some cycles were not completed (${successfulCycles}/${remainingCycles})`.yellow);
      process.exit(0); // Kısmi başarı
    } else {
      console.log(`\nAll cycles from ${startCycle} to ${totalCycles} completed successfully!`.green.bold);
      process.exit(0); // Tam başarı
    }
  }
}

main().catch(error => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});