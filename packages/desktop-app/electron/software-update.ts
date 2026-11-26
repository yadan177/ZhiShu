import { app, shell } from "electron";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import * as electronUpdater from "electron-updater";
import { compareDesktopVersions, fetchDesktopRelease, matchesUpdateInfo, type DesktopRelease } from "./desktop-releases.ts";
import {
  downloadVerifiedInstaller,
  prepareMacReplaceHelper,
  resolveMacAppTarget,
  verifyInstallerBeforeLaunch,
} from "./desktop-updater.ts";

const { autoUpdater } = electronUpdater;

export type SoftwareInstallMode = "auto-replace" | "open-installer" | "electron-updater";

export type SoftwareUpdateState = {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "verifying" | "ready" | "installing" | "manual" | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  installMode?: SoftwareInstallMode;
  message?: string;
};

type DownloadedRecord = {
  version: string;
  filePath: string;
  sha256: string;
  installMode: SoftwareInstallMode;
  macAppPath?: string;
};

function canInstallAutomatically(): boolean {
  if (!app.isPackaged || process.platform !== "win32") return false;
  try {
    const status = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-AuthenticodeSignature -LiteralPath $env:ZHISHU_APP_EXE).Status"],
      {
        env: { ...process.env, ZHISHU_APP_EXE: process.execPath },
        timeout: 10000,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    return status.trim() === "Valid";
  } catch {
    // 无法确认签名时降级为应用内 SHA-256 校验安装流。
  }
  return false;
}

export class SoftwareUpdateService {
  private state: SoftwareUpdateState = { phase: "idle", currentVersion: app.getVersion() };
  private release?: DesktopRelease;
  private installMode?: SoftwareInstallMode;
  private macAppPath?: string;
  private downloaded?: DownloadedRecord;
  private downloadAbort?: AbortController;
  private pendingCheck?: Promise<SoftwareUpdateState>;

