import { lstat, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  antigravityDelivery,
  antigravityPluginRoot,
  antigravitySkillRoot,
} from "../../../adapters/antigravity/user-assets.ts";
import { CodexPluginHost, codexRunner, discoverCodexSkills, findCodexCli } from "../../../adapters/codex/user-assets.ts";
import { traeWorkDelivery, traeWorkSkillRoot } from "../../../adapters/traework/user-assets.ts";
import {
  UserAssetStore,
  assertAssetDirectory,
  assetDigest,
  assetFileHashes,
  readAssetFiles,
  type UserAssetDelivery,
  type UserAssetPreview,
  type UserAssetReceipt,
} from "../../core/src/user-assets.ts";
import type { PluginLibrary } from "./plugin-library.ts";

export type UserAssetIde = "codex" | "antigravity" | "traework" | "generic";
export type InstalledUserAsset = UserAssetReceipt & {
  issues: string[];
  recognition: "files-verified" | "host-verified";
  recognitionNote?: string;
  runtimeVerified: false;
};
export interface LegacyAssetCandidate {
  key: string;
  kind: "legacy-receipt" | "unmanaged-official";
  assetKind: "skill" | "capability-plugin";
  ideId: UserAssetIde;
  id: string;
  title: string;
  version: string;
  destination: string;
  originLabel: string;
  issues: string[];
}
export interface LegacyAdoptResult {
  adoptedCount: number;
  assets: InstalledUserAsset[];
  legacy: LegacyAssetCandidate[];
}
type ScannedLegacyRecord = { candidate: LegacyAssetCandidate; receipt: UserAssetReceipt };
type Options = {
  userHome?: string;
  codexHome?: string;
  host?: CodexPluginHost;
  findCli?: typeof findCodexCli;
  legacyReceiptDirs?: string[];
};

