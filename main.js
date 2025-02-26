require("dotenv").config();
const prompts = require("prompts");
const fs = require("fs");
const path = require("path");
const displayHeader = require("./src/displayHeader.js");
const colors = require("colors");
const { execSync, spawn } = require("child_process");

// Log dizini oluşturma fonksiyonu
function ensureLogDirectory() {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  return logDir;
}

// Genel log fonksiyonu
function writeLog(type, message) {
  const logDir = ensureLogDirectory();
  const logFile = path.join(logDir, `${type}_${new Date().toISOString().split('T')[0]}.log`);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  fs.appendFileSync(logFile, logMessage);
  console.log(logMessage.trim()); // Konsola da yazdır
}

// Hata log fonksiyonu
function logError(error, context = '') {
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    context: context
  };
  writeLog('error', JSON.stringify(errorDetails, null, 2));
}

// İşlem log fonksiyonu
function logAction(action, details = {}) {
  const logDetails = {
    action: action,
    ...details
  };
  writeLog('action', JSON.stringify(logDetails, null, 2));
}

// Config dosyası
const CONFIG_FILE = path.join(__dirname, "daily-schedule.json");
const SCRIPT_SEQUENCE = ["izumi", "magma", "rubic", "apriori"];
const CYCLE_COUNT = 50;

const DEFAULT_CONFIG = {
  currentScriptIndex: 0,
  lastRunDate: new Date().toISOString(),
  isRunning: false,
  currentScript: null,
  status: "not_started",
  cyclesCompleted: 0,
  resumePoint: null,
  totalCycles: CYCLE_COUNT,
  scriptCompletedToday: false
};

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (error) {
    logError(error, "Config okunurken hata");
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return DEFAULT_CONFIG;
}

function updateConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    logError(error, "Config güncellenirken hata");
  }
}

function isSameDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

async function waitUntilNextDay() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 10, 0);
  console.log("\n⏰ Ertesi gün bekleniyor...".yellow);
  return new Promise((resolve) => setTimeout(resolve, tomorrow - now));
}

