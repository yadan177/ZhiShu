const path = require("node:path");
const appPackage = require("./package.json");
const signedWindowsRelease = process.env.ZHISHU_SIGNED_WINDOWS_RELEASE === "1";

module.exports = {
  ...appPackage.build,
  afterPack: path.join(__dirname, "scripts/after-pack-mac-sign.cjs"),
  ...(signedWindowsRelease ? { forceCodeSigning: true } : {}),
  publish: [{
    provider: "generic",
    url: `https://github.com/yadan177/ZhiShu/releases/download/desktop-v${appPackage.version}/`,
  }],
};