  constructor(private readonly notify: (state: SoftwareUpdateState) => void) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("error", (error) => {
      if (
        this.installMode === "electron-updater" &&
        (this.state.phase === "available" || this.state.phase === "downloading" || this.state.phase === "ready")
      ) {
        this.setState({
          phase: "error",
          currentVersion: app.getVersion(),
          availableVersion: this.release?.version,
          installMode: this.installMode,
          message: error instanceof Error ? error.message : "软件更新失败",
        });
      }
    });
    autoUpdater.on("download-progress", ({ percent }) => {
      if (this.installMode === "electron-updater" && this.state.phase === "downloading") {
        this.setState({ ...this.state, percent: Math.max(0, Math.min(100, Math.round(percent))) });
      }
    });
    autoUpdater.on("update-downloaded", () => {
      if (this.installMode === "electron-updater" && this.state.phase === "downloading") {
        this.setState({ ...this.state, phase: "ready", percent: 100 });
      }
    });
  }

  getState(): SoftwareUpdateState {
    return { ...this.state };
  }

  private cacheDir(): string {
    return path.join(app.getPath("userData"), "software-updates");
  }

  private setState(state: SoftwareUpdateState): SoftwareUpdateState {
    this.state = state;
    this.notify(this.getState());
    return this.getState();
  }

  check(): Promise<SoftwareUpdateState> {
    if (this.pendingCheck) return this.pendingCheck;
    if (
      this.state.phase === "downloading" ||
      this.state.phase === "verifying" ||
      this.state.phase === "ready" ||
      this.state.phase === "installing"
    ) {
      return Promise.resolve(this.getState());
    }
    this.pendingCheck = this.checkNow().finally(() => {
      this.pendingCheck = undefined;
    });
    return this.pendingCheck;
  }

  private async checkNow(): Promise<SoftwareUpdateState> {
    this.setState({ phase: "checking", currentVersion: app.getVersion() });
    this.release = undefined;
    this.installMode = undefined;
    this.macAppPath = undefined;
    this.downloaded = undefined;
    try {
      if (!app.isPackaged) {
        return this.setState({ phase: "current", currentVersion: app.getVersion(), message: "开发模式不检查软件更新" });
      }
      const release = await fetchDesktopRelease(process.platform, process.arch);
      this.release = release;
      if (!release || compareDesktopVersions(release.version, app.getVersion()) <= 0) {
        return this.setState({ phase: "current", currentVersion: app.getVersion() });
      }

      // 1. 若 Windows 具备完整官方代码签名与 latest.yml，沿用 electron-updater 原生静默更新。
      if (process.platform === "win32" && release.feedUrl && canInstallAutomatically()) {
        autoUpdater.setFeedURL({ provider: "generic", url: release.feedUrl });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable || !matchesUpdateInfo(result.updateInfo, release.version, process.platform, process.arch)) {
          throw new Error("软件更新清单与发布资产不一致");
        }
        this.installMode = "electron-updater";
        return this.setState({
          phase: "available",
          currentVersion: app.getVersion(),
          availableVersion: release.version,
          installMode: "electron-updater",
        });
      }

      // 2. 方案二：具备 SHA-256 校验摘要（SHA256SUMS.txt 或 GitHub 资产摘要）即可走应用内下载校验与安装。
      if (release.checksumUrl || release.assetDigest) {
        if (process.platform === "darwin") {
          const macTarget = await resolveMacAppTarget(process.execPath, os.homedir());
          this.macAppPath = macTarget?.canAutoReplace ? macTarget.appPath : undefined;
          this.installMode = macTarget?.canAutoReplace ? "auto-replace" : "open-installer";
          return this.setState({
            phase: "available",
            currentVersion: app.getVersion(),
            availableVersion: release.version,
            installMode: this.installMode,
            message: macTarget?.canAutoReplace
              ? "应用内下载并校验 SHA-256 后自动替换重启"
              : "应用内下载并校验 SHA-256 后自动打开安装包",
          });
        }
        this.installMode = "open-installer";
        return this.setState({
          phase: "available",
          currentVersion: app.getVersion(),
          availableVersion: release.version,
          installMode: "open-installer",
          message: "应用内下载并校验 SHA-256 后直接启动安装向导",
        });
      }

      // 3. 无任何校验摘要时安全降级为浏览器手动下载。
      return this.setState({
        phase: "manual",
        currentVersion: app.getVersion(),
        availableVersion: release.version,
        message:
          process.platform === "darwin"
            ? "下载 DMG 后打开安装包，将应用拖入“应用程序”并替换旧版。"
            : "下载 Windows 安装包后关闭旧版，再运行安装包完成更新。",
      });
    } catch (error) {
      return this.setState({
        phase: "error",
        currentVersion: app.getVersion(),
        availableVersion: this.release?.version,
        installMode: this.installMode,
        message: error instanceof Error ? error.message : "检查软件版本失败",
      });
    }
  }

  async download(): Promise<SoftwareUpdateState> {
    if (!this.release || (this.state.phase !== "available" && this.state.phase !== "error")) {
      throw new Error("请先检查软件更新");
    }
    if (!this.installMode) {
      throw new Error("当前版本仅支持浏览器手动下载");
    }
    const release = this.release;
    const mode = this.installMode;

    if (mode === "electron-updater") {
      this.setState({
        phase: "downloading",
        currentVersion: app.getVersion(),
        availableVersion: release.version,
        installMode: mode,
        percent: 0,
      });
      try {
        await autoUpdater.downloadUpdate();
        return this.setState({
          phase: "ready",
          currentVersion: app.getVersion(),
          availableVersion: release.version,
          installMode: mode,
          percent: 100,
        });
      } catch (error) {
        return this.setState({
          phase: "error",
          currentVersion: app.getVersion(),
          availableVersion: release.version,
          installMode: mode,
          message: error instanceof Error ? error.message : "下载软件更新失败",
        });
      }
    }

    const controller = new AbortController();
    this.downloadAbort = controller;
    this.downloaded = undefined;
    this.setState({
      phase: "downloading",
      currentVersion: app.getVersion(),
      availableVersion: release.version,
      installMode: mode,
      percent: 0,
    });
    try {
      const result = await downloadVerifiedInstaller({
        release,
        cacheDir: this.cacheDir(),
        signal: controller.signal,
        onProgress: (percent) => {
          if (this.state.phase === "downloading") {
            this.setState({ ...this.state, percent });
          }
        },
        onVerifying: () => {
          this.setState({
            phase: "verifying",
            currentVersion: app.getVersion(),
            availableVersion: release.version,
            installMode: mode,
            percent: 100,
          });
        },
      });
      this.downloaded = {
        version: release.version,
        filePath: result.filePath,
        sha256: result.sha256,
        installMode: mode,
        macAppPath: this.macAppPath,
      };
      return this.setState({
        phase: "ready",
        currentVersion: app.getVersion(),
        availableVersion: release.version,
        installMode: mode,
        percent: 100,
        message: "已完成 SHA-256 校验",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return this.setState({
          phase: "available",
          currentVersion: app.getVersion(),
          availableVersion: release.version,
          installMode: mode,
          message: "已取消下载",
        });
      }
      return this.setState({
        phase: "error",
        currentVersion: app.getVersion(),
        availableVersion: release.version,
        installMode: mode,
        message: error instanceof Error ? error.message : "下载软件更新失败",
      });
    } finally {
      if (this.downloadAbort === controller) this.downloadAbort = undefined;
    }
  }

  cancelDownload(): SoftwareUpdateState {
    if (this.downloadAbort) {
      this.downloadAbort.abort();
    }
    return this.getState();
  }

  async install(): Promise<SoftwareUpdateState> {
    if (this.state.phase !== "ready") throw new Error("软件更新尚未下载完成");
    if (this.installMode === "electron-updater") {
      autoUpdater.quitAndInstall(true, true);
      return this.getState();
    }
    const downloaded = this.downloaded;
    if (!downloaded) throw new Error("安装包状态已失效，请重新下载");

    this.setState({
      ...this.state,
      phase: "installing",
      message: "正在复核安装包校验摘要…",
    });

    try {
      await verifyInstallerBeforeLaunch(downloaded.filePath, downloaded.sha256);

      if (process.platform === "darwin") {
        if (downloaded.installMode === "auto-replace" && downloaded.macAppPath) {
          const helper = await prepareMacReplaceHelper({
            cacheDir: this.cacheDir(),
            dmgPath: downloaded.filePath,
            expectedSha256: downloaded.sha256,
            targetAppPath: downloaded.macAppPath,
            currentPid: process.pid,
          });
          const child = spawn(helper.command, helper.args, {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          setTimeout(() => app.quit(), 120);
          return this.setState({
            ...this.state,
            phase: "installing",
            message: "正在替换应用并重启…",
          });
        }
        const openError = await shell.openPath(downloaded.filePath);
        if (openError) throw new Error(`无法打开安装包：${openError}`);
        return this.setState({
          phase: "ready",
          currentVersion: app.getVersion(),
          availableVersion: downloaded.version,
          installMode: "open-installer",
          percent: 100,
          message: "已打开安装包，请将“智枢”拖入“应用程序”完成替换",
        });
      }

      if (process.platform === "win32") {
        const child = spawn(downloaded.filePath, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });
        child.unref();
        setTimeout(() => app.quit(), 150);
        return this.setState({
          ...this.state,
          phase: "installing",
          message: "已启动安装向导，正在关闭旧版…",
        });
      }

      throw new Error("当前平台不支持自动启动安装包");
    } catch (error) {
      return this.setState({
        phase: "error",
        currentVersion: app.getVersion(),
        availableVersion: downloaded.version,
        installMode: downloaded.installMode,
        message: error instanceof Error ? error.message : "启动安装失败",
      });
    }
  }

  async openDownloadPage(): Promise<void> {
    if (!this.release || (this.state.phase !== "manual" && this.state.phase !== "error")) {
      throw new Error("当前没有可手动安装的软件更新");
    }
    let parsed: URL;
    try {
      parsed = new URL(this.release.downloadUrl);
    } catch {
      throw new Error("软件下载地址格式无效");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      throw new Error("软件下载地址不在受信任的 HTTPS 来源范围内");
    }
    await shell.openExternal(parsed.toString());
  }
}