async function runScriptWithProgress(scriptName, totalCycles) {
  return new Promise((resolve, reject) => {
    let config = readConfig();
    
    // Kaldığı yerden devam etme kontrolü
    const startCycle = config.resumePoint && config.resumePoint.script === scriptName 
      ? config.resumePoint.cycle 
      : 1;

    // Kalan cycle sayısını hesapla
    const remainingCycles = Math.max(0, totalCycles - (startCycle - 1));

    // Eğer kalan cycle yoksa, scripti çalıştırmadan başarılı olarak dön
    if (remainingCycles <= 0) {
      console.log(`✅ Script ${scriptName} için tüm döngüler tamamlandı.`.green);
      
      // Config'i güncelle
      config.cyclesCompleted = totalCycles;
      config.status = "completed";
      config.currentScript = scriptName;
      config.resumePoint = null;
      updateConfig(config);
      
      logAction('Script Tamamlama', {
        script: scriptName,
        status: "success",
        message: "No cycles remaining"
      });
      
      return resolve(totalCycles);
    }

    // Toplam cycle sayısını ve diğer bilgileri güncelle
    config.totalCycles = totalCycles;
    config.currentScript = scriptName;
    config.status = "in_progress";
    updateConfig(config);

    logAction('Script Başlatma', {
      script: scriptName,
      totalCycles: totalCycles,
      startCycle: startCycle,
      remainingCycles: remainingCycles
    });

    console.log(`Starting ${scriptName} from cycle ${startCycle} to ${startCycle + remainingCycles - 1}...`.green);

    const args = [
      "./scripts/" + scriptName + ".js", 
      startCycle.toString(), 
      remainingCycles.toString()
    ];
    
    const child = spawn("node", args, { stdio: ["pipe", "pipe", "pipe"] });
    
    child.stdout.on("data", (data) => {
      const output = data.toString();
      process.stdout.write(output);
      
      const match = /Cycle (\d+) of (\d+)/.exec(output);
      if (match) {
        const completedCycles = parseInt(match[1]);
        
        try {
          config = readConfig(); 
          config.cyclesCompleted = completedCycles;
          config.currentScript = scriptName;
          config.status = "in_progress";
          config.resumePoint = {
            script: scriptName,
            cycle: completedCycles
          };
          updateConfig(config);

          logAction('Cycle İlerlemesi', {
            script: scriptName,
            completedCycles: completedCycles,
            totalCycles: totalCycles
          });
        } catch (configError) {
          logError(configError, 'Cycle İlerlemesi Kaydetme');
        }
      }
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    child.on("close", (code) => {
      try {
        config = readConfig();
        
        // Başarılı tamamlanmışsa - Burayı değiştiriyoruz
        // Hem çıkış kodu 0 olmalı hem de tüm döngüler tamamlanmış olmalı
        if (code === 0 && config.cyclesCompleted >= totalCycles) {
          config.cyclesCompleted = totalCycles;
          config.status = "completed";
          config.resumePoint = null; // Reset resume point
        } else {
          // Kısmi başarı veya tamamen başarısız durumunda bile "failed" olarak işaretle
          config.status = "failed";
          // Kalan döngüleri tekrar deneyebilmek için resumePoint korunuyor
        }
        
        config.currentScript = scriptName;
        updateConfig(config);
    
        logAction('Script Tamamlama', {
          script: scriptName,
          status: code === 0 && config.cyclesCompleted >= totalCycles ? "success" : "failed",
          exitCode: code
        });
        
        // Burayı da değiştiriyoruz - Tam başarı durumunda resolve, değilse reject
        if (code === 0 && config.cyclesCompleted >= totalCycles) {
          resolve(totalCycles);
        } else {
          reject(new Error(`Tam tamamlanmadı: ${config.cyclesCompleted}/${totalCycles} döngü`));
        }
      } catch (configError) {
        logError(configError, 'Script Tamamlama Kaydetme');
        reject(configError);
      }
    });

    child.on("error", (error) => {
      logError(error, `Script Başlatma Hatası: ${scriptName}`);
      reject(error);
    });
  });
}

async function runDailySchedule() {
  try {
    displayHeader();
    logAction('Günlük Zamanlama Başlatıldı');
    
    let config = readConfig();
    const today = new Date();

    // Config'de scriptCompletedToday yoksa, ekle
    if (config.scriptCompletedToday === undefined) {
      config.scriptCompletedToday = false;
      updateConfig(config);
    }

    // Gün değişimi kontrolü - Yeni güne geçtikse scriptCompletedToday'i sıfırla
    if (!isSameDay(new Date(config.lastRunDate), today)) {
      config.scriptCompletedToday = false;
      updateConfig(config);
    }

    // Kaldığı yerden devam etme kontrolü
    if (config.resumePoint && isSameDay(new Date(config.lastRunDate), today) && !config.scriptCompletedToday) {
      // Eğer bugünün scripti tamamlanmadıysa devam et
      if (config.status === "in_progress" || config.status === "paused") {
        console.log(`⏯️ Kaldığı yerden devam ediliyor: ${config.resumePoint.script}`.yellow);
        
        try {
          await runScriptWithProgress(config.resumePoint.script, CYCLE_COUNT);
          
          // Script başarıyla tamamlandıysa bir sonraki scripta geç ve bugün için tamamlandı işaretle
          config = readConfig();
          config.currentScriptIndex = (config.currentScriptIndex + 1) % SCRIPT_SEQUENCE.length;
          config.lastRunDate = new Date().toISOString();
          config.cyclesCompleted = 0;
          config.status = "not_started";
          config.resumePoint = null;
          config.scriptCompletedToday = true; // Bugün için script tamamlandı
          updateConfig(config);
          
          console.log(`\n✅ ${config.currentScript} scripti tamamlandı. Bir sonraki gün ${SCRIPT_SEQUENCE[config.currentScriptIndex]} çalıştırılacak.`.green);
          
        } catch (error) {
          logError(error, 'Devam Ettirme Hatası');
          console.error("❌ Devam ettirme sırasında hata oluştu.".red);
        }
      }
    }

    // Normal günlük çalışma döngüsü
    while (true) {
      config = readConfig(); // Her zaman en güncel config'i oku
      
      // Eğer bugün için bir script tamamlanmışsa, bir sonraki güne kadar bekle
      if (config.scriptCompletedToday) {
        console.log(`\n⏸️ Bugün için bir script tamamlandı. Yarına kadar bekleniyor...`.yellow);
        await waitUntilNextDay();
        
        // Yeni gün başladı, scriptCompletedToday'i sıfırla
        config = readConfig();
        config.scriptCompletedToday = false;
        updateConfig(config);
        continue; // Döngünün başına dön
      }
      
      const currentScript = SCRIPT_SEQUENCE[config.currentScriptIndex];
      
      try {
        console.log(`🚀 Bugünün scripti çalıştırılıyor: ${currentScript}`.cyan);
        
        // Her script tam CYCLE_COUNT cycle çalışacak
        await runScriptWithProgress(currentScript, CYCLE_COUNT);
        
        // Bir sonraki betike geç
        config = readConfig();
        config.currentScriptIndex = (config.currentScriptIndex + 1) % SCRIPT_SEQUENCE.length;
        config.lastRunDate = new Date().toISOString();
        config.cyclesCompleted = 0;
        config.status = "not_started";
        config.resumePoint = null;
        config.scriptCompletedToday = true; // Bugün için script tamamlandı
        updateConfig(config);
        
        console.log(`\n✅ ${currentScript} scripti tamamlandı. Bir sonraki gün ${SCRIPT_SEQUENCE[config.currentScriptIndex]} çalıştırılacak.`.green);
        
        // Bir sonraki güne kadar bekle
        await waitUntilNextDay();
        
        // Yeni gün başladı, scriptCompletedToday'i sıfırla
        config = readConfig();
        config.scriptCompletedToday = false;
        updateConfig(config);
      } catch (error) {
        logError(error, 'Günlük Çalışma Döngüsü Hatası');
        console.error(`❌ Hata oluştu, 5 dk sonra tekrar denenecek.`.red);
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      }
    }
  } catch (mainError) {
    logError(mainError, 'Günlük Zamanlama Ana Hata');
    
    // Kritik hata durumunda 5 dakika sonra yeniden başlatma
    console.error("❌ Kritik hata oluştu. 5 dakika sonra yeniden başlatılacak.".red);
    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
    return runDailySchedule();
  }
}

// Ctrl+C handler'ında log ekleme
process.on("SIGINT", () => {
  logAction('Program Durduruldu', {
    reason: 'Kullanıcı tarafından durduruldu (Ctrl+C)'
  });
  
  let config = readConfig();
  config.isRunning = false;
  
  // Eğer bugünün döngüsü tamamlanmadıysa
  if (config.cyclesCompleted < CYCLE_COUNT) {
    config.status = "paused";
  } else {
    config.status = "completed";
  }
  
  updateConfig(config);
  
  console.log("🛑 Program durduruluyor...".yellow);
  console.log("💾 Durum kaydedildi.".green);
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logError(error, 'Yakalanmamış İstisna');
  console.error("❌ Beklenmeyen bir hata oluştu.".red);
});

if (process.argv.includes("daily")) {
  runDailySchedule().catch(console.error);
} else {
  (async function run() {
    displayHeader();
    const response = await prompts({
      type: "select",
      name: "script",
      message: "Çalıştırılacak scripti seç:",
      choices: SCRIPT_SEQUENCE.map((s) => ({ title: s, value: s }))
        .concat({ title: "Günlük çalışma modunu başlat", value: "daily" })
        .concat({ title: "Çıkış", value: "exit" }),
    });
    
    if (!response.script || response.script === "exit") return;
    
    if (response.script === "daily") {
      console.log("Günlük çalışma modu başlatılıyor...");
      runDailySchedule().catch(console.error);
    } else {
      console.log(`Running ${response.script}...`);
      spawn("node", ["./scripts/" + response.script + ".js"], { stdio: "inherit" });
    }
  })().catch(console.error);
}