const SUPPORTED_IDES: readonly UserAssetIde[] = ["codex", "antigravity", "traework", "generic"];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AssetOperations {
  private store: UserAssetStore;
  private userHome: string;
  private codexHome: string;
  private host?: CodexPluginHost;
  private pending?: { preview: UserAssetPreview; delivery: UserAssetDelivery; name: string; sourceFiles: Map<string, Buffer>; previous?: UserAssetReceipt };
  private running = false;

  constructor(private readonly library: PluginLibrary, private readonly stateRoot: string, private readonly options: Options = {}) {
    this.userHome = options.userHome ?? os.homedir();
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(this.userHome, ".codex");
    this.host = options.host;
    const sharedSkillRoot = path.join(this.userHome, ".agents/skills");
    this.store = new UserAssetStore(path.join(stateRoot, "receipts"), {
      codex: [sharedSkillRoot, path.join(stateRoot, "codex")],
      antigravity: [antigravitySkillRoot(this.userHome), antigravityPluginRoot(this.userHome)],
      traework: [traeWorkSkillRoot(this.userHome)],
      generic: [sharedSkillRoot],
    });
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error("资产操作仍在进行，请稍后重试");
    this.running = true;
    try { return await action(); }
    finally { this.running = false; }
  }

  private async codexHost(): Promise<CodexPluginHost> {
    if (this.host) return this.host;
    const binary = await (this.options.findCli ?? findCodexCli)();
    if (!binary) throw new Error("未找到支持插件安装的 Codex CLI；请安装或更新 Codex 后重试");
    this.host = new CodexPluginHost(codexRunner(binary, this.codexHome), this.codexHome);
    return this.host;
  }

  private resolveLegacyReceiptDirs(): string[] {
    if (this.options.legacyReceiptDirs) return this.options.legacyReceiptDirs;
    const userDataDir = path.dirname(this.stateRoot);
    if (path.basename(userDataDir) === "智枢") {
      return [path.join(path.dirname(userDataDir), "zhishu-desktop", "ide-assets", "receipts")];
    }
    return [];
  }

  private allowedRootsForIde(ideId: UserAssetIde): string[] {
    const sharedSkillRoot = path.join(this.userHome, ".agents/skills");
    if (ideId === "codex") return [sharedSkillRoot, path.join(this.stateRoot, "codex")];
    if (ideId === "antigravity") return [antigravitySkillRoot(this.userHome), antigravityPluginRoot(this.userHome)];
    if (ideId === "traework") return [traeWorkSkillRoot(this.userHome)];
    return [sharedSkillRoot];
  }

  private isAllowedDestination(ideId: UserAssetIde, destination: string): boolean {
    if (!path.isAbsolute(destination) || path.resolve(destination) !== destination) return false;
    return this.allowedRootsForIde(ideId).some((root) => destination.startsWith(`${path.resolve(root)}${path.sep}`));
  }

  /** 严格只读扫描旧版回执目录与未纳管的官方预设插件，绝不修改任何磁盘文件。 */
  private async scanLegacyRecords(): Promise<ScannedLegacyRecord[]> {
    const existing = await this.store.list();
    const existingKeys = new Set(existing.map((item) => `${item.target.ideId}:${item.id}`));
    const found = new Map<string, ScannedLegacyRecord>();

    // 1. 扫描旧版 userData（如 zhishu-desktop）遗留回执
    for (const legacyDir of this.resolveLegacyReceiptDirs()) {
      let entries: string[];
      try {
        const info = await lstat(legacyDir);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        entries = await readdir(legacyDir);
      } catch {
        continue;
      }
      for (const entry of entries.sort()) {
        const match = /^([a-z0-9-]+)--([a-z0-9-]+)\.json$/.exec(entry);
        if (!match?.[1] || !match[2]) continue;
        const ideId = match[1] as UserAssetIde;
        const id = match[2];
        if (!SUPPORTED_IDES.includes(ideId)) continue;
        const key = `${ideId}:${id}`;
        if (existingKeys.has(key) || found.has(key)) continue;
        const filePath = path.join(legacyDir, entry);
        try {
          const stat = await lstat(filePath);
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
          if (
            !isPlainObject(raw) ||
            raw.id !== id ||
            !isPlainObject(raw.target) ||
            raw.target.ideId !== ideId ||
            raw.target.scope !== "ide-user" ||
            (raw.kind !== "skill" && raw.kind !== "capability-plugin") ||
            typeof raw.title !== "string" ||
            typeof raw.version !== "string" ||
            typeof raw.destination !== "string" ||
            typeof raw.sourceKey !== "string" ||
            typeof raw.sourceDigest !== "string" ||
            !isPlainObject(raw.managedFiles)
          ) {
            continue;
          }
          if (!this.isAllowedDestination(ideId, raw.destination)) continue;
          const diskFiles = await readAssetFiles(raw.destination);
          if (!diskFiles.size) continue;
          const receipt = raw as unknown as UserAssetReceipt;
          const issues = await this.store.validate(receipt);
          found.set(key, {
            receipt,
            candidate: {
              key,
              kind: "legacy-receipt",
              assetKind: receipt.kind,
              ideId,
              id: receipt.id,
              title: receipt.title,
              version: receipt.version,
              destination: receipt.destination,
              originLabel: "旧版回执",
              issues,
            },
          });
        } catch {
          // 跳过损坏、超限或含符号链接的旧版回执文件，绝不阻塞正常页面加载。
        }
      }
    }

    // 2. 扫描 Antigravity 目录中未纳管的智枢官方预设插件（严格校验 author.name === "智枢官方" 且在官方预设名录中）
    const agyPluginsRoot = antigravityPluginRoot(this.userHome);
    try {
      await assertAssetDirectory(agyPluginsRoot);
      const rootInfo = await lstat(agyPluginsRoot);
      if (rootInfo.isDirectory() && !rootInfo.isSymbolicLink()) {
        const presetNames = new Set(
          (await this.library.list())
            .filter((item) => item.preset && item.kind === "capability-plugin")
            .map((item) => item.name),
        );
        const dirs = await readdir(agyPluginsRoot, { withFileTypes: true });
        for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
          if (!/^zhishu-[a-z0-9-]+$/.test(dir.name) || !presetNames.has(dir.name)) continue;
          const id = `plugin-${dir.name}`;
          const key = `antigravity:${id}`;
          if (existingKeys.has(key) || found.has(key)) continue;
          const candidateDir = path.join(agyPluginsRoot, dir.name);
          try {
            const files = await readAssetFiles(candidateDir);
            const manifestBytes = files.get("plugin.json");
            if (!manifestBytes) continue;
            const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
            if (!isPlainObject(manifest)) continue;
            if (manifest.name !== dir.name) continue;
            if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) continue;
            if (!isPlainObject(manifest.author) || manifest.author.name !== "智枢官方") continue;
            const iface = isPlainObject(manifest.interface) ? manifest.interface : undefined;
            const title =
              (iface && typeof iface.displayName === "string" && iface.displayName.trim()) ||
              (typeof manifest.displayName === "string" && manifest.displayName.trim()) ||
              dir.name;
            const managedFiles = assetFileHashes(files);
            const managedModes =
              process.platform === "win32"
                ? undefined
                : Object.fromEntries(
                    [...files].map(([file, data]) => [
                      file,
                      (data as Buffer & { assetFileMode?: number }).assetFileMode ?? 0o644,
                    ]),
                  );
            const receipt: UserAssetReceipt = {
              id,
              kind: "capability-plugin",
              title,
              version: manifest.version,
              target: { ideId: "antigravity", scope: "ide-user" },
              installedAt: new Date().toISOString(),
              destination: candidateDir,
              sourceKey: `${dir.name}@${manifest.version}`,
              sourceDigest: assetDigest(JSON.stringify(Object.entries(managedFiles))),
              managedFiles,
              ...(managedModes ? { managedModes } : {}),
            };
            found.set(key, {
              receipt,
              candidate: {
                key,
                kind: "unmanaged-official",
                assetKind: "capability-plugin",
                ideId: "antigravity",
                id,
                title,
                version: manifest.version,
                destination: candidateDir,
                originLabel: "未纳管官方插件",
                issues: [],
              },
            });
          } catch {
            // 跳过不可读、损坏或含符号链接的插件目录。
          }
        }
      }
    } catch {
      // 目标工具目录尚未创建或不可读时静默忽略。
    }

    return [...found.values()].sort((a, b) =>
      a.candidate.ideId.localeCompare(b.candidate.ideId) || a.candidate.title.localeCompare(b.candidate.title),
    );
  }

  async inspectLegacy(): Promise<LegacyAssetCandidate[]> {
    return (await this.scanLegacyRecords()).map((entry) => entry.candidate);
  }

  async adoptLegacy(keys?: string[]): Promise<LegacyAdoptResult> {
    return this.serialized(async () => {
      const scanned = await this.scanLegacyRecords();
      let selected: ScannedLegacyRecord[];
      if (keys === undefined) {
        selected = scanned;
      } else {
        const uniqueKeys = [...new Set(keys)];
        const byKey = new Map(scanned.map((entry) => [entry.candidate.key, entry]));
        selected = [];
        for (const key of uniqueKeys) {
          const hit = byKey.get(key);
          if (!hit) throw new Error("所选旧版记录已失效或已被接管，请重新检查");
          selected.push(hit);
        }
      }
      for (const entry of selected) {
        await this.store.adoptReceipt(entry.receipt);
      }
      const [assets, legacy] = await Promise.all([this.list(), this.inspectLegacy()]);
      return { adoptedCount: selected.length, assets, legacy };
    });
  }

  async list(): Promise<InstalledUserAsset[]> {
    const result: InstalledUserAsset[] = [];
    const records = await this.store.list();
    let discovered: Awaited<ReturnType<typeof discoverCodexSkills>> | undefined;
    if (records.some((item) => item.kind === "skill" && item.target.ideId === "codex")) {
      const binary = await (this.options.findCli ?? findCodexCli)();
      if (binary) {
        try {
          discovered = await discoverCodexSkills(binary, this.userHome, this.codexHome);
        } catch {
          // 宿主暂不可查询时仍保留本地文件完整性核验结果。
        }
      }
    }
    for (const receipt of records) {
      const issues: string[] = [];
      try {
        issues.push(...await this.store.validate(receipt));
        if (receipt.target.ideId === "codex" && receipt.kind === "capability-plugin") {
          issues.push(...await (await this.codexHost()).validate(receipt.id.replace(/^plugin-/, ""), receipt));
        }
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
      const skill = discovered?.find((item) => item.scope === "user" && item.path === path.join(receipt.destination, "SKILL.md"));
      result.push({
        ...receipt,
        issues,
        recognition: receipt.host || skill?.enabled ? "host-verified" : "files-verified",
        recognitionNote: skill && !skill.enabled ? "Skill 已被 Codex 全局停用；安装文件仍保留。" : undefined,
        runtimeVerified: false,
      });
    }
    return result;
  }

  async preview(action: UserAssetPreview["action"], key: string, ide: UserAssetIde, installedId?: string): Promise<UserAssetPreview> {
    return this.serialized(async () => {
      this.pending = undefined;
      if (!["install", "update", "uninstall"].includes(action) || !SUPPORTED_IDES.includes(ide)) {
        throw new Error("资产操作或目标软件无效");
      }
      const previous = (await this.store.list()).find((item) => item.id === installedId && item.target.ideId === ide);
      if (action !== "install" && !previous) throw new Error("请从已安装列表选择内容");
      let delivery: UserAssetDelivery;
      let name: string;
      let sourceFiles: Map<string, Buffer>;
      if (action === "uninstall") {
        if (!previous) throw new Error("请从已安装列表选择内容");
        delivery = {
          manifest: {
            schemaVersion: 1,
            id: previous.id,
            kind: previous.kind,
            version: previous.version,
            title: previous.title,
            supportedIdes: [ide],
            dependencies: [],
            requiredTools: [],
            ruleCategories: [],
          },
          destination: previous.destination,
          sourceKey: previous.sourceKey,
          sourceDigest: previous.sourceDigest,
          files: new Map(),
        };
        name = previous.id.replace(/^plugin-/, "").replace(/^skill-/, "");
        sourceFiles = new Map();
      } else {
        const snapshot = await this.library.snapshot(key);
        const source = snapshot.receipt;
        name = source.name;
        sourceFiles = snapshot.files;
        let files = new Map(sourceFiles);
        let kind: "skill" | "capability-plugin" = source.kind;
        let destination: string;
        if (ide === "traework") {
          const adapted = traeWorkDelivery(source, files);
          name = adapted.name;
          files = adapted.files;
          kind = "skill";
          if (source.kind === "capability-plugin") {
            files.set("provenance.json", Buffer.from(`${JSON.stringify({
              ...source,
              adapter: "traework-product-design-v1",
              deliveryKind: "skill",
              runtime: "local",
              verification: "files-installed-not-runtime-verified",
            }, null, 2)}\n`));
          }
          destination = path.join(traeWorkSkillRoot(this.userHome), name);
        } else if (ide === "antigravity") {
          const adapted = antigravityDelivery(source, files);
          name = adapted.name;
          files = adapted.files;
          kind = adapted.kind;
          destination = path.join(
            kind === "skill" ? antigravitySkillRoot(this.userHome) : antigravityPluginRoot(this.userHome),
            name,
          );
        } else if (ide === "generic") {
          if (source.kind !== "skill") {
            throw new Error("通用目录仅支持独立 Skill；安装插件请选择 Codex 或 Antigravity");
          }
          destination = path.join(this.userHome, ".agents/skills", name);
        } else if (source.kind === "skill") {
          destination = path.join(this.userHome, ".agents/skills", name);
          // 避免与旧版 Codex 用户技能目录中的同名技能重复共存。
          if ((await readAssetFiles(path.join(this.codexHome, "skills", name))).size) {
            throw new Error("旧 Codex 用户技能目录已有同名内容，请先处理，未覆盖");
          }
        } else {
          const host = await this.codexHost();
          const state = await host.inspect(name);
          if (!previous && (state.installed || state.source || state.cached)) {
            throw new Error("Codex 已有同名智枢插件、市场或缓存，拒绝接管未知安装");
          }
          if (previous && state.installed && !state.enabled) {
            throw new Error("此插件已在 Codex 中停用，请在软件中处理后再更新");
          }
          destination = path.join(this.stateRoot, "codex", name);
          const catalog = {
            name: `zhishu-${name}`,
            plugins: [{
              name,
              source: { source: "local", path: `./plugins/${name}` },
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
              category: "Productivity",
            }],
          };
          files = new Map([...sourceFiles].map(([file, data]) => [`plugins/${name}/${file}`, data]));
          files.set(".agents/plugins/marketplace.json", Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`));
        }
        const id = `${kind === "skill" ? "skill" : "plugin"}-${name}`;
        if (previous && previous.id !== id) throw new Error("更新来源的名称或类型与已安装内容不一致");
        delivery = {
          manifest: {
            schemaVersion: 1,
            id,
            kind,
            version: source.version,
            title: source.title,
            supportedIdes: [ide],
            dependencies: [],
            requiredTools: [],
            ruleCategories: [],
          },
          destination,
          sourceKey: key,
          sourceDigest: source.sourceDigest,
          files,
        };
      }
      const preview = await this.store.preview(action, ide, delivery);
      if (previous?.host) preview.conflicts.push(...await (await this.codexHost()).validate(name, previous));
      this.pending = { preview, delivery, name, sourceFiles, previous };
      return preview;
    });
  }

  async apply(token: string): Promise<InstalledUserAsset[]> {
    return this.serialized(async () => {
      const pending = this.pending;
      if (!pending || token !== pending.preview.token) throw new Error("预览已失效，请重新预览");
      const { preview, delivery, name, previous, sourceFiles } = pending;
      if (preview.action !== "uninstall" && (await this.library.snapshot(delivery.sourceKey)).receipt.sourceDigest !== delivery.sourceDigest) {
        throw new Error("来源在预览后发生变化");
      }
      const isPlugin = preview.ideId === "codex" && delivery.manifest.kind === "capability-plugin";
      const host = isPlugin ? await this.codexHost() : undefined;
      if (host && !previous) {
        const state = await host.inspect(name);
        if (state.installed || state.source || state.cached) throw new Error("Codex 安装状态在预览后发生变化，请重新预览");
      }
      if (previous?.host && (!host || (await host.validate(name, previous)).length)) {
        throw new Error("Codex 安装状态在预览后发生变化，请重新预览");
      }
      if (host && previous && preview.action === "update" && !(await host.inspect(name)).enabled) {
        throw new Error("Codex 插件在预览后被停用，请重新预览");
      }
      await this.store.apply(
        token,
        host
          ? async (next) => {
              if (next) return host.install(name, next.destination, sourceFiles);
              await host.remove(name);
            }
          : undefined,
        host
          ? async (old) => {
              if (!old) {
                try {
                  await host.remove(name);
                } catch {
                  // 回滚清理失败时不覆盖主流程的原始错误。
                }
              } else {
                const restored = await readAssetFiles(path.join(old.destination, "plugins", name));
                await host.install(name, old.destination, restored);
              }
            }
          : undefined,
      );
      this.pending = undefined;
      return this.list();
    });
  }
}
