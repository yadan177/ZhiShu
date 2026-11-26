import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from "electron";
import path from "node:path";
import { lstatSync, mkdirSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { DesktopOperations, STACK_PACKS, inspectProjectRoot, inspectWorkspaceSource, loadLatestSource } from "./operations.ts";
import type { InstallRequest, PlatformChoice, RuleSourceChoice, StackChoice } from "./operations.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { PluginLibrary } from "./plugin-library.ts";
import type { PluginInspection } from "./plugin-library.ts";
import { AssetOperations, type UserAssetIde } from "./asset-operations.ts";
import { McpOperations } from "./mcp-operations.ts";
import { SourceManager, type AddSourceInput, type TestSourceInput, type UpdateSourceInput } from "./source-manager.ts";
import { EvolutionOperations } from "./evolution-operations.ts";
import { ToolInspector } from "./tool-inspector.ts";
import { SoftwareUpdateService } from "./software-update.ts";
import { electronFetch, electronGenericFetch } from "./electron-fetch.ts";
import {
  findLatestRelease,
  type EvolutionPatchEdit,
  type EvolutionTargetSource,
  type McpServerDefinition,
  type McpToolId,
  type WatchSourceConfig,
} from "../../core/src/index.ts";

const operations = new DesktopOperations(
  (release) => loadLatestSource(release, electronFetch),
  (repo) => findLatestRelease(repo, electronFetch),
);
app.setName("智枢");
let window: BrowserWindow | undefined;
let selectedProject: string | undefined;
let activeFileTasks = 0;
let didInitialUpdateCheck = false;
let installingUpdate = false;
let evolutionWatchers: FSWatcher[] = [];
let evolutionNotifyTimer: ReturnType<typeof setTimeout> | undefined;
let registry: ProjectRegistry;
let pluginLibrary: PluginLibrary;
let pluginInspection: PluginInspection | undefined;
let assetOperations: AssetOperations;
let mcpOperations: McpOperations;
let toolInspector: ToolInspector;
let sourceManager: SourceManager;
let evolutionOperations: EvolutionOperations;
const rawDevProfile = !app.isPackaged ? process.env.ZHISHU_DEV_PROFILE : undefined;
let developmentProfile: string | undefined;
if (rawDevProfile) {
  if (!path.isAbsolute(rawDevProfile)) throw new Error("开发验证目录必须是绝对路径");
  mkdirSync(rawDevProfile, { recursive: true });
  if (lstatSync(rawDevProfile).isSymbolicLink()) throw new Error("开发验证目录本身不能是符号链接");
  // 在 macOS 上将 /tmp 等系统根级软链规范化为 /private/tmp，避免触发资产目录祖先软链拦截。
  developmentProfile = realpathSync(rawDevProfile);
  app.setPath("userData", developmentProfile);
}
const softwareUpdate = new SoftwareUpdateService((state) => {
  if (window && !window.isDestroyed()) window.webContents.send("software-update:state", state);
}, electronFetch);

const VALID_USER_ASSET_ACTIONS = new Set(["install", "update", "uninstall"]);
const VALID_USER_ASSET_IDES = new Set<UserAssetIde>(["codex", "antigravity", "traework", "generic"]);
const MUTATING_CHANNELS = new Set([
  "project:choose",
  "project:forget",
  "project:recover",
  "plugins:import",
  "plugins:export-traework",
  "assets:adopt-legacy",
  "assets:preview",
  "assets:apply",
  "assets:forget",
  "mcp:save-custom",
  "mcp:remove-custom",
  "mcp:adopt-legacy",
  "mcp:preview",
  "mcp:apply",
  "mcp:forget",
  "sources:add",
  "sources:update",
  "sources:remove",
  "sources:sync",
  "evolution:save-watch-sources",
  "evolution:reset-watch-sources",
  "evolution:scan-overrides",
  "evolution:watch-docs",
  "evolution:import-proposal",
  "evolution:recheck",
  "evolution:preview",
  "evolution:apply",
  "evolution:reject",
  "evolution:reopen",
  "evolution:archive",
  "evolution:export-patch",
  "rules:preview-install",
  "rules:apply-install",
  "rules:preview-update",
  "rules:apply-update",
  "rules:preview-uninstall",
  "rules:apply-uninstall",
  "rules:preview-repair",
  "rules:apply-repair",
  "rules:preview-force-uninstall",
  "rules:apply-force-uninstall",
]);

function emitEvolutionUpdated(): void {
  if (evolutionNotifyTimer) clearTimeout(evolutionNotifyTimer);
  evolutionNotifyTimer = setTimeout(() => {
    evolutionNotifyTimer = undefined;
    if (window && !window.isDestroyed()) {
      window.webContents.send("evolution:updated");
    }
  }, 250);
}

function stopEvolutionWatchers(): void {
  if (evolutionNotifyTimer) {
    clearTimeout(evolutionNotifyTimer);
    evolutionNotifyTimer = undefined;
  }
  for (const watcher of evolutionWatchers) {
    try {
      watcher.close();
    } catch {
      // 忽略关闭 watcher 时的平台差异异常
    }
  }
  evolutionWatchers = [];
}

function startEvolutionWatchers(stateDir: string): void {
  stopEvolutionWatchers();
  const dirs = [stateDir, path.join(stateDir, "proposals")];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      const watcher = watch(dir, () => emitEvolutionUpdated());
      watcher.on("error", () => {});
      evolutionWatchers.push(watcher);
    } catch {
      // 文件监听不可用时仍保留窗口聚焦同步与手动刷新兜底
    }
  }
}

