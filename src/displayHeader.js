require("colors");

function displayHeader() {
  process.stdout.write("\x1Bc");
  console.log("========================================".magenta);
  console.log("=        Ben onu bunu bilmem           =".magenta);
  console.log("=      tek bildiğim para -micto        =".magenta);
  console.log("=      https://t.me/corenodechat       =".magenta);
  console.log("========================================".magenta);
  console.log();
}

module.exports = displayHeader;
