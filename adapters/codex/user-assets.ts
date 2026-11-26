import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assetFileHashes, readAssetFiles, type UserAssetReceipt } from "../../packages/core/src/user-assets.ts";

const execute = promisify(execFile);
export type CodexRunner = (args: string[]) => Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCodexRelative(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("./") ? trimmed : `./${trimmed}`;
}

/**
 * 为 Codex 原生插件交付补齐 `.codex-plugin/plugin.json`：
 * 实测 Codex CLI / Desktop 仅解析 `.codex-plugin/plugin.json` 中的 `interface` 元数据（含 logo / composerIcon / displayName / brandColor）。
 * 若源包已携带 `.codex-plugin/plugin.json` 则原样保留；若仅有根级 `plugin.json` 则在交付时合成标准 Codex 清单，不污染源包。
 */
export function prepareCodexPluginFiles(sourceFiles: Map<string, Buffer>): Map<string, Buffer> {
  const result = new Map(sourceFiles);
  if (result.has(".codex-plugin/plugin.json")) return result;
  const rootBytes = result.get("plugin.json");
  if (!rootBytes) return result;
  let manifest: unknown;
  try {
    manifest = JSON.parse(rootBytes.toString("utf8"));
  } catch {
    return result;
  }
  if (!isRecord(manifest)) return result;

  const rawInterface = isRecord(manifest.interface) ? manifest.interface : {};
  const displayName =
    (typeof rawInterface.displayName === "string" && rawInterface.displayName.trim()) ||
    (typeof manifest.displayName === "string" && manifest.displayName.trim()) ||
    (typeof manifest.name === "string" ? manifest.name : undefined);
  const logo = normalizeCodexRelative(rawInterface.logo ?? manifest.logo);
  const composerIcon = normalizeCodexRelative(rawInterface.composerIcon ?? rawInterface.logo ?? manifest.logo);
  const developerName =
    (typeof rawInterface.developerName === "string" && rawInterface.developerName.trim()) ||
    (isRecord(manifest.author) && typeof manifest.author.name === "string" && manifest.author.name.trim()) ||
    (typeof manifest.author === "string" && manifest.author.trim()) ||
    undefined;
  const defaultPrompt = Array.isArray(rawInterface.defaultPrompt)
    ? rawInterface.defaultPrompt
    : Array.isArray(manifest.suggestedPrompts)
      ? manifest.suggestedPrompts
      : undefined;

  const codexInterface: Record<string, unknown> = {
    ...rawInterface,
    ...(displayName ? { displayName } : {}),
    ...(developerName ? { developerName } : {}),
    ...(logo ? { logo } : {}),
    ...(composerIcon ? { composerIcon } : {}),
    ...(defaultPrompt ? { defaultPrompt } : {}),
  };

  const codexManifest: Record<string, unknown> = {
    ...manifest,
    skills: normalizeCodexRelative(manifest.skills) ?? "./skills/",
    interface: codexInterface,
  };
  result.set(".codex-plugin/plugin.json", Buffer.from(`${JSON.stringify(codexManifest, null, 2)}\n`));
  return result;
}

export function codexMcpConfigPath(codexHome: string): string {
  return path.join(codexHome, "config.toml");
}

export async function findCodexCli(): Promise<string | undefined> {
  const home = os.homedir();
  const extraDirs =
    process.platform === "win32"
      ? [
          path.join(process.env.APPDATA ?? path.join(home, "AppData/Roaming"), "npm"),
          path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData/Local"), "Volta/bin"),
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          path.join(home, ".local/bin"),
          path.join(home, ".npm-global/bin"),
          path.join(home, ".volta/bin"),
          path.join(home, ".asdf/shims"),
          path.join(home, ".fnm/current/bin"),
        ];
  const directories = [...new Set([...String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...extraDirs])];
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const nativePackage = `codex-${process.platform}-${process.arch}`;
  const triple = process.platform === "win32" ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`
    : process.platform === "darwin" ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-musl`;
  const candidates = [...new Set([
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    ...directories.map((directory) => path.join(directory, executable)),
    ...directories.flatMap((directory) => [path.join(directory, "node_modules"), path.join(directory, "../lib/node_modules")].flatMap((modules) => [
      path.join(modules, "@openai", nativePackage, "vendor", triple, "bin", executable),
      path.join(modules, "@openai/codex/node_modules/@openai", nativePackage, "vendor", triple, "bin", executable),
      path.join(modules, "@openai/codex/vendor", triple, "bin", executable),
    ])),
  ])];
  for (const file of candidates) {
    try {
      await access(file);
      await execute(file, ["plugin", "add", "--help"], { timeout: 10000, maxBuffer: 64 * 1024 });
      return file;
    } catch {
      // 探测下一个已安装的候选二进制文件；绝不自动安装或修复 Codex。
    }
  }
}
export function codexRunner(binary: string, codexHome: string): CodexRunner {
  return async (args) => {
    const result = await execute(binary, args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, CODEX_HOME: codexHome } });
    return result.stdout;
  };
}