function requireProject(): string {
  if (!selectedProject) throw new Error("请先选择项目文件夹");
  return selectedProject;
}

function requireWindow(): BrowserWindow {
  if (!window || window.isDestroyed()) throw new Error("主窗口尚未就绪");
  return window;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseRuleSource(value: unknown): RuleSourceChoice | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("规则源参数无效");
  }
  const source = value as Record<string, unknown>;
  if (source.type === "github") {
    if (source.repository !== undefined && typeof source.repository !== "string") {
      throw new Error("GitHub 规则源仓库参数无效");
    }
    return { type: "github", repository: source.repository };
  }
  if (source.type === "workspace") {
    if (typeof source.path !== "string" || !path.isAbsolute(source.path)) {
      throw new Error("本地规则源必须是绝对目录路径");
    }
    return { type: "workspace", path: source.path };
  }
  throw new Error("不支持的规则源类型");
}

function parseEditedPatch(rawPatch: unknown): EvolutionPatchEdit | undefined {
  if (rawPatch === undefined) return undefined;
  if (typeof rawPatch !== "object" || rawPatch === null || Array.isArray(rawPatch)) {
    throw new Error("补丁编辑参数无效");
  }
  const p = rawPatch as Record<string, unknown>;
  if (
    (p.anchorHeading !== undefined && typeof p.anchorHeading !== "string") ||
    (p.beforeSnippet !== undefined && typeof p.beforeSnippet !== "string") ||
    (p.afterSnippet !== undefined && typeof p.afterSnippet !== "string")
  ) {
    throw new Error("补丁字段必须是字符串");
  }
  return {
    anchorHeading: p.anchorHeading,
    beforeSnippet: p.beforeSnippet,
    afterSnippet: p.afterSnippet,
  };
}

function parseSourceInput(rawInput: unknown): AddSourceInput {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    throw new Error("来源配置参数无效");
  }
  const raw = rawInput as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    (raw.tier !== "enterprise" && raw.tier !== "personal") ||
    (raw.access !== "local" && raw.access !== "git") ||
    typeof raw.location !== "string" ||
    (raw.branch !== undefined && typeof raw.branch !== "string") ||
    (raw.token !== undefined && typeof raw.token !== "string") ||
    (raw.requiredRulepacks !== undefined && !isStringArray(raw.requiredRulepacks))
  ) {
    throw new Error("来源表单字段无效");
  }
  return {
    id: raw.id,
    name: raw.name,
    tier: raw.tier,
    access: raw.access,
    location: raw.location,
    branch: raw.branch,
    token: raw.token,
    requiredRulepacks: raw.requiredRulepacks,
  };
}

