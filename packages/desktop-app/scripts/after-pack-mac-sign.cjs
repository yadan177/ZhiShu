const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * electron-builder afterPack 钩子：
 * 当 macOS 构建未配置 Apple Developer ID 证书（CSC_LINK / CSC_NAME）时，
 * electron-builder 的 `identity: null` 会跳过签名并遗留 Electron 原始残缺签名，
 * 导致 Apple Silicon macOS 在下载后报错「已损坏，无法打开」。
 * 此处显式执行完整 ad-hoc 深度重签并用 `codesign --verify --deep --strict` 门禁复核。
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) {
    throw new Error(`未找到打包后的 macOS 应用目录：${appPath}`);
  }

  console.log(`[afterPack] 执行 macOS ad-hoc 深度重签：${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { stdio: "inherit" });
};