/** 在所选用户环境中执行只读技能发现；不启动对话线程或模型请求。 */
export async function discoverCodexSkills(binary: string, userHome: string, codexHome: string): Promise<{ name: string; path: string; scope: string; enabled: boolean }[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server"], { cwd: userHome, env: { ...process.env, HOME: userHome, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "ignore"] });
    const lines = createInterface({ input: child.stdout }); let finished = false; let received = 0;
    const finish = (error?: Error, result: { name: string; path: string; scope: string; enabled: boolean }[] = []) => {
      if (finished) return; finished = true; clearTimeout(timer); lines.close(); child.stdin.end(); child.kill();
      const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 进程已退出 */ } }, 1500);
      killTimer.unref();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("读取 Codex 技能列表超时")), 15000);
    child.on("error", () => finish(new Error("无法启动 Codex 技能检查")));
    child.stdin.on("error", () => finish(new Error("Codex 技能检查连接已关闭")));
    child.on("exit", () => { if (!finished) finish(new Error("Codex 技能检查提前结束")); });
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    lines.on("line", (line) => {
      received += Buffer.byteLength(line);
      if (received > 8 * 1024 * 1024) return finish(new Error("Codex 技能列表超出检查上限"));
      let message: unknown;
      try { message = JSON.parse(line); } catch { return; }
      if (!isRecord(message)) return;
      if (message.id === 1) {
        if (message.error) return finish(new Error("Codex 不支持技能检查协议"));
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "skills/list", params: { cwds: [userHome], forceReload: true } });
      } else if (message.id === 2) {
        if (message.error) return finish(new Error("Codex 无法读取技能列表"));
        const result: { name: string; path: string; scope: string; enabled: boolean }[] = [];
        function collect(value: unknown): void {
          if (Array.isArray(value)) for (const item of value) collect(item);
          else if (isRecord(value)) {
            if (typeof value.name === "string" && typeof value.path === "string" && typeof value.scope === "string") {
              result.push({ name: value.name, path: value.path, scope: value.scope, enabled: value.enabled === true });
            } else {
              for (const nested of Object.values(value)) collect(nested);
            }
          }
        }
        collect(message.result); finish(undefined, result);
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "zhishu-installer", version: "2.1.0" }, capabilities: { experimentalApi: false } } });
  });
}

export class CodexPluginHost {
  constructor(private readonly run: CodexRunner, private readonly codexHome: string) {}
  private identity(name: string): { marketplace: string; pluginId: string; cache: string } {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("Codex 插件名称无效");
    const marketplace = `zhishu-${name}`;
    return { marketplace, pluginId: `${name}@${marketplace}`, cache: path.join(this.codexHome, "plugins/cache", marketplace, name) };
  }
  async inspect(name: string): Promise<{ installed: boolean; enabled: boolean; source?: string; cached: boolean }> {
    const identity = this.identity(name);
    const result: unknown = JSON.parse(await this.run(["plugin", "list", "--marketplace", identity.marketplace, "--available", "--json"]));
    if (!isRecord(result) || !Array.isArray(result.installed)) throw new Error("Codex 返回的插件状态不受支持");
    const available = Array.isArray(result.available) ? result.available : [];
    const item = [...result.installed, ...available].find((value): value is Record<string, unknown> => isRecord(value) && value.pluginId === identity.pluginId);
    const source = item && isRecord(item.marketplaceSource) && typeof item.marketplaceSource.source === "string"
      ? item.marketplaceSource.source
      : undefined;
    return { installed: item?.installed === true, enabled: item?.enabled === true, source, cached: (await readAssetFiles(identity.cache)).size > 0 };
  }
  async validate(name: string, receipt: UserAssetReceipt): Promise<string[]> {
    const identity = this.identity(name);
    if (!receipt.host || receipt.host.pluginId !== identity.pluginId || receipt.host.cachePath !== identity.cache) return ["Codex 安装记录缺少有效的宿主信息"];
    const state = await this.inspect(name);
    const problems: string[] = [];
    if (!state.installed) problems.push("Codex 中已找不到该插件");
    if (state.source && path.resolve(state.source) !== path.resolve(receipt.destination)) problems.push("Codex 插件来源已被修改");
    const hashes = assetFileHashes(await readAssetFiles(identity.cache));
    if (JSON.stringify(hashes) !== JSON.stringify(receipt.host.files)) problems.push("Codex 插件缓存已缺失、漂移或出现未知内容");
    return problems;
  }
  async install(name: string, destination: string, sourceFiles: Map<string, Buffer>): Promise<NonNullable<UserAssetReceipt["host"]>> {
    const identity = this.identity(name);
    await this.run(["plugin", "marketplace", "add", destination]);
    const result: unknown = JSON.parse(await this.run(["plugin", "add", identity.pluginId, "--json"]));
    if (!isRecord(result) || result.pluginId !== identity.pluginId || typeof result.installedPath !== "string" || path.dirname(result.installedPath) !== identity.cache) {
      throw new Error("Codex 安装结果与目标不一致");
    }
    const installed = await readAssetFiles(result.installedPath);
    for (const [file, bytes] of sourceFiles) if (!installed.get(file)?.equals(bytes)) throw new Error(`Codex 未正确安装源文件：${file}`);
    const state = await this.inspect(name);
    if (!state.installed || !state.enabled) throw new Error("Codex 未确认插件安装成功");
    return { pluginId: identity.pluginId, cachePath: identity.cache, activePath: result.installedPath, files: assetFileHashes(await readAssetFiles(identity.cache)) };
  }
  async remove(name: string): Promise<void> {
    const identity = this.identity(name);
    if ((await this.inspect(name)).installed) await this.run(["plugin", "remove", identity.pluginId, "--json"]);
    await this.run(["plugin", "marketplace", "remove", identity.marketplace]);
  }
}
