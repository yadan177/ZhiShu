import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

interface McpOperationsOptions {
  userHome?: string;
  codexHome?: string;
}

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
  private running = false;

  constructor(private readonly stateRoot: string, options: McpOperationsOptions = {}) {
    const userHome = options.userHome ?? os.homedir();
    const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(userHome, ".codex");
    this.catalogFile = path.join(stateRoot, "catalog.json");
    this.engine = new McpConfigEngine(path.join(stateRoot, "receipts"), {
      antigravity: antigravityMcpConfigPath(userHome),
      codex: codexMcpConfigPath(codexHome),
    });
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error("MCP 配置操作正在进行，请稍候");
    this.running = true;
    try {
      return await action();
    } finally {
      this.running = false;
    }
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

  async listCatalog(): Promise<McpServerDefinition[]> {
    const custom = await this.loadCustomServers();
    return [FEISHU_MCP_PRESET, ...custom];
  }

  async saveCustomServer(definition: McpServerDefinition): Promise<McpServerDefinition[]> {
    return this.serialized(async () => {
      assertMcpServerDefinition(definition);
      if (definition.id === FEISHU_MCP_PRESET.id) {
        throw new Error("内置预设飞书 MCP 不可覆盖");
      }
      const existing = await this.loadCustomServers();
      const next = [...existing.filter((item) => item.id !== definition.id), { ...definition, preset: false }];
      await this.writeCustomServers(next);
      return this.listCatalog();
    });
  }

  async removeCustomServer(id: string): Promise<McpServerDefinition[]> {
    return this.serialized(async () => {
      if (id === FEISHU_MCP_PRESET.id) throw new Error("内置预设飞书 MCP 不可删除");
      const installed = await this.engine.list();
      if (installed.some((item) => item.id === id)) {
        throw new Error("请先从对应 AI 工具卸载此 MCP，再从目录删除");
      }
      const existing = await this.loadCustomServers();
      const next = existing.filter((item) => item.id !== id);
      await this.writeCustomServers(next);
      return this.listCatalog();
    });
  }

  async listInstalled(): Promise<InstalledMcpRecord[]> {
    return this.engine.list();
  }

  async preview(
    action: "install" | "update" | "uninstall",
    serverId: string,
    toolId: McpToolId,
    envValues: Record<string, string> = {},
  ): Promise<McpPreview> {
    return this.serialized(async () => {
      const catalog = await this.listCatalog();
      let definition = catalog.find((item) => item.id === serverId);
      if (!definition && action === "uninstall") {
        const installed = (await this.engine.list()).find((item) => item.id === serverId && item.toolId === toolId);
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
      return this.engine.preview(action, toolId, definition, envValues);
    });
  }

  async apply(token: string): Promise<InstalledMcpRecord[]> {
    return this.serialized(async () => {
      await this.engine.apply(token);
      return this.engine.list();
    });
  }
}