function registerHandlers(): void {
  const guarded = <T extends unknown[]>(channel: string, action: (...args: T) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("请求来源不正确");
      }
      const isMutating = MUTATING_CHANNELS.has(channel);
      if (isMutating && installingUpdate) {
        throw new Error("正在安装软件更新，请等待更新完成后再操作");
      }
      if (isMutating) activeFileTasks++;
      try { return await action(...args as T); }
      finally { if (isMutating) activeFileTasks--; }
    });
  };

  guarded("project:choose", async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "选择项目文件夹",
      defaultPath: selectedProject,
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const status = await operations.inspect(result.filePaths[0]);
    await registry.add(status.root);
    selectedProject = status.root;
    return status;
  });
  guarded("project:list", async () => Promise.all((await registry.list()).map(async (item) => {
    try { return { ...item, status: await inspectProjectRoot(item.root) }; }
    catch (error) { return { ...item, error: error instanceof Error ? error.message : String(error) }; }
  })));
  guarded("project:select", async (root: unknown) => {
    if (typeof root !== "string" || !await registry.contains(root)) throw new Error("项目不在智枢列表中");
    const status = await operations.inspect(root);
    selectedProject = status.root;
    return status;
  });
  guarded("project:forget", async (root: unknown) => {
    if (typeof root !== "string") throw new Error("项目路径无效");
    if (root === selectedProject) {
      await operations.clearPreview();
    }
    await registry.remove(root);
    if (root === selectedProject) selectedProject = undefined;
  });
  guarded("project:inspect", () => operations.inspect(requireProject()));
  guarded("project:recover", async (root?: unknown) => {
    let targetRoot: string;
    if (root === undefined) {
      targetRoot = requireProject();
    } else {
      if (typeof root !== "string" || !await registry.contains(root)) throw new Error("项目不在智枢列表中");
      targetRoot = root;
    }
    const result = await operations.recover(targetRoot);
    selectedProject = result.status.root;
    return result;
  });
  guarded("plugins:list", () => pluginLibrary.list());
  guarded("plugins:read-skill", (key: unknown, skillSlug: unknown) => {
    if (typeof key !== "string" || !key || typeof skillSlug !== "string" || !skillSlug) {
      throw new Error("技能读取参数无效");
    }
    return pluginLibrary.readSkill(key, skillSlug);
  });
  guarded("plugins:inspect", async () => {
    pluginInspection = undefined;
    const result = await dialog.showOpenDialog(requireWindow(), { title: "选择插件或技能文件夹", buttonLabel: "选择文件夹", properties: ["openDirectory", "noResolveAliases"] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    pluginInspection = await pluginLibrary.inspect(result.filePaths[0]);
    return pluginInspection;
  });
  guarded("plugins:import", async () => {
    if (!pluginInspection) throw new Error("请先检查源插件");
    const result = await pluginLibrary.import(pluginInspection.sourceRoot, pluginInspection.sourceDigest);
    pluginInspection = undefined;
    return result;
  });
  guarded("plugins:export-traework", async (key: unknown) => {
    if (typeof key !== "string") throw new Error("导入标识无效");
    const result = await dialog.showSaveDialog(requireWindow(), { title: "导出 TraeWork 技能包", defaultPath: path.join(app.getPath("downloads"), "toolbox-product-design.zip"), filters: [{ name: "Skill 包", extensions: ["zip"] }] });
    if (result.canceled || !result.filePath) return undefined;
    return pluginLibrary.exportTraeWork(key, result.filePath);
  });
  guarded("assets:list", () => assetOperations.list());
  guarded("assets:inspect-legacy", () => assetOperations.inspectLegacy());
  guarded("assets:adopt-legacy", (keys?: unknown) => {
    if (keys !== undefined && !isStringArray(keys)) {
      throw new Error("旧版接管参数无效");
    }
    return assetOperations.adoptLegacy(keys);
  });
  guarded("assets:preview", (action: unknown, key: unknown, ide: unknown, id?: unknown, force?: unknown) => {
    if (
      typeof action !== "string" ||
      !VALID_USER_ASSET_ACTIONS.has(action) ||
      typeof key !== "string" ||
      typeof ide !== "string" ||
      !VALID_USER_ASSET_IDES.has(ide as UserAssetIde) ||
      (id !== undefined && typeof id !== "string") ||
      (force !== undefined && typeof force !== "boolean")
    ) {
      throw new Error("资产预览参数无效");
    }
    return assetOperations.preview(
      action as "install" | "update" | "uninstall",
      key,
      ide as UserAssetIde,
      id,
      { force: force === true },
    );
  });
  guarded("assets:apply", (token: unknown) => {
    if (typeof token !== "string" || !token) throw new Error("资产应用令牌无效");
    return assetOperations.apply(token);
  });
  guarded("assets:forget", (ide: unknown, id: unknown) => {
    if (typeof ide !== "string" || !VALID_USER_ASSET_IDES.has(ide as UserAssetIde) || typeof id !== "string" || !id) {
      throw new Error("清除资产记录参数无效");
    }
    return assetOperations.forgetReceipt(ide as UserAssetIde, id);
  });
  guarded("assets:clear-preview", () => assetOperations.clearPreview());
  guarded("tools:inspect", async () => {
    const [assets, mcps] = await Promise.all([assetOperations.list(), mcpOperations.listInstalled()]);
    return toolInspector.inspect(assets, mcps);
  });
  guarded("tools:snapshot", async () => {
    const [assets, mcps, legacyAssets, legacyMcps] = await Promise.all([
      assetOperations.list(),
      mcpOperations.listInstalled(),
      assetOperations.inspectLegacy(),
      mcpOperations.inspectLegacy(),
    ]);
    const tools = await toolInspector.inspect(assets, mcps);
    return { tools, assets, mcps, legacyAssets, legacyMcps };
  });
  guarded("mcp:catalog", () => mcpOperations.listCatalog());
  guarded("mcp:save-custom", (definition: unknown, updateExisting?: unknown) => {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new Error("自定义 MCP 定义无效");
    }
    if (updateExisting !== undefined && typeof updateExisting !== "boolean") {
      throw new Error("自定义 MCP 保存选项无效");
    }
    return mcpOperations.saveCustomServer(definition as McpServerDefinition, { updateExisting: updateExisting === true });
  });
  guarded("mcp:remove-custom", (id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("MCP 标识无效");
    return mcpOperations.removeCustomServer(id);
  });
  guarded("mcp:list", () => mcpOperations.listInstalled());
  guarded("mcp:inspect-legacy", () => mcpOperations.inspectLegacy());
  guarded("mcp:adopt-legacy", (keys?: unknown) => {
    if (keys !== undefined && !isStringArray(keys)) {
      throw new Error("旧版 MCP 接管参数无效");
    }
    return mcpOperations.adoptLegacy(keys);
  });
  guarded("mcp:preview", (action: unknown, serverId: unknown, toolId: unknown, envValues?: unknown, force?: unknown) => {
    if (typeof action !== "string" || !["install", "update", "uninstall"].includes(action) ||
      typeof serverId !== "string" || !serverId ||
      (toolId !== "antigravity" && toolId !== "codex") ||
      (force !== undefined && typeof force !== "boolean")) {
      throw new Error("MCP 预览参数无效");
    }
    const parsedEnv: Record<string, string> = {};
    if (envValues !== undefined) {
      if (typeof envValues !== "object" || envValues === null || Array.isArray(envValues)) {
        throw new Error("MCP 环境变量参数无效");
      }
      for (const [k, v] of Object.entries(envValues as Record<string, unknown>)) {
        if (typeof v !== "string") throw new Error("MCP 环境变量值必须是字符串");
        parsedEnv[k] = v;
      }
    }
    return mcpOperations.preview(
      action as "install" | "update" | "uninstall",
      serverId,
      toolId as McpToolId,
      parsedEnv,
      { force: force === true },
    );
  });
  guarded("mcp:apply", (token: unknown) => {
    if (typeof token !== "string" || !token) throw new Error("MCP 应用令牌无效");
    return mcpOperations.apply(token);
  });
  guarded("mcp:forget", (toolId: unknown, id: unknown) => {
    if ((toolId !== "antigravity" && toolId !== "codex") || typeof id !== "string" || !id) {
      throw new Error("清除 MCP 记录参数无效");
    }
    return mcpOperations.forgetReceipt(toolId, id);
  });
  guarded("mcp:clear-preview", () => mcpOperations.clearPreview());
  guarded("sources:list", () => sourceManager.list());
  guarded("sources:choose-dir", async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "选择本地来源目录",
      buttonLabel: "选择目录",
      properties: ["openDirectory", "noResolveAliases"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return result.filePaths[0];
  });
  guarded("sources:add", (rawInput: unknown) => sourceManager.add(parseSourceInput(rawInput)));
  guarded("sources:update", (rawInput: unknown) => {
    if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
      throw new Error("来源编辑参数无效");
    }
    const raw = rawInput as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      !raw.id ||
      (raw.name !== undefined && typeof raw.name !== "string") ||
      (raw.branch !== undefined && typeof raw.branch !== "string") ||
      (raw.token !== undefined && typeof raw.token !== "string") ||
      (raw.clearToken !== undefined && typeof raw.clearToken !== "boolean") ||
      (raw.requiredRulepacks !== undefined && !isStringArray(raw.requiredRulepacks))
    ) {
      throw new Error("来源编辑字段无效");
    }
    const input: UpdateSourceInput = {
      id: raw.id,
      name: raw.name,
      branch: raw.branch,
      token: raw.token,
      clearToken: raw.clearToken,
      requiredRulepacks: raw.requiredRulepacks,
    };
    return sourceManager.update(input);
  });
  guarded("sources:remove", (id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("来源标识无效");
    return sourceManager.remove(id);
  });
  guarded("sources:test", (rawInput: unknown) => {
    if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
      throw new Error("连接测试参数无效");
    }
    const raw = rawInput as Record<string, unknown>;
    if ((raw.access !== "local" && raw.access !== "git" && raw.access !== "github-release") ||
      typeof raw.location !== "string" ||
      (raw.id !== undefined && typeof raw.id !== "string") ||
      (raw.branch !== undefined && typeof raw.branch !== "string") ||
      (raw.token !== undefined && typeof raw.token !== "string")) {
      throw new Error("连接测试字段无效");
    }
    const input: TestSourceInput = {
      id: raw.id,
      access: raw.access,
      location: raw.location,
      branch: raw.branch,
      token: raw.token,
    };
    return sourceManager.testConnection(input);
  });
  guarded("sources:sync", (id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("来源标识无效");
    return sourceManager.sync(id);
  });

  const parseEvolutionTargetSource = (raw: unknown): EvolutionTargetSource => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("目标规则源参数无效");
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== "string" || !obj.id || typeof obj.name !== "string" || !obj.name) {
      throw new Error("目标规则源缺少标识或名称");
    }
    if (obj.root !== undefined && (typeof obj.root !== "string" || !path.isAbsolute(obj.root))) {
      throw new Error("目标规则源路径必须是绝对路径");
    }
    return {
      id: obj.id,
      name: obj.name,
      root: obj.root,
      readonly: Boolean(obj.readonly),
    };
  };

  guarded("evolution:list", () => evolutionOperations.list());
  guarded("evolution:watch-status", async () => evolutionOperations.getWatchStatus());
  guarded("evolution:watch-sources", () => evolutionOperations.getWatchSources());
  guarded("evolution:save-watch-sources", (rawSources: unknown) => {
    if (!Array.isArray(rawSources)) throw new Error("巡检源配置必须是数组");
    return evolutionOperations.saveWatchSources(rawSources as WatchSourceConfig[]);
  });
  guarded("evolution:reset-watch-sources", () => evolutionOperations.resetWatchSources());
  guarded("evolution:scan-overrides", async (workspaceRoot?: unknown) => {
    if (workspaceRoot !== undefined && (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot))) {
      throw new Error("本地规则源路径无效");
    }
    const res = await evolutionOperations.scanOverrides(workspaceRoot);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:watch-docs", async (rawOptions?: unknown) => {
    let options: { sourceIds?: string[]; workspaceRoot?: string } | undefined;
    if (rawOptions !== undefined) {
      if (typeof rawOptions !== "object" || rawOptions === null || Array.isArray(rawOptions)) {
        throw new Error("巡检参数无效");
      }
      const opts = rawOptions as Record<string, unknown>;
      if (opts.sourceIds !== undefined && !isStringArray(opts.sourceIds)) {
        throw new Error("巡检源标识列表无效");
      }
      if (opts.workspaceRoot !== undefined && (typeof opts.workspaceRoot !== "string" || !path.isAbsolute(opts.workspaceRoot))) {
        throw new Error("本地规则源路径无效");
      }
      options = {
        sourceIds: opts.sourceIds,
        workspaceRoot: opts.workspaceRoot,
      };
    }
    const res = await evolutionOperations.watchDocs(options);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:cancel-watch", async () => evolutionOperations.cancelWatch());
  guarded("evolution:import-proposal", async (workspaceRoot?: unknown) => {
    if (workspaceRoot !== undefined && (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot))) {
      throw new Error("本地规则源路径无效");
    }
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "选择进化提案 JSON 文件",
      buttonLabel: "导入提案",
      filters: [{ name: "进化提案 JSON", extensions: ["json"] }],
      properties: ["openFile", "noResolveAliases"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const imported = await evolutionOperations.importProposalFile(result.filePaths[0], workspaceRoot);
    emitEvolutionUpdated();
    return imported;
  });
  guarded("evolution:recheck", async (proposalId: unknown, rawSource: unknown, rawPatch?: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    const res = await evolutionOperations.recheck(proposalId, parseEvolutionTargetSource(rawSource), parseEditedPatch(rawPatch));
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:preview", (proposalId: unknown, rawSource: unknown, rawPatch?: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    return evolutionOperations.preview(proposalId, parseEvolutionTargetSource(rawSource), parseEditedPatch(rawPatch));
  });
  guarded("evolution:apply", async (token: unknown) => {
    if (typeof token !== "string" || !token) throw new Error("进化写入令牌无效");
    const res = await evolutionOperations.apply(token);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:reject", async (proposalId: unknown, reason?: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    if (reason !== undefined && typeof reason !== "string") throw new Error("驳回原因无效");
    const res = await evolutionOperations.reject(proposalId, reason);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:reopen", async (proposalId: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    const res = await evolutionOperations.reopen(proposalId);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:archive", async (proposalId: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    const res = await evolutionOperations.archive(proposalId);
    emitEvolutionUpdated();
    return res;
  });
  guarded("evolution:export-patch", async (proposalId: unknown, targetSourceRoot?: unknown, rawPatch?: unknown) => {
    if (typeof proposalId !== "string" || !proposalId) throw new Error("提案标识无效");
    if (targetSourceRoot !== undefined && (typeof targetSourceRoot !== "string" || !path.isAbsolute(targetSourceRoot))) {
      throw new Error("规则源路径无效");
    }
    const safeFilename = proposalId.replace(/[^a-zA-Z0-9._-]/g, "_") || "proposal";
    const result = await dialog.showSaveDialog(requireWindow(), {
      title: "导出规则进化增量补丁",
      defaultPath: path.join(app.getPath("downloads"), `${safeFilename}.patch`),
      filters: [
        { name: "补丁文件", extensions: ["patch"] },
        { name: "Markdown", extensions: ["md"] },
      ],
    });
    if (result.canceled || !result.filePath) return undefined;
    return evolutionOperations.exportPatch(proposalId, result.filePath, targetSourceRoot, parseEditedPatch(rawPatch));
  });
  guarded("rules:default-workspace-source", async () => {
    if (app.isPackaged) return undefined;
    const repoCandidate = path.resolve(__dirname, "../../..");
    try {
      return await inspectWorkspaceSource(repoCandidate);
    } catch {
      return undefined;
    }
  });
  guarded("rules:choose-workspace-source", async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "选择本地规则源仓库文件夹",
      buttonLabel: "选择规则源",
      properties: ["openDirectory", "noResolveAliases"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return inspectWorkspaceSource(result.filePaths[0]);
  });
  guarded("rules:inspect-workspace-source", async (sourcePath: unknown) => {
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) throw new Error("本地规则源必须是绝对目录路径");
    return inspectWorkspaceSource(sourcePath);
  });
  guarded("rules:preview-install", async (stackOrRequest: unknown, platforms?: unknown) => {
    if (typeof stackOrRequest === "string") {
      if (!Object.hasOwn(STACK_PACKS, stackOrRequest)) throw new Error("技术栈选项无效");
      if (!isStringArray(platforms)) throw new Error("请选择至少一个受支持的平台");
      return operations.previewInstall(requireProject(), stackOrRequest as StackChoice, platforms as PlatformChoice[]);
    }
    if (typeof stackOrRequest !== "object" || stackOrRequest === null || Array.isArray(stackOrRequest)) {
      throw new Error("安装配置参数无效");
    }
    const raw = stackOrRequest as Record<string, unknown>;
    if (!isStringArray(raw.rulepacks) || raw.rulepacks.length === 0) throw new Error("请选择至少一个规则包");
    if (!isStringArray(raw.targets) || raw.targets.length === 0) throw new Error("请选择至少一个受支持的平台");
    const request: InstallRequest = {
      rulepacks: raw.rulepacks,
      targets: raw.targets as PlatformChoice[],
      source: parseRuleSource(raw.source),
    };
    return operations.previewInstall(requireProject(), request);
  });
  guarded("rules:apply-install", () => operations.applyInstall(requireProject()));
  guarded("rules:check-update", (targets?: unknown, rulepacks?: unknown) => {
    if (targets !== undefined && !isStringArray(targets)) {
      throw new Error("请选择至少一个受支持的平台");
    }
    if (rulepacks !== undefined && !isStringArray(rulepacks)) {
      throw new Error("规则包列表无效");
    }
    return operations.checkUpdate(
      requireProject(),
      targets as PlatformChoice[] | undefined,
      rulepacks,
    );
  });
  guarded("rules:preview-update", () => operations.previewUpdate(requireProject()));
  guarded("rules:apply-update", () => operations.applyUpdate(requireProject()));
  guarded("rules:preview-uninstall", () => operations.previewUninstall(requireProject()));
  guarded("rules:apply-uninstall", () => operations.applyUninstall(requireProject()));
  guarded("rules:preview-repair", async (rawRequest?: unknown) => {
    if (rawRequest === undefined) return operations.previewRepair(requireProject());
    if (typeof rawRequest !== "object" || rawRequest === null || Array.isArray(rawRequest)) {
      throw new Error("修复配置参数无效");
    }
    const raw = rawRequest as Record<string, unknown>;
    if (!isStringArray(raw.rulepacks) || raw.rulepacks.length === 0) throw new Error("请选择至少一个规则包");
    if (!isStringArray(raw.targets) || raw.targets.length === 0) throw new Error("请选择至少一个受支持的平台");
    const request: InstallRequest = {
      rulepacks: raw.rulepacks,
      targets: raw.targets as PlatformChoice[],
      source: parseRuleSource(raw.source),
    };
    return operations.previewRepair(requireProject(), request);
  });
  guarded("rules:apply-repair", () => operations.applyRepair(requireProject()));
  guarded("rules:preview-force-uninstall", () => operations.previewForceUninstall(requireProject()));
  guarded("rules:apply-force-uninstall", () => operations.applyForceUninstall(requireProject()));
  guarded("rules:clear-preview", () => operations.clearPreview());
  guarded("software-update:state", async () => softwareUpdate.getState());
  guarded("software-update:check", () => softwareUpdate.check());
  guarded("software-update:download", () => softwareUpdate.download());
  guarded("software-update:cancel", async () => softwareUpdate.cancelDownload());
  guarded("software-update:install", async () => {
    if (activeFileTasks > 0) throw new Error("文件操作仍在进行，请完成后再安装软件更新");
    installingUpdate = true;
    try {
      const outcome = await softwareUpdate.install();
      if (outcome.phase !== "installing") {
        installingUpdate = false;
      }
      return outcome;
    } catch (error) {
      installingUpdate = false;
      throw error;
    }
  });
  guarded("software-update:open-download", () => softwareUpdate.openDownloadPage());
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const filename = process.platform === "darwin" ? "icon-mac.png" : "icon.png";
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets", filename));
  return icon.isEmpty() ? undefined : icon;
}

