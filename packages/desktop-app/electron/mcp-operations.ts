import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { antigravityMcpConfigPath } from "../../../adapters/antigravity/user-assets.ts";
import { codexMcpConfigPath } from "../../../adapters/codex/user-assets.ts";
import {
  FEISHU_MCP_PRESET,
  McpConfigEngine,
  assertAssetDirectory,
  assertMcpServerDefinition,
  type McpPreview,
  type McpReceipt,
  type McpServerDefinition,
  type McpToolId,
} from "../../core/src/index.ts";

export type InstalledMcpRecord = McpReceipt & { issues: string[] };

export interface LegacyMcpCandidate {
  key: string;
  toolId: McpToolId;
  id: string;
  title: string;
  version: string;
  transport: "stdio" | "http";
  targetPath: string;
  originLabel: string;
  issues: string[];
}

export interface LegacyMcpAdoptResult {
  adoptedCount: number;
  mcps: InstalledMcpRecord[];
  legacy: LegacyMcpCandidate[];
}

interface McpOperationsOptions {
  userHome?: string;
  codexHome?: string;
  legacyReceiptDirs?: string[];
}

const SUPPORTED_MCP_TOOLS: readonly McpToolId[] = ["antigravity", "codex"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class McpOperations {
  private readonly catalogFile: string;
  private readonly engine: McpConfigEngine;
  private readonly targets: Record<McpToolId, string>;
  private queue: Promise<unknown> = Promise.resolve();
  private mutating = false;

  constructor(private readonly stateRoot: string, private readonly options: McpOperationsOptions = {}) {
    const userHome = options.userHome ?? os.homedir();
    const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(userHome, ".codex");
    this.catalogFile = path.join(stateRoot, "catalog.json");
    this.targets = {
      antigravity: antigravityMcpConfigPath(userHome),
      codex: codexMcpConfigPath(codexHome),
    };
    this.engine = new McpConfigEngine(path.join(stateRoot, "receipts"), this.targets);
  }

  private enqueueRead<T>(action: () => Promise<T>): Promise<T> {
    const job = this.queue.then(action, action);
    this.queue = job.catch(() => {});
    return job;
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.mutating) throw new Error("MCP 配置操作正在进行，请稍候");
    this.mutating = true;
    const run = async (): Promise<T> => {
      try {
        return await action();
      } finally {
        this.mutating = false;
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  private resolveLegacyReceiptDirs(): string[] {
    if (this.options.legacyReceiptDirs) return this.options.legacyReceiptDirs;
    const userDataDir = path.dirname(this.stateRoot);
    if (path.basename(userDataDir) === "智枢") {
      return [path.join(path.dirname(userDataDir), "zhishu-desktop", "mcp-assets", "receipts")];
    }
    return [];
  }

  private async loadCustomServers(): Promise<McpServerDefinition[]> {
    await assertAssetDirectory(this.stateRoot);
    if (!(await fileExists(this.catalogFile))) return [];
    const info = await lstat(this.catalogFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("MCP 目录文件不是普通文件");
    const parsed: unknown = JSON.parse(await readFile(this.catalogFile, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.servers)) {
      throw new Error("MCP 目录文件格式损坏");
    }
    const items: McpServerDefinition[] = [];
    for (const entry of parsed.servers) {
      assertMcpServerDefinition(entry);
      if (entry.id !== FEISHU_MCP_PRESET.id) items.push({ ...entry, preset: false });
    }
    return items.sort((left, right) => left.title.localeCompare(right.title));
  }

  private async writeCustomServers(servers: McpServerDefinition[]): Promise<void> {
    await assertAssetDirectory(this.stateRoot);
    await mkdir(this.stateRoot, { recursive: true });
    if (await fileExists(this.catalogFile)) {
      const info = await lstat(this.catalogFile);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("MCP 目录文件不是普通文件");
    }
    const temporary = `${this.catalogFile}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify({ schemaVersion: 1, servers }, null, 2)}\n`;
    try {
      await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.catalogFile);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async listCatalogUnlocked(): Promise<McpServerDefinition[]> {
    const custom = await this.loadCustomServers();
    return [FEISHU_MCP_PRESET, ...custom];
  }

  async listCatalog(): Promise<McpServerDefinition[]> {
    return this.enqueueRead(() => this.listCatalogUnlocked());
  }

  async saveCustomServer(
    definition: McpServerDefinition,
    options: { updateExisting?: boolean } = {},
  ): Promise<McpServerDefinition[]> {
    return this.serialized(async () => {
      assertMcpServerDefinition(definition);
      if (definition.id === FEISHU_MCP_PRESET.id) {
        throw new Error("内置预设飞书 MCP 不可覆盖");
      }
      const existing = await this.loadCustomServers();
      const existsAlready = existing.some((item) => item.id === definition.id);
      if (existsAlready && !options.updateExisting) {
        throw new Error(`自定义 MCP「${definition.id}」已存在，请更换标识或使用编辑功能`);
      }
      const next = [...existing.filter((item) => item.id !== definition.id), { ...definition, preset: false }];
      await this.writeCustomServers(next);
      return this.listCatalogUnlocked();
    });
  }

  async removeCustomServer(id: string): Promise<McpServerDefinition[]> {
    return this.serialized(async () => {
      if (id === FEISHU_MCP_PRESET.id) throw new Error("内置预设飞书 MCP 不可删除");
      const installed = await this.engine.list();
      if (installed.some((item) => item.id === id)) {
        throw new Error("请先从对应 AI 工具卸载或清除此 MCP 记录，再从目录删除");
      }
      const existing = await this.loadCustomServers();
      const next = existing.filter((item) => item.id !== id);
      await this.writeCustomServers(next);
      return this.listCatalogUnlocked();
    });
  }

  async listInstalled(): Promise<InstalledMcpRecord[]> {
    return this.enqueueRead(() => this.engine.list());
  }

  async clearPreview(): Promise<void> {
    this.engine.clearPending();
  }

  async forgetReceipt(toolId: McpToolId, id: string): Promise<InstalledMcpRecord[]> {
    return this.serialized(async () => {
      await this.engine.forgetReceipt(toolId, id);
      return this.engine.list();
    });
  }

  private async scanLegacyReceiptsUnlocked(): Promise<Array<{ candidate: LegacyMcpCandidate; receipt: McpReceipt }>> {
    const installed = await this.engine.list();
    const installedKeys = new Set(installed.map((item) => `${item.toolId}:${item.id}`));
    const found = new Map<string, { candidate: LegacyMcpCandidate; receipt: McpReceipt }>();

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
        const match = /^(antigravity|codex)--([a-z0-9-]+)\.json$/.exec(entry);
        if (!match?.[1] || !match[2]) continue;
        const toolId = match[1] as McpToolId;
        const id = match[2];
        if (!SUPPORTED_MCP_TOOLS.includes(toolId)) continue;
        const key = `${toolId}:${id}`;
        if (installedKeys.has(key) || found.has(key)) continue;
        const filePath = path.join(legacyDir, entry);
        try {
          const stat = await lstat(filePath);
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
          if (
            !isRecord(raw) ||
            raw.schemaVersion !== 1 ||
            raw.id !== id ||
            raw.toolId !== toolId ||
            typeof raw.title !== "string" ||
            typeof raw.version !== "string" ||
            typeof raw.targetPath !== "string" ||
            (raw.transport !== "stdio" && raw.transport !== "http") ||
            typeof raw.installedAt !== "string" ||
            typeof raw.managedEntryDigest !== "string" ||
            !/^sha256:[a-f0-9]{64}$/.test(raw.managedEntryDigest) ||
            !Array.isArray(raw.envKeys) ||
            !Array.isArray(raw.secretKeys)
          ) {
            continue;
          }
          if (path.resolve(raw.targetPath) !== path.resolve(this.targets[toolId])) continue;
          const receipt = raw as unknown as McpReceipt;
          const issues = await this.engine.validate(receipt);
          // 跳过幽灵回执（目标配置文件缺失或已不含该 MCP 项）
          if (issues.some((msg) => msg.includes("配置文件缺失") || msg.includes("缺少受管 MCP"))) {
            continue;
          }
          found.set(key, {
            receipt,
            candidate: {
              key,
              toolId,
              id: receipt.id,
              title: receipt.title,
              version: receipt.version,
              transport: receipt.transport,
              targetPath: receipt.targetPath,
              originLabel: "旧版 MCP 回执",
              issues,
            },
          });
        } catch {
          // 跳过损坏或含符号链接的旧版回执
        }
      }
    }

    return [...found.values()].sort(
      (a, b) => a.candidate.toolId.localeCompare(b.candidate.toolId) || a.candidate.title.localeCompare(b.candidate.title),
    );
  }

  async inspectLegacy(): Promise<LegacyMcpCandidate[]> {
    return this.enqueueRead(async () => (await this.scanLegacyReceiptsUnlocked()).map((item) => item.candidate));
  }

  async adoptLegacy(keys?: string[]): Promise<LegacyMcpAdoptResult> {
    return this.serialized(async () => {
      const scanned = await this.scanLegacyReceiptsUnlocked();
      let selected: Array<{ candidate: LegacyMcpCandidate; receipt: McpReceipt }>;
      if (keys === undefined) {
        selected = scanned;
      } else {
        const uniqueKeys = [...new Set(keys)];
        const byKey = new Map(scanned.map((entry) => [entry.candidate.key, entry]));
        selected = [];
        for (const key of uniqueKeys) {
          const hit = byKey.get(key);
          if (!hit) throw new Error("所选旧版 MCP 记录已失效或已被接管，请重新检查");
          selected.push(hit);
        }
      }
      for (const entry of selected) {
        await this.engine.adoptReceipt(entry.receipt);
      }
      const [mcps, legacy] = await Promise.all([this.engine.list(), this.scanLegacyReceiptsUnlocked()]);
      return { adoptedCount: selected.length, mcps, legacy: legacy.map((item) => item.candidate) };
    });
  }

  async preview(
    action: "install" | "update" | "uninstall",
    serverId: string,
    toolId: McpToolId,
    envValues: Record<string, string> = {},
    options: { force?: boolean } = {},
  ): Promise<McpPreview> {
    return this.serialized(async () => {
      const catalog = await this.listCatalogUnlocked();
      const installedList = await this.engine.list();
      let definition = catalog.find((item) => item.id === serverId);
      if (!definition && action === "uninstall") {
        const installed = installedList.find((item) => item.id === serverId && item.toolId === toolId);
        if (installed) {
          definition = {
            schemaVersion: 1,
            id: installed.id,
            title: installed.title,
            version: installed.version,
            transport: installed.transport,
            command: installed.transport === "stdio" ? "unused" : undefined,
            url: installed.transport === "http" ? "https://localhost" : undefined,
            envSchema: [],
          };
        }
      }
      if (!definition) throw new Error(`未找到 MCP 定义：${serverId}`);
      const allSchemas = new Map(catalog.map((item) => [item.id, item.envSchema] as const));
      const allSecretKeys = new Map<string, string[]>();
      for (const rec of installedList) {
        if (rec.secretKeys.length > 0) {
          const prev = allSecretKeys.get(rec.id) ?? [];
          allSecretKeys.set(rec.id, [...new Set([...prev, ...rec.secretKeys])]);
        }
      }
      return this.engine.preview(action, toolId, definition, envValues, {
        allowConflictOverride: options.force === true,
        allSchemas,
        allSecretKeys,
      });
    });
  }

  async apply(token: string): Promise<InstalledMcpRecord[]> {
    return this.serialized(async () => {
      await this.engine.apply(token);
      return this.engine.list();
    });
  }
}
