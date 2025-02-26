require("dotenv").config();
const { ethers } = require("ethers");
const colors = require("colors");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";

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

async function wrapMON(contract, amount) {
  try {
    console.log(
      `🔄 Wrapping ${ethers.utils.formatEther(amount)} MON into WMON...`.magenta
    );
    const tx = await contract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️  Wrap MON → WMON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error wrapping MON:".red, error.message);
    
    // RPC hatası durumunda bekleme ve yeniden deneme
    if (error.code === "SERVER_ERROR" || error.code === "NETWORK_ERROR") {
      console.log("⚠️ RPC sunucu hatası. Bekleniyor...".yellow);
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 saniye bekle
    }
    
    throw error;
  }
}

async function unwrapMON(contract, amount) {
  try {
    console.log(
      `🔄 Unwrapping ${ethers.utils.formatEther(amount)} WMON back to MON...`
        .magenta
    );
    const tx = await contract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️  Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error unwrapping WMON:".red, error.message);
    
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

  console.log(`Starting swap cycles from ${startCycle} to ${totalCycles}...`.green);
  
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
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );

    for (let i = startCycle; i <= totalCycles; i++) {
      try {
        console.log(`Cycle ${i} of ${totalCycles}:`.magenta);
        
        const randomAmount = getRandomAmount();
        await wrapMON(contract, randomAmount);
        await unwrapMON(contract, randomAmount);
        
        successfulCycles++;

        if (i < totalCycles) {
          const randomDelay = getRandomDelay();
          console.log(
            `Waiting for ${randomDelay / 1000} seconds before next cycle...`.yellow
          );
          await new Promise((resolve) => setTimeout(resolve, randomDelay));
        }
      } catch (error) {
        console.error(`❌ Cycle ${i} failed:`.red, error.message);
        
        // Ciddi hata durumunda kalan döngüleri atlayabilirsiniz veya 
        // burada daha fazla yeniden deneme mantığı ekleyebilirsiniz
        
        // 1 dakika bekleyip sonraki döngüyü deneyelim
        console.log(`⏱️ 1 dakika bekleniyor, sonraki döngü denenecek...`.yellow);
        await new Promise((resolve) => setTimeout(resolve, 60000));
        
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