function createWindow(): void {
  const appIcon = loadAppIcon();
  window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: developmentProfile ? "智枢（开发验证）" : "智枢",
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (developmentProfile) window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    window?.show();
    if (!didInitialUpdateCheck) {
      didInitialUpdateCheck = true;
      void softwareUpdate.check();
    }
  });
  window.on("focus", () => {
    if (window && !window.isDestroyed()) {
      window.webContents.send("evolution:updated");
    }
  });
  void window.loadFile(path.join(__dirname, "../dist/index.html"));
  window.on("closed", () => {
    window = undefined;
    selectedProject = undefined;
    pluginInspection = undefined;
    void operations.clearPreview().catch(() => {});
    void assetOperations?.clearPreview().catch(() => {});
    void mcpOperations?.clearPreview().catch(() => {});
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on("before-quit", () => {
    stopEvolutionWatchers();
    softwareUpdate.cancelDownload();
    evolutionOperations?.cancelWatch();
    void operations.clearPreview().catch(() => {});
  });

  app.whenReady().then(() => {
    app.setName("智枢");
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "智枢",
            submenu: [
              { role: "about", label: "关于智枢" },
              { type: "separator" },
              { role: "services", label: "服务" },
              { type: "separator" },
              { role: "hide", label: "隐藏智枢" },
              { role: "hideOthers", label: "隐藏其他" },
              { role: "unhide", label: "全部显示" },
              { type: "separator" },
              { role: "quit", label: "退出智枢" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo", label: "撤销" },
              { role: "redo", label: "重做" },
              { type: "separator" },
              { role: "cut", label: "剪切" },
              { role: "copy", label: "拷贝" },
              { role: "paste", label: "粘贴" },
              { role: "selectAll", label: "全选" },
            ],
          },
          {
            label: "窗口",
            submenu: [
              { role: "minimize", label: "最小化" },
              { role: "zoom", label: "缩放" },
              { role: "close", label: "关闭窗口" },
            ],
          },
        ]),
      );
    }
    const appIcon = loadAppIcon();
    if (process.platform === "darwin" && app.dock && appIcon) {
      app.dock.setIcon(appIcon);
    }
    registry = new ProjectRegistry(path.join(app.getPath("userData"), "projects.json"));
    const builtinPluginsDir = app.isPackaged
      ? path.join(process.resourcesPath, "plugins")
      : path.resolve(__dirname, "../../../plugins");
    pluginLibrary = new PluginLibrary(path.join(app.getPath("userData"), "plugin-imports"), [builtinPluginsDir]);
    const profilePaths = developmentProfile ? {
      userHome: path.join(developmentProfile, "user-home"),
      codexHome: path.join(developmentProfile, "user-home/.codex"),
    } : {};
    assetOperations = new AssetOperations(
      pluginLibrary,
      path.join(app.getPath("userData"), "ide-assets"),
      developmentProfile
        ? { ...profilePaths, legacyReceiptDirs: [path.join(developmentProfile, "legacy-receipts")] }
        : profilePaths,
    );
    mcpOperations = new McpOperations(
      path.join(app.getPath("userData"), "mcp-assets"),
      developmentProfile
        ? { ...profilePaths, legacyReceiptDirs: [path.join(developmentProfile, "legacy-mcp-receipts")] }
        : profilePaths,
    );
    toolInspector = new ToolInspector(profilePaths);
    sourceManager = new SourceManager(path.join(app.getPath("userData"), "sources"), electronFetch);
    const evolutionStateDir =
      !developmentProfile && process.env.ZHISHU_EVOLUTION_DIR && path.isAbsolute(process.env.ZHISHU_EVOLUTION_DIR)
        ? process.env.ZHISHU_EVOLUTION_DIR
        : path.join(app.getPath("userData"), "evolution");
    evolutionOperations = new EvolutionOperations(evolutionStateDir, {
      registry,
      sourceManager,
      fetcher: electronGenericFetch,
      defaultWorkspaceRoot: async () => {
        if (app.isPackaged) return undefined;
        const repoCandidate = path.resolve(__dirname, "../../..");
        try {
          const info = await inspectWorkspaceSource(repoCandidate);
          return info.root;
        } catch {
          return undefined;
        }
      },
      onWatchProgress: (progress) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send("evolution:watch-progress", progress);
        }
      },
      onWatchStateChange: (status) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send("evolution:watch-state", status);
        }
      },
    });
    startEvolutionWatchers(evolutionStateDir);
    registerHandlers();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
