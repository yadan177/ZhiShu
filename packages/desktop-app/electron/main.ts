import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from "electron";
import path from "node:path";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { DesktopOperations, STACK_PACKS, inspectProjectRoot, inspectWorkspaceSource } from "./operations.ts";
import type { InstallRequest, PlatformChoice, RuleSourceChoice, StackChoice } from "./operations.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { PluginLibrary } from "./plugin-library.ts";
import type { PluginInspection } from "./plugin-library.ts";
import { AssetOperations, type UserAssetIde } from "./asset-operations.ts";
import { McpOperations } from "./mcp-operations.ts";
import { SourceManager, type AddSourceInput, type TestSourceInput } from "./source-manager.ts";
import { ToolInspector } from "./tool-inspector.ts";
import { SoftwareUpdateService } from "./software-update.ts";
import type { McpServerDefinition, McpToolId } from "../../core/src/index.ts";

const operations = new DesktopOperations();
app.setName("智枢");
let window: BrowserWindow | undefined;
let selectedProject: string | undefined;
let activeFileTasks = 0;
let registry: ProjectRegistry;
let pluginLibrary: PluginLibrary;
let pluginInspection: PluginInspection | undefined;
let assetOperations: AssetOperations;
let mcpOperations: McpOperations;
let toolInspector: ToolInspector;
let sourceManager: SourceManager;
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
});

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

function registerHandlers(): void {
  const guarded = <T extends unknown[]>(channel: string, action: (...args: T) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("请求来源不正确");
      }
      const fileTask =
        channel.startsWith("rules:") ||
        channel.startsWith("plugins:") ||
        channel.startsWith("assets:") ||
        channel.startsWith("mcp:") ||
        channel.startsWith("sources:") ||
        channel === "project:recover";
      if (fileTask) activeFileTasks++;
      try { return await action(...args as T); }
      finally { if (fileTask) activeFileTasks--; }
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
  guarded("assets:preview", (action: unknown, key: unknown, ide: unknown, id?: unknown) => {
    if (typeof action !== "string" || typeof key !== "string" || typeof ide !== "string" || (id !== undefined && typeof id !== "string")) {
      throw new Error("资产预览参数无效");
    }
    return assetOperations.preview(action as "install" | "update" | "uninstall", key, ide as UserAssetIde, id);
  });
  guarded("assets:apply", (token: unknown) => {
    if (typeof token !== "string" || !token) throw new Error("资产应用令牌无效");
    return assetOperations.apply(token);
  });
  guarded("tools:inspect", async () => {
    const [assets, mcps] = await Promise.all([assetOperations.list(), mcpOperations.listInstalled()]);
    return toolInspector.inspect(assets, mcps);
  });
  guarded("mcp:catalog", () => mcpOperations.listCatalog());
  guarded("mcp:save-custom", (definition: unknown) => {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      throw new Error("自定义 MCP 定义无效");
    }
    return mcpOperations.saveCustomServer(definition as McpServerDefinition);
  });
  guarded("mcp:remove-custom", (id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("MCP 标识无效");
    return mcpOperations.removeCustomServer(id);
  });
  guarded("mcp:list", () => mcpOperations.listInstalled());
  guarded("mcp:preview", (action: unknown, serverId: unknown, toolId: unknown, envValues?: unknown) => {
    if (typeof action !== "string" || !["install", "update", "uninstall"].includes(action) ||
      typeof serverId !== "string" || !serverId ||
      (toolId !== "antigravity" && toolId !== "codex")) {
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
    return mcpOperations.preview(action as "install" | "update" | "uninstall", serverId, toolId as McpToolId, parsedEnv);
  });
  guarded("mcp:apply", (token: unknown) => {
    if (typeof token !== "string" || !token) throw new Error("MCP 应用令牌无效");
    return mcpOperations.apply(token);
  });
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
  guarded("sources:add", (rawInput: unknown) => {
    if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
      throw new Error("来源配置参数无效");
    }
    const raw = rawInput as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.name !== "string" ||
      (raw.tier !== "enterprise" && raw.tier !== "personal") ||
      (raw.access !== "local" && raw.access !== "git") ||
      typeof raw.location !== "string" ||
      (raw.branch !== undefined && typeof raw.branch !== "string") ||
      (raw.token !== undefined && typeof raw.token !== "string") ||
      (raw.requiredRulepacks !== undefined && !isStringArray(raw.requiredRulepacks))) {
      throw new Error("来源表单字段无效");
    }
    const input: AddSourceInput = {
      id: raw.id,
      name: raw.name,
      tier: raw.tier,
      access: raw.access,
      location: raw.location,
      branch: raw.branch,
      token: raw.token,
      requiredRulepacks: raw.requiredRulepacks,
    };
    return sourceManager.add(input);
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
  guarded("rules:clear-preview", () => operations.clearPreview());
  guarded("software-update:state", async () => softwareUpdate.getState());
  guarded("software-update:check", () => softwareUpdate.check());
  guarded("software-update:download", () => softwareUpdate.download());
  guarded("software-update:install", async () => {
    if (activeFileTasks > 0) throw new Error("文件操作仍在进行，请完成后再重启更新软件");
    softwareUpdate.install();
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
    void softwareUpdate.check();
  });
  void window.loadFile(path.join(__dirname, "../dist/index.html"));
  window.on("closed", () => { window = undefined; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
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
    assetOperations = new AssetOperations(pluginLibrary, path.join(app.getPath("userData"), "ide-assets"), profilePaths);
    mcpOperations = new McpOperations(path.join(app.getPath("userData"), "mcp-assets"), profilePaths);
    toolInspector = new ToolInspector(profilePaths);
    sourceManager = new SourceManager(path.join(app.getPath("userData"), "sources"));
    registerHandlers();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
