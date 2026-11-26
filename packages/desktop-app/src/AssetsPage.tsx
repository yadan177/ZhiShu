import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle,
  FolderPlus,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AssetGlyph, IconTile, glyphForAsset, type AssetGlyphKind } from "./BrandIcons";
import { APP_COPY, RULEPACK_CATALOG } from "./copy";
import { Dropdown } from "./Dropdown";
import {
  formatErrorMessage,
  type AssetIde,
  type AssetsApi,
  type InstalledAssetRecord,
  type InstalledMcpRecord,
  type McpPreview,
  type McpServerDefinition,
  type McpToolId,
  type PluginSource,
  type ToolInspection,
  type UserAssetPlan,
} from "./types";

export type { AssetsApi };

type AssetTab = "plugins" | "skills" | "mcp";
type StatusFilter = "all" | "installed" | "uninstalled";
type SourceFilter = "all" | "preset" | "local";

const TOOL_LABELS: Record<AssetIde, string> = {
  codex: "OpenAI Codex",
  antigravity: "Antigravity",
  traework: "TRAE / TraeWork",
  generic: "通用标准目录",
};

const ACTION_VERBS = { install: "安装", update: "更新", uninstall: "卸载" } as const;

function compareSemver(a: string, b: string): number {
  const splitVer = (value: string): [string, string | undefined] => {
    const idx = value.indexOf("-");
    return idx === -1 ? [value, undefined] : [value.slice(0, idx), value.slice(idx + 1)];
  };
  const [aCore, aPre] = splitVer(a);
  const [bCore, bPre] = splitVer(b);
  const aParts = aCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bParts = bCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}

function normalizeDigest(digest?: string): string | undefined {
  if (!digest) return undefined;
  const cleaned = digest.replace(/^sha256:/i, "");
  return /^[a-f0-9]{64}$/i.test(cleaned) ? cleaned.toLowerCase() : undefined;
}

function glyphForPlugin(name: string, kind: "skill" | "capability-plugin"): AssetGlyphKind {
  return glyphForAsset(name, kind);
}

function glyphForMcp(id: string): AssetGlyphKind {
  return id === "feishu-mcp" ? "feishu" : "local_plugin";
}

export function AssetsPage({
  api,
  onBusyChange,
}: {
  api?: AssetsApi;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [tab, setTab] = useState<AssetTab>("plugins");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");

  const [sources, setSources] = useState<PluginSource[]>([]);
  const [installedAssets, setInstalledAssets] = useState<InstalledAssetRecord[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpServerDefinition[]>([]);
  const [installedMcps, setInstalledMcps] = useState<InstalledMcpRecord[]>([]);
  const [tools, setTools] = useState<ToolInspection[]>([]);

  const [pendingImport, setPendingImport] = useState<PluginSource>();
  const [drawerAsset, setDrawerAsset] = useState<PluginSource>();
  const [skillPreview, setSkillPreview] = useState<{ slug: string; title: string; content: string }>();
  const [drawerMcp, setDrawerMcp] = useState<McpServerDefinition>();
  const [drawerAssetTools, setDrawerAssetTools] = useState<AssetIde[]>(["antigravity"]);
  const [drawerMcpTool, setDrawerMcpTool] = useState<McpToolId>("antigravity");
  const [mcpEnvValues, setMcpEnvValues] = useState<Record<string, string>>({});
  const [revealedMcpKeys, setRevealedMcpKeys] = useState<Record<string, boolean>>({});

  const [assetPlanQueue, setAssetPlanQueue] = useState<{
    key: string;
    totalTools: number;
    completedTools: AssetIde[];
    remainingTools: AssetIde[];
    currentPlan: UserAssetPlan;
    existingId?: string;
    force?: boolean;
  }>();
  const [selectedChangeIndex, setSelectedChangeIndex] = useState(0);
  const [mcpPreview, setMcpPreview] = useState<McpPreview & { force?: boolean }>();

  const [showAddMcp, setShowAddMcp] = useState(false);
  const [editingCustomMcpId, setEditingCustomMcpId] = useState<string>();
  const [customId, setCustomId] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customVersion, setCustomVersion] = useState("1.0.0");
  const [customTransport, setCustomTransport] = useState<"stdio" | "http">("stdio");
  const [customCommand, setCustomCommand] = useState("npx");
  const [customArgs, setCustomArgs] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customEnvKeys, setCustomEnvKeys] = useState("");
  const [customEnvSecret, setCustomEnvSecret] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overlayError, setOverlayError] = useState("");
  const [notice, setNotice] = useState("");

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  function setBusyState(next: boolean): void {
    if (!mountedRef.current) return;
    setBusy(next);
    onBusyChange?.(next);
  }

  async function run(
    action: () => Promise<void>,
    options: { overlay?: boolean } = {},
  ): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyState(true);
    if (options.overlay) setOverlayError("");
    else setError("");
    setNotice("");
    try {
      await action();
    } catch (problem) {
      if (!mountedRef.current) return;
      const msg = formatErrorMessage(problem);
      if (options.overlay) setOverlayError(msg);
      else setError(msg);
    } finally {
      inFlightRef.current = false;
      setBusyState(false);
    }
  }

  async function refreshAll(currentApi: AssetsApi): Promise<void> {
    if (currentApi.getToolsSnapshot) {
      const [importsRes, catalogRes, snapshotRes] = await Promise.allSettled([
        currentApi.listPluginImports(),
        currentApi.listMcpCatalog(),
        currentApi.getToolsSnapshot(),
      ]);
      if (!mountedRef.current) return;
      const errors: string[] = [];
      if (importsRes.status === "fulfilled") setSources(importsRes.value);
      else errors.push(formatErrorMessage(importsRes.reason));
      if (catalogRes.status === "fulfilled") setMcpCatalog(catalogRes.value);
      else errors.push(formatErrorMessage(catalogRes.reason));
      if (snapshotRes.status === "fulfilled") {
        setTools(snapshotRes.value.tools);
        setInstalledAssets(snapshotRes.value.assets);
        setInstalledMcps(snapshotRes.value.mcps);
      } else {
        errors.push(formatErrorMessage(snapshotRes.reason));
      }
      if (errors.length > 0) setError(errors.join("；"));
      return;
    }
    const [importsRes, assetsRes, catalogRes, mcpsRes, toolsRes] = await Promise.allSettled([
      currentApi.listPluginImports(),
      currentApi.listUserAssets(),
      currentApi.listMcpCatalog(),
      currentApi.listInstalledMcps(),
      currentApi.inspectTools(),
    ]);
    if (!mountedRef.current) return;
    const errors: string[] = [];
    if (importsRes.status === "fulfilled") setSources(importsRes.value);
    else errors.push(formatErrorMessage(importsRes.reason));
    if (assetsRes.status === "fulfilled") setInstalledAssets(assetsRes.value);
    else errors.push(formatErrorMessage(assetsRes.reason));
    if (catalogRes.status === "fulfilled") setMcpCatalog(catalogRes.value);
    else errors.push(formatErrorMessage(catalogRes.reason));
    if (mcpsRes.status === "fulfilled") setInstalledMcps(mcpsRes.value);
    else errors.push(formatErrorMessage(mcpsRes.reason));
    if (toolsRes.status === "fulfilled") setTools(toolsRes.value);
    else errors.push(formatErrorMessage(toolsRes.reason));
    if (errors.length > 0) setError(errors.join("；"));
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        await refreshAll(api);
      } catch (problem) {
        if (!cancelled && mountedRef.current) setError(formatErrorMessage(problem));
      } finally {
        if (!cancelled && mountedRef.current) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const pluginsList = useMemo(
    () => sources.filter((item) => item.kind === "capability-plugin"),
    [sources],
  );
  const skillsList = useMemo(
    () => sources.filter((item) => item.kind === "skill"),
    [sources],
  );

  function installedForSource(item: PluginSource): InstalledAssetRecord[] {
    const expectedPrefix = item.kind === "skill" ? `skill-${item.name}` : `plugin-${item.name}`;
    return installedAssets.filter(
      (record) => record.id === expectedPrefix || record.sourceKey === item.key,
    );
  }

  function assessAssetRecord(
    item: PluginSource,
    rec: InstalledAssetRecord,
  ): "conflict" | "updatable" | "different-version" | "current" {
    if (rec.issues.length > 0) return "conflict";
    const cmp = compareSemver(item.version, rec.version);
    if (cmp > 0) return "updatable";
    if (cmp < 0) return "different-version";
    const itemDigest = normalizeDigest(item.sourceDigest);
    const recDigest = normalizeDigest(rec.sourceDigest);
    if (itemDigest && recDigest && itemDigest !== recDigest) return "updatable";
    return "current";
  }

  function installedForMcp(server: McpServerDefinition): InstalledMcpRecord[] {
    return installedMcps.filter((record) => record.id === server.id);
  }

  const keyword = query.trim().toLocaleLowerCase();

  const visibleAssets = useMemo(() => {
    const list = tab === "plugins" ? pluginsList : skillsList;
    return list.filter((item) => {
      if (sourceFilter === "preset" && !item.preset) return false;
      if (sourceFilter === "local" && item.preset) return false;
      if (keyword && !item.title.toLocaleLowerCase().includes(keyword) && !item.name.toLocaleLowerCase().includes(keyword)) {
        return false;
      }
      const isInstalled = installedForSource(item).length > 0;
      if (statusFilter === "installed" && !isInstalled) return false;
      if (statusFilter === "uninstalled" && isInstalled) return false;
      return true;
    });
  }, [tab, pluginsList, skillsList, sourceFilter, keyword, statusFilter, installedAssets]);

  const visibleMcps = useMemo(() => {
    return mcpCatalog.filter((server) => {
      if (sourceFilter === "preset" && !server.preset) return false;
      if (sourceFilter === "local" && server.preset) return false;
      if (keyword && !server.title.toLocaleLowerCase().includes(keyword) && !server.id.toLocaleLowerCase().includes(keyword)) {
        return false;
      }
      const isInstalled = installedForMcp(server).length > 0;
      if (statusFilter === "installed" && !isInstalled) return false;
      if (statusFilter === "uninstalled" && isInstalled) return false;
      return true;
    });
  }, [mcpCatalog, sourceFilter, keyword, statusFilter, installedMcps]);

  function assetCompatibility(item: PluginSource, ide: AssetIde): { supported: boolean; reason?: string } {
    if (ide === "codex" || ide === "antigravity") return { supported: true };
    if (ide === "traework") {
      if (item.kind === "skill" || item.delivery === "traework-skill") return { supported: true };
      return { supported: false, reason: "缺少 TraeWork 适配" };
    }
    if (item.kind === "skill") return { supported: true };
    return { supported: false, reason: "仅支持独立技能" };
  }

  function openAssetDrawer(item: PluginSource): void {
    setDrawerMcp(undefined);
    setSkillPreview(undefined);
    setOverlayError("");
    setDrawerAsset(item);
    const compatible = (["antigravity", "codex", "traework", "generic"] as AssetIde[]).filter(
      (ide) => assetCompatibility(item, ide).supported,
    );
    const existing = installedForSource(item);
    const preferred =
      compatible.find((ide) => {
        const rec = existing.find((r) => r.target.ideId === ide);
        if (!rec) {
          if (item.kind === "skill" && (ide === "codex" || ide === "generic")) {
            const sibling = ide === "codex" ? "generic" : "codex";
            if (existing.some((r) => r.target.ideId === sibling)) return false;
          }
          return true;
        }
        const state = assessAssetRecord(item, rec);
        return state === "conflict" || state === "updatable";
      }) ?? compatible[0];
    setDrawerAssetTools(preferred ? [preferred] : []);
  }

  async function toggleSkillPreview(item: PluginSource, skillSlug: string): Promise<void> {
    if (skillPreview?.slug === skillSlug) {
      setSkillPreview(undefined);
      return;
    }
    const readPluginSkill = api?.readPluginSkill;
    if (!readPluginSkill) return;
    await run(
      async () => {
        const loaded = await readPluginSkill(item.key, skillSlug);
        if (mountedRef.current) setSkillPreview(loaded);
      },
      { overlay: true },
    );
  }

  function openMcpDrawer(server: McpServerDefinition): void {
    setDrawerAsset(undefined);
    setOverlayError("");
    setDrawerMcp(server);
    const availableTool = (["antigravity", "codex"] as McpToolId[]).find((id) =>
      tools.some((t) => t.id === id && t.available),
    );
    const existingTool = installedForMcp(server)[0]?.toolId;
    setDrawerMcpTool(existingTool ?? availableTool ?? "antigravity");
    setMcpEnvValues(Object.fromEntries(server.envSchema.map((field) => [field.key, ""])));
    setRevealedMcpKeys({});
  }

  function openCustomMcpModal(editDef?: McpServerDefinition): void {
    setOverlayError("");
    if (editDef) {
      setEditingCustomMcpId(editDef.id);
      setCustomId(editDef.id);
      setCustomTitle(editDef.title);
      setCustomVersion(editDef.version);
      setCustomTransport(editDef.transport);
      setCustomCommand(editDef.command ?? "npx");
      setCustomArgs((editDef.args ?? []).join(" "));
      setCustomUrl(editDef.url ?? "");
      setCustomEnvKeys(editDef.envSchema.map((f) => f.key).join(", "));
      setCustomEnvSecret(editDef.envSchema.some((f) => f.secret !== false) || editDef.envSchema.length === 0);
    } else {
      setEditingCustomMcpId(undefined);
      setCustomId("");
      setCustomTitle("");
      setCustomVersion("1.0.0");
      setCustomTransport("stdio");
      setCustomCommand("npx");
      setCustomArgs("");
      setCustomUrl("");
      setCustomEnvKeys("");
      setCustomEnvSecret(true);
    }
    setShowAddMcp(true);
  }

  function toggleDrawerAssetTool(ide: AssetIde): void {
    setOverlayError("");
    setDrawerAssetTools((current) => {
      if (current.includes(ide)) return current.filter((item) => item !== ide);
      // 独立 Skill 的 Codex 与通用目录共用 ~/.agents/skills，避免同批重复选中引发路径碰撞
      if (drawerAsset?.kind === "skill" && (ide === "codex" || ide === "generic")) {
        const sibling: AssetIde = ide === "codex" ? "generic" : "codex";
        return [...current.filter((item) => item !== sibling), ide];
      }
      return [...current, ide];
    });
  }

  function closeAssetPlanModal(): void {
    setAssetPlanQueue(undefined);
    setOverlayError("");
    void api?.clearUserAssetPreview?.().catch(() => {});
  }

  function closeMcpPreviewModal(): void {
    setMcpPreview(undefined);
    setOverlayError("");
    void api?.clearMcpPreview?.().catch(() => {});
  }

  async function startAssetPreviewBatch(force = false): Promise<void> {
    if (!api || !drawerAsset || drawerAssetTools.length === 0) return;
    const [firstTool, ...restTools] = drawerAssetTools;
    if (!firstTool) return;
    const existing = installedForSource(drawerAsset).find((rec) => rec.target.ideId === firstTool);
    const action = existing ? "update" : "install";
    const useForce = force || Boolean(existing && existing.issues.length > 0);
    await run(
      async () => {
        const plan = await api.previewUserAsset(action, drawerAsset.key, firstTool, existing?.id, useForce);
        if (!mountedRef.current) return;
        setSelectedChangeIndex(0);
        setAssetPlanQueue({
          key: drawerAsset.key,
          totalTools: drawerAssetTools.length,
          completedTools: [],
          remainingTools: restTools,
          currentPlan: plan,
          existingId: existing?.id,
          force: useForce,
        });
      },
      { overlay: true },
    );
  }

  async function previewNextInQueue(
    currentApi: AssetsApi,
    key: string,
    totalTools: number,
    completedTools: AssetIde[],
    remainingTools: AssetIde[],
  ): Promise<void> {
    const [nextTool, ...nextRest] = remainingTools;
    if (!nextTool || !drawerAsset || !mountedRef.current) {
      setAssetPlanQueue(undefined);
      setDrawerAsset(undefined);
      setNotice(
        completedTools.length > 0
          ? `已完成：${completedTools.map((id) => TOOL_LABELS[id]).join("、")}`
          : "已结束操作",
      );
      return;
    }
    try {
      const refreshedInstalled = await currentApi.listUserAssets();
      if (!mountedRef.current) return;
      const expectedId = `${drawerAsset.kind === "skill" ? "skill" : "plugin"}-${drawerAsset.name}`;
      const existing = refreshedInstalled.find(
        (rec) => rec.target.ideId === nextTool && (rec.id === expectedId || rec.sourceKey === key),
      );
      const useForce = Boolean(existing && existing.issues.length > 0);
      const nextPlan = await currentApi.previewUserAsset(
        existing ? "update" : "install",
        key,
        nextTool,
        existing?.id,
        useForce,
      );
      if (!mountedRef.current) return;
      setSelectedChangeIndex(0);
      setAssetPlanQueue({
        key,
        totalTools,
        completedTools,
        remainingTools: nextRest,
        currentPlan: nextPlan,
        existingId: existing?.id,
        force: useForce,
      });
    } catch (nextErr) {
      if (!mountedRef.current) return;
      setAssetPlanQueue(undefined);
      setDrawerAsset(undefined);
      const doneText = completedTools.length > 0 ? `已写入 ${completedTools.map((id) => TOOL_LABELS[id]).join("、")}；` : "";
      setError(`${doneText}${TOOL_LABELS[nextTool]} 预览失败（${formatErrorMessage(nextErr)}）`);
    }
  }

  async function applyCurrentAssetPlan(): Promise<void> {
    if (!api || !assetPlanQueue) return;
    const { key, totalTools, completedTools, remainingTools, currentPlan } = assetPlanQueue;
    await run(
      async () => {
        await api.applyUserAsset(currentPlan.token);
        const nextCompleted = [...completedTools, currentPlan.ideId as AssetIde];
        await refreshAll(api);
        if (!mountedRef.current) return;
        if (remainingTools.length > 0 && drawerAsset) {
          await previewNextInQueue(api, key, totalTools, nextCompleted, remainingTools);
          return;
        }
        setAssetPlanQueue(undefined);
        setDrawerAsset(undefined);
        setNotice(
          `${ACTION_VERBS[currentPlan.action]}完成：${nextCompleted.map((id) => TOOL_LABELS[id]).join("、")}`,
        );
      },
      { overlay: true },
    );
  }

  async function retryCurrentAssetPlanWithForce(): Promise<void> {
    if (!api || !assetPlanQueue) return;
    const { key, currentPlan, existingId } = assetPlanQueue;
    await run(
      async () => {
        const nextPlan = await api.previewUserAsset(
          currentPlan.action,
          key,
          currentPlan.ideId as AssetIde,
          existingId,
          true,
        );
        if (!mountedRef.current) return;
        setSelectedChangeIndex(0);
        setAssetPlanQueue((cur) => (cur ? { ...cur, currentPlan: nextPlan, force: true } : undefined));
      },
      { overlay: true },
    );
  }

  async function skipCurrentAssetPlan(): Promise<void> {
    if (!api || !assetPlanQueue) return;
    const { key, totalTools, completedTools, remainingTools } = assetPlanQueue;
    await run(
      async () => {
        await api.clearUserAssetPreview?.();
        await previewNextInQueue(api, key, totalTools, completedTools, remainingTools);
      },
      { overlay: true },
    );
  }

  async function startMcpPreview(action: "install" | "update" | "uninstall", force = false): Promise<void> {
    if (!api || !drawerMcp) return;
    await run(
      async () => {
        const preview = await api.previewMcp(action, drawerMcp.id, drawerMcpTool, mcpEnvValues, force);
        if (!mountedRef.current) return;
        setMcpPreview({ ...preview, force });
      },
      { overlay: true },
    );
  }

  async function applyCurrentMcpPreview(): Promise<void> {
    if (!api || !mcpPreview) return;
    await run(
      async () => {
        await api.applyMcp(mcpPreview.token);
        await refreshAll(api);
        if (!mountedRef.current) return;
        setMcpPreview(undefined);
        setDrawerMcp(undefined);
        setMcpEnvValues({});
        setNotice(`MCP ${ACTION_VERBS[mcpPreview.action]}完成`);
      },
      { overlay: true },
    );
  }

  async function submitCustomMcp(): Promise<void> {
    if (!api) return;
    const envKeys = customEnvKeys
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (customTransport === "stdio" ? item.toUpperCase() : item));
    const definition: McpServerDefinition = {
      schemaVersion: 1,
      id: customId.trim(),
      title: customTitle.trim(),
      version: customVersion.trim() || "1.0.0",
      transport: customTransport,
      ...(customTransport === "stdio"
        ? {
            command: customCommand.trim(),
            args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [],
          }
        : { url: customUrl.trim() }),
      envSchema: envKeys.map((key) => ({
        key,
        label: key,
        required: true,
        secret: customEnvSecret,
        placeholder: customEnvSecret ? "仅存本机配置文件" : "",
      })),
    };
    const isEditing = Boolean(editingCustomMcpId);
    await run(
      async () => {
        await api.saveCustomMcp(definition, isEditing);
        await refreshAll(api);
        if (!mountedRef.current) return;
        setShowAddMcp(false);
        setEditingCustomMcpId(undefined);
        setCustomId("");
        setCustomTitle("");
        setCustomArgs("");
        setCustomUrl("");
        setCustomEnvKeys("");
        setNotice(isEditing ? `已更新自定义 MCP：${definition.title}` : `已添加 MCP：${definition.title}`);
      },
      { overlay: true },
    );
  }

  const currentChange = assetPlanQueue?.currentPlan.changes[selectedChangeIndex];
  const drawerMcpInstalled = drawerMcp
    ? installedForMcp(drawerMcp).find((record) => record.toolId === drawerMcpTool)
    : undefined;

  return (
    <div className="workspace-scroll">
      <header className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.assets}</h1>
        </div>
        <div className="page-header-actions">
          <div className="search-input-wrap">
            <MagnifyingGlass size={15} className="search-input-icon" aria-hidden="true" />
            <input
              type="search"
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称或标识"
              aria-label="搜索资产"
            />
          </div>
          <Dropdown<SourceFilter>
            label="来源筛选"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "all", label: "全部来源" },
              { value: "preset", label: "官方预设" },
              { value: "local", label: "本机导入 / 自定义" },
            ]}
          />
          {tab === "mcp" ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !api}
              onClick={() => openCustomMcpModal()}
            >
              <Plus size={15} aria-hidden="true" />
              添加 MCP
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !api}
              onClick={() => {
                if (api) {
                  void run(async () => {
                    const inspected = await api.inspectPluginSource();
                    if (mountedRef.current) {
                      setOverlayError("");
                      setPendingImport(inspected);
                    }
                  });
                }
              }}
            >
              <FolderPlus size={15} aria-hidden="true" />
              导入本地
            </button>
          )}
        </div>
      </header>

      <nav className="tab-bar" aria-label="资产类型">
        <button
          type="button"
          className={`tab-item${tab === "plugins" ? " active" : ""}`}
          onClick={() => setTab("plugins")}
        >
          <span>插件</span>
          <span className="badge badge--muted">{pluginsList.length}</span>
        </button>
        <button
          type="button"
          className={`tab-item${tab === "skills" ? " active" : ""}`}
          onClick={() => setTab("skills")}
        >
          <span>技能</span>
          <span className="badge badge--muted">{skillsList.length}</span>
        </button>
        <button
          type="button"
          className={`tab-item${tab === "mcp" ? " active" : ""}`}
          onClick={() => setTab("mcp")}
        >
          <span>MCP</span>
          <span className="badge badge--mcp">{mcpCatalog.length}</span>
        </button>
      </nav>

      <div className="pill-group" role="radiogroup" aria-label="安装状态筛选">
        <button
          type="button"
          className={`pill-btn${statusFilter === "all" ? " active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          全部
        </button>
        <button
          type="button"
          className={`pill-btn${statusFilter === "installed" ? " active" : ""}`}
          onClick={() => setStatusFilter("installed")}
        >
          已安装
        </button>
        <button
          type="button"
          className={`pill-btn${statusFilter === "uninstalled" ? " active" : ""}`}
          onClick={() => setStatusFilter("uninstalled")}
        >
          未安装
        </button>
      </div>

      {tab !== "mcp" ? (
        visibleAssets.length === 0 ? (
          <div className="empty-state">
            <span>{tab === "plugins" ? "暂无已导入插件" : "暂无已导入独立技能"}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !api}
              onClick={() => {
                if (api) {
                  void run(async () => {
                    const inspected = await api.inspectPluginSource();
                    if (mountedRef.current) {
                      setOverlayError("");
                      setPendingImport(inspected);
                    }
                  });
                }
              }}
            >
              <FolderPlus size={15} aria-hidden="true" />
              导入本地
            </button>
          </div>
        ) : (
          <section className="asset-card-grid">
            {visibleAssets.map((item) => {
              const records = installedForSource(item);
              const hasConflict = records.some((rec) => rec.issues.length > 0);
              const hasUpdate = records.some((rec) => assessAssetRecord(item, rec) === "updatable");
              return (
                <article className="asset-card" key={item.key}>
                  <div className="asset-card-head">
                    <IconTile size="lg">
                      <AssetGlyph kind={glyphForPlugin(item.name, item.kind)} size={28} />
                    </IconTile>
                    <div className="asset-card-info">
                      <div className="asset-card-title" title={item.title}>
                        {item.title}
                      </div>
                      <div className="asset-card-meta">
                        <span className="badge badge--muted">v{item.version}</span>
                        <span className={`badge ${item.preset ? "badge--brand" : "badge--enterprise"}`}>
                          {item.preset ? "官方预设" : "本机导入"}
                        </span>
                        {item.kind === "capability-plugin" && (
                          <span className="badge badge--muted">{item.skills.length} 个技能</span>
                        )}
                        {item.runtimeDependencies.length > 0 && (
                          <span className="badge badge--warning">需授权</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="asset-card-foot">
                    <div className="asset-card-meta">
                      {records.length > 0 ? (
                        records.map((rec) => {
                          const state = assessAssetRecord(item, rec);
                          const tone =
                            state === "conflict"
                              ? "badge--danger"
                              : state === "updatable"
                                ? "badge--brand"
                                : state === "different-version"
                                  ? "badge--muted"
                                  : "badge--success";
                          const label =
                            state === "conflict"
                              ? `冲突 · ${TOOL_LABELS[rec.target.ideId]}`
                              : state === "updatable"
                                ? `可更新 · ${TOOL_LABELS[rec.target.ideId]}`
                                : state === "different-version"
                                  ? `已装 v${rec.version} · ${TOOL_LABELS[rec.target.ideId]}`
                                  : `已装 · ${TOOL_LABELS[rec.target.ideId]}`;
                          return (
                            <span className={`badge ${tone}`} key={`${rec.target.ideId}:${rec.id}`}>
                              {label}
                            </span>
                          );
                        })
                      ) : (
                        <span className="badge badge--muted">未安装</span>
                      )}
                    </div>
                    <div className="asset-actions">
                      {item.delivery === "traework-skill" && (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const exported = await api.exportTraeWorkSkill(item.key);
                                if (exported && mountedRef.current) setNotice(`已导出：${exported.path}`);
                              });
                            }
                          }}
                        >
                          导出 ZIP
                        </button>
                      )}
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || !api}
                        onClick={() => openAssetDrawer(item)}
                      >
                        {hasConflict ? "修复 / 管理" : hasUpdate ? "更新 / 同步" : records.length > 0 ? "管理 / 同步" : "安装"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )
      ) : visibleMcps.length === 0 ? (
        <div className="empty-state">
          <span>暂无匹配的 MCP 连接器</span>
          <button type="button" className="secondary-button" disabled={busy || !api} onClick={() => openCustomMcpModal()}>
            <Plus size={15} aria-hidden="true" />
            添加 MCP
          </button>
        </div>
      ) : (
        <section className="asset-card-grid">
          {visibleMcps.map((server) => {
            const records = installedForMcp(server);
            return (
              <article className="asset-card" key={server.id}>
                <div className="asset-card-head">
                  <IconTile size="lg">
                    <AssetGlyph kind={glyphForMcp(server.id)} size={28} />
                  </IconTile>
                  <div className="asset-card-info">
                    <div className="asset-card-title" title={server.title}>
                      {server.title}
                    </div>
                    <div className="asset-card-meta">
                      <span className="badge badge--muted">v{server.version}</span>
                      <span className={`badge ${server.preset ? "badge--brand" : "badge--enterprise"}`}>
                        {server.preset ? "官方预设" : "自定义"}
                      </span>
                      <span className="badge badge--mcp">{server.transport.toUpperCase()}</span>
                    </div>
                    <span className="mono-inline">{server.id}</span>
                  </div>
                </div>

                <div className="asset-card-foot">
                  <div className="asset-card-meta">
                    {records.length > 0 ? (
                      records.map((rec) => {
                        const needsUpdate = !rec.issues.length && compareSemver(server.version, rec.version) > 0;
                        return (
                          <span
                            className={`badge ${rec.issues.length ? "badge--danger" : needsUpdate ? "badge--brand" : "badge--success"}`}
                            key={`${rec.toolId}:${rec.id}`}
                          >
                            {rec.issues.length ? "冲突" : needsUpdate ? "可更新" : "已配置"} · {TOOL_LABELS[rec.toolId]}
                          </span>
                        );
                      })
                    ) : (
                      <span className="badge badge--muted">未配置</span>
                    )}
                  </div>
                  <div className="asset-actions">
                    {!server.preset && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`编辑 ${server.title}`}
                        title="编辑定义"
                        disabled={busy || !api}
                        onClick={() => openCustomMcpModal(server)}
                      >
                        <PencilSimple size={15} />
                      </button>
                    )}
                    {!server.preset && records.length === 0 && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`删除 ${server.title}`}
                        title="删除自定义 MCP"
                        disabled={busy || !api}
                        onClick={() => {
                          if (api) {
                            void run(async () => {
                              await api.removeCustomMcp(server.id);
                              await refreshAll(api);
                              if (mountedRef.current) setNotice(`已删除自定义 MCP：${server.title}`);
                            });
                          }
                        }}
                      >
                        <Trash size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || !api}
                      onClick={() => openMcpDrawer(server)}
                    >
                      {records.length > 0 ? "配置 / 同步" : "安装配置"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {error && (
        <div className="feedback-error" role="alert">
          <WarningCircle size={17} style={{ flex: "none" }} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="feedback-notice" role="status">
          <CheckCircle size={17} style={{ flex: "none" }} />
          <span>{notice}</span>
        </div>
      )}

      {/* 右侧滑出安装抽屉：插件 / 技能 */}
      {drawerAsset && (
        <div className="drawer-backdrop">
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`安装 ${drawerAsset.title}`}>
            <header className="drawer-header">
              <div className="asset-card-head">
                <IconTile size="md">
                  <AssetGlyph kind={glyphForPlugin(drawerAsset.name, drawerAsset.kind)} size={22} />
                </IconTile>
                <div className="asset-card-info">
                  <strong>{drawerAsset.title}</strong>
                  <span className="mono-inline">
                    v{drawerAsset.version} · {drawerAsset.license}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setDrawerAsset(undefined);
                  setOverlayError("");
                }}
                disabled={busy}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>

            <div className="drawer-body">
              {overlayError && !assetPlanQueue && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}

              {drawerAsset.skills.length > 0 && (
                <div className="drawer-section">
                  <h3>包含技能 · {drawerAsset.skills.length}</h3>
                  <div className="asset-card-meta">
                    {drawerAsset.skills.map((skillName) => {
                      const active = skillPreview?.slug === skillName;
                      return (
                        <button
                          type="button"
                          className={`skill-chip-btn${active ? " active" : ""}`}
                          key={skillName}
                          title={skillName}
                          disabled={busy}
                          onClick={() => void toggleSkillPreview(drawerAsset, skillName)}
                        >
                          {drawerAsset.skillTitles?.[skillName] ?? skillName}
                        </button>
                      );
                    })}
                  </div>
                  {skillPreview && (
                    <div className="skill-preview-box">
                      <div className="skill-preview-head">
                        <strong>
                          {skillPreview.title}
                          <span className="mono-inline" style={{ marginLeft: 8 }}>
                            {skillPreview.slug}
                          </span>
                        </strong>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="收起技能详情"
                          onClick={() => setSkillPreview(undefined)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <pre className="skill-preview-body">{skillPreview.content}</pre>
                    </div>
                  )}
                </div>
              )}

              {drawerAsset.ruleCategories && drawerAsset.ruleCategories.length > 0 && (
                <div className="drawer-section">
                  <h3>关联底层规则 · {drawerAsset.ruleCategories.length}</h3>
                  <div className="asset-card-meta">
                    {drawerAsset.ruleCategories.map((packId) => {
                      const meta = RULEPACK_CATALOG.find((item) => item.id === packId);
                      return (
                        <span className="badge badge--brand" key={packId} title={packId}>
                          {meta?.name ?? packId}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="drawer-section">
                <h3>目标 AI 工具（可多选同步）</h3>
                {(["antigravity", "codex", "traework", "generic"] as AssetIde[]).map((ide) => {
                  const compat = assetCompatibility(drawerAsset, ide);
                  const existingAll = installedForSource(drawerAsset);
                  const installed = existingAll.find((rec) => rec.target.ideId === ide);
                  const sharedSibling =
                    drawerAsset.kind === "skill" && (ide === "codex" || ide === "generic")
                      ? existingAll.find((rec) => rec.target.ideId === (ide === "codex" ? "generic" : "codex"))
                      : undefined;
                  const state = installed ? assessAssetRecord(drawerAsset, installed) : undefined;
                  const checked = drawerAssetTools.includes(ide);
                  const probed = tools.find((t) => t.id === ide);
                  const blockedByShared = Boolean(!installed && sharedSibling);
                  return (
                    <button
                      type="button"
                      key={ide}
                      className={`drawer-tool-row${checked ? " selected" : ""}${!compat.supported || blockedByShared ? " disabled" : ""}`}
                      disabled={busy || !compat.supported || blockedByShared}
                      onClick={() => toggleDrawerAssetTool(ide)}
                    >
                      <div className="asset-card-meta">
                        <span className="check-box" aria-hidden="true">
                          {checked && <Check size={11} weight="bold" />}
                        </span>
                        <strong>{TOOL_LABELS[ide]}</strong>
                        {probed && <span className="badge badge--muted">{probed.statusLabel}</span>}
                      </div>
                      <div>
                        {!compat.supported ? (
                          <span className="badge badge--muted">{compat.reason}</span>
                        ) : blockedByShared && sharedSibling ? (
                          <span className="badge badge--muted">
                            共用目录 · 已装于 {TOOL_LABELS[sharedSibling.target.ideId]}
                          </span>
                        ) : state === "conflict" ? (
                          <span className="badge badge--danger">冲突·覆盖修复</span>
                        ) : state === "updatable" && installed ? (
                          <span className="badge badge--brand">
                            {installed.version === drawerAsset.version ? "有内容更新" : `可更新 (v${installed.version})`}
                          </span>
                        ) : state === "different-version" && installed ? (
                          <span className="badge badge--muted">已装 v{installed.version}</span>
                        ) : installed ? (
                          <span className="badge badge--success">已是最新</span>
                        ) : (
                          <span className="badge badge--brand">可安装</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <footer className="drawer-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDrawerAsset(undefined);
                  setOverlayError("");
                }}
                disabled={busy}
              >
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || drawerAssetTools.length === 0}
                onClick={() => void startAssetPreviewBatch()}
              >
                {(() => {
                  const existingForSelected = drawerAssetTools
                    .map((ide) => installedForSource(drawerAsset).find((rec) => rec.target.ideId === ide))
                    .filter((rec): rec is InstalledAssetRecord => Boolean(rec));
                  const hasConflict = existingForSelected.some((rec) => rec.issues.length > 0);
                  const base = hasConflict ? "覆盖修复预览" : existingForSelected.length > 0 ? "查看变更" : "安装";
                  return drawerAssetTools.length > 1 ? `${base} (${drawerAssetTools.length} 个工具)` : base;
                })()}
              </button>
            </footer>
          </aside>
        </div>
      )}

      {/* 右侧滑出安装抽屉：MCP（03-B） */}
      {drawerMcp && (
        <div className="drawer-backdrop">
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`配置 ${drawerMcp.title}`}>
            <header className="drawer-header">
              <div className="asset-card-head">
                <IconTile size="md">
                  <AssetGlyph kind={glyphForMcp(drawerMcp.id)} size={22} />
                </IconTile>
                <div className="asset-card-info">
                  <strong>{drawerMcp.title}</strong>
                  <span className="mono-inline">
                    {drawerMcp.id} · {drawerMcp.transport.toUpperCase()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setDrawerMcp(undefined);
                  setOverlayError("");
                }}
                disabled={busy}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </header>

            <div className="drawer-body">
              {overlayError && !mcpPreview && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}

              <div className="drawer-section">
                <h3>目标 AI 工具（单选）</h3>
                {(["antigravity", "codex"] as McpToolId[]).map((toolId) => {
                  const rec = installedForMcp(drawerMcp).find((item) => item.toolId === toolId);
                  const selected = drawerMcpTool === toolId;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      key={toolId}
                      className={`drawer-tool-row${selected ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => {
                        setDrawerMcpTool(toolId);
                        setOverlayError("");
                      }}
                    >
                      <div className="asset-card-meta">
                        <span className="radio-dot" aria-hidden="true" />
                        <strong>{TOOL_LABELS[toolId]}</strong>
                      </div>
                      <span
                        className={`badge ${
                          rec?.issues.length ? "badge--danger" : rec ? "badge--success" : "badge--muted"
                        }`}
                      >
                        {rec?.issues.length ? "冲突·需处理" : rec ? "已配置" : "未配置"}
                      </span>
                    </button>
                  );
                })}
                <div className="drawer-tool-row disabled">
                  <div className="asset-card-meta">
                    <span className="radio-dot" aria-hidden="true" />
                    <span>TRAE / 通用目录</span>
                  </div>
                  <span className="badge badge--muted">暂不支持 MCP 写入</span>
                </div>
              </div>

              {drawerMcp.envSchema.length > 0 && (
                <div className="drawer-section">
                  <div className="form-label-row">
                    <h3>本机连接参数</h3>
                    <span className="badge badge--success">
                      <ShieldCheck size={12} aria-hidden="true" />
                      仅存本机
                    </span>
                  </div>
                  {drawerMcp.envSchema.map((field) => {
                    const revealed = !!revealedMcpKeys[field.key];
                    return (
                      <label className="form-field" key={field.key}>
                        <span className="form-label-row">
                          <span>
                            {field.label} {field.required ? "*" : ""}
                          </span>
                          <span className="mono-inline">{field.key}</span>
                        </span>
                        <div className="secret-input-wrap">
                          <input
                            type={field.secret && !revealed ? "password" : "text"}
                            className="form-input mono"
                            value={mcpEnvValues[field.key] ?? ""}
                            placeholder={field.placeholder ?? ""}
                            onChange={(event) => {
                              setOverlayError("");
                              setMcpEnvValues((current) => ({ ...current, [field.key]: event.target.value }));
                            }}
                          />
                          {field.secret && (
                            <button
                              type="button"
                              className="text-button secret-toggle-btn"
                              onClick={() =>
                                setRevealedMcpKeys((cur) => ({ ...cur, [field.key]: !cur[field.key] }))
                              }
                            >
                              {revealed ? "隐藏" : "显示明文"}
                            </button>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="drawer-footer">
              {drawerMcpInstalled && (
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy}
                  onClick={() => void startMcpPreview("uninstall", drawerMcpInstalled.issues.length > 0)}
                >
                  {drawerMcpInstalled.issues.length > 0 ? "强制卸载" : "查看卸载范围"}
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDrawerMcp(undefined);
                  setOverlayError("");
                }}
                disabled={busy}
              >
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void startMcpPreview(
                    drawerMcpInstalled ? "update" : "install",
                    Boolean(drawerMcpInstalled?.issues.length),
                  )
                }
              >
                {drawerMcpInstalled?.issues.length ? "覆盖修复预览" : "查看配置变更"}
              </button>
            </footer>
          </aside>
        </div>
      )}

      {/* 本地导入预览弹窗 */}
      {pendingImport && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="导入预览">
            <header className="modal-header">
              <h2>导入预览</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setPendingImport(undefined);
                  setOverlayError("");
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              <div className="preview-meta">
                <strong>
                  {pendingImport.title} · v{pendingImport.version}
                </strong>
                <span>
                  {pendingImport.kind === "skill" ? "独立技能" : `插件 · ${pendingImport.skills.length} 技能`} ·{" "}
                  {pendingImport.files.length} 个文件 · {pendingImport.license}
                </span>
              </div>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setPendingImport(undefined);
                  setOverlayError("");
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  if (api) {
                    void run(
                      async () => {
                        await api.importPluginSource();
                        await refreshAll(api);
                        if (mountedRef.current) {
                          setPendingImport(undefined);
                          setNotice("导入完成");
                        }
                      },
                      { overlay: true },
                    );
                  }
                }}
              >
                确认导入
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 添加 / 编辑自定义 MCP 弹窗 */}
      {showAddMcp && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingCustomMcpId ? "编辑自定义 MCP" : "添加自定义 MCP"}
          >
            <header className="modal-header">
              <h2>{editingCustomMcpId ? "编辑自定义 MCP" : "添加自定义 MCP"}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setShowAddMcp(false);
                  setEditingCustomMcpId(undefined);
                  setOverlayError("");
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              <div className="drawer-section">
                <label className="form-field">
                  <span className="form-label-row">
                    <span>标识 ID *</span>
                    <span className="mono-inline">{editingCustomMcpId ? "编辑时不可变更" : "a-z / 0-9 / -"}</span>
                  </span>
                  <input
                    className="form-input mono"
                    value={customId}
                    disabled={Boolean(editingCustomMcpId)}
                    onChange={(e) => {
                      setOverlayError("");
                      setCustomId(e.target.value);
                    }}
                    placeholder="my-custom-mcp"
                  />
                </label>
                <label className="form-field">
                  <span className="form-label-row"><span>显示名称 *</span></span>
                  <input
                    className="form-input"
                    value={customTitle}
                    onChange={(e) => {
                      setOverlayError("");
                      setCustomTitle(e.target.value);
                    }}
                    placeholder="企业内部检索 MCP"
                  />
                </label>
                <label className="form-field">
                  <span className="form-label-row"><span>版本号</span></span>
                  <input
                    className="form-input mono"
                    value={customVersion}
                    onChange={(e) => {
                      setOverlayError("");
                      setCustomVersion(e.target.value);
                    }}
                    placeholder="1.0.0"
                  />
                </label>
                <div className="form-field">
                  <span className="form-label-row"><span>传输方式</span></span>
                  <div className="segmented">
                    <button
                      type="button"
                      className={customTransport === "stdio" ? "active" : ""}
                      onClick={() => {
                        setOverlayError("");
                        setCustomTransport("stdio");
                      }}
                    >
                      stdio（本机命令）
                    </button>
                    <button
                      type="button"
                      className={customTransport === "http" ? "active" : ""}
                      onClick={() => {
                        setOverlayError("");
                        setCustomTransport("http");
                      }}
                    >
                      HTTP（远程地址）
                    </button>
                  </div>
                </div>
                {customTransport === "stdio" ? (
                  <>
                    <label className="form-field">
                      <span className="form-label-row"><span>启动命令 *</span></span>
                      <input
                        className="form-input mono"
                        value={customCommand}
                        onChange={(e) => {
                          setOverlayError("");
                          setCustomCommand(e.target.value);
                        }}
                        placeholder="npx"
                      />
                    </label>
                    <label className="form-field">
                      <span className="form-label-row"><span>命令参数（空格分隔）</span></span>
                      <input
                        className="form-input mono"
                        value={customArgs}
                        onChange={(e) => {
                          setOverlayError("");
                          setCustomArgs(e.target.value);
                        }}
                        placeholder="-y @scope/mcp-server"
                      />
                    </label>
                  </>
                ) : (
                  <label className="form-field">
                    <span className="form-label-row"><span>远程地址（HTTPS / localhost）*</span></span>
                    <input
                      className="form-input mono"
                      value={customUrl}
                      onChange={(e) => {
                        setOverlayError("");
                        setCustomUrl(e.target.value);
                      }}
                      placeholder="https://mcp.example.com/sse"
                    />
                  </label>
                )}
                <label className="form-field">
                  <span className="form-label-row">
                    <span>{customTransport === "http" ? "HTTP Header 字段（支持连字符，逗号分隔）" : "环境变量字段（逗号分隔）"}</span>
                  </span>
                  <input
                    className="form-input mono"
                    value={customEnvKeys}
                    onChange={(e) => {
                      setOverlayError("");
                      setCustomEnvKeys(e.target.value);
                    }}
                    placeholder={customTransport === "http" ? "X-API-Key, Authorization" : "API_TOKEN, ORG_ID"}
                  />
                </label>
                <label className="asset-card-meta">
                  <input type="checkbox" checked={customEnvSecret} onChange={(e) => setCustomEnvSecret(e.target.checked)} />
                  <span>默认脱敏显示上述参数值</span>
                </label>
              </div>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setShowAddMcp(false);
                  setEditingCustomMcpId(undefined);
                  setOverlayError("");
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !customId.trim() || !customTitle.trim()}
                onClick={() => void submitCustomMcp()}
              >
                {editingCustomMcpId ? "保存修改" : "保存定义"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 资产安装/更新/卸载预览弹窗 */}
      {assetPlanQueue && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="资产变更预览">
            <header className="modal-header">
              <h2>
                {assetPlanQueue.force ? "覆盖修复" : ACTION_VERBS[assetPlanQueue.currentPlan.action]}预览 ·{" "}
                {TOOL_LABELS[assetPlanQueue.currentPlan.ideId as AssetIde] ?? assetPlanQueue.currentPlan.ideId}
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={closeAssetPlanModal}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="preview-meta">
                <strong>
                  {assetPlanQueue.currentPlan.title} · v{assetPlanQueue.currentPlan.version}
                </strong>
                <span>{assetPlanQueue.currentPlan.destination}</span>
              </div>
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              {assetPlanQueue.currentPlan.conflicts.length > 0 && (
                <div className="issue-box" role="alert">
                  <WarningCircle size={18} style={{ flex: "none" }} />
                  <div>
                    {assetPlanQueue.currentPlan.conflicts.map((conflict) => (
                      <p key={conflict}>{conflict}</p>
                    ))}
                  </div>
                </div>
              )}
              <div className="preview-section">
                <h3>文件变更 · {assetPlanQueue.currentPlan.changes.length}</h3>
                {assetPlanQueue.currentPlan.changes.length === 0 ? (
                  <div className="mono-inline">当前内容已是最新，无需写入。</div>
                ) : (
                  <div className="change-list">
                    {assetPlanQueue.currentPlan.changes.map((file, index) => (
                      <button
                        type="button"
                        className={`change-row${selectedChangeIndex === index ? " active" : ""}`}
                        key={file.path}
                        onClick={() => setSelectedChangeIndex(index)}
                      >
                        <span className={`change-action ${file.action}`}>
                          {file.action === "add" ? "新增" : file.action === "remove" ? "删除" : "修改"}
                        </span>
                        <span>{file.path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {currentChange && (
                <div className="file-diff">
                  <pre>{currentChange.before ?? "（原文件不存在）"}</pre>
                  <pre>{currentChange.after ?? "（将删除）"}</pre>
                </div>
              )}
              {assetPlanQueue.currentPlan.retainedPaths.length > 0 && (
                <div className="preview-section">
                  <h3>保留文件</h3>
                  <ul className="retained-list">
                    {assetPlanQueue.currentPlan.retainedPaths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <footer className="modal-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={closeAssetPlanModal}>
                返回
              </button>
              {assetPlanQueue.remainingTools.length > 0 && (
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void skipCurrentAssetPlan()}>
                  跳过此工具并继续
                </button>
              )}
              {assetPlanQueue.currentPlan.conflicts.length > 0 && !assetPlanQueue.force && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void retryCurrentAssetPlanWithForce()}
                >
                  覆盖修复预览
                </button>
              )}
              <button
                type="button"
                className={assetPlanQueue.currentPlan.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={
                  busy ||
                  assetPlanQueue.currentPlan.conflicts.length > 0 ||
                  assetPlanQueue.currentPlan.changes.length === 0
                }
                onClick={() => void applyCurrentAssetPlan()}
              >
                {assetPlanQueue.totalTools > 1
                  ? `确认${assetPlanQueue.force ? "覆盖修复" : ACTION_VERBS[assetPlanQueue.currentPlan.action]} (${assetPlanQueue.completedTools.length + 1}/${assetPlanQueue.totalTools})`
                  : `确认${assetPlanQueue.force ? "覆盖修复" : ACTION_VERBS[assetPlanQueue.currentPlan.action]}`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 06 · 态 C：MCP 脱敏配置预览弹窗 */}
      {mcpPreview && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="MCP 脱敏配置预览">
            <header className="modal-header">
              <h2>
                MCP {mcpPreview.force ? "覆盖修复" : ACTION_VERBS[mcpPreview.action]}确认 · {TOOL_LABELS[mcpPreview.toolId]}
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={closeMcpPreviewModal}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="preview-meta">
                <strong>
                  {mcpPreview.title} ({mcpPreview.id}) · v{mcpPreview.version}
                </strong>
                <span>写入路径：{mcpPreview.targetPath} · 敏感字段已脱敏</span>
              </div>
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              {mcpPreview.conflicts.length > 0 && (
                <div className="issue-box" role="alert">
                  <WarningCircle size={18} style={{ flex: "none" }} />
                  <div>
                    {mcpPreview.conflicts.map((conflict) => (
                      <p key={conflict}>{conflict}</p>
                    ))}
                  </div>
                </div>
              )}
              <div className="preview-section">
                <h3>配置文件对比（敏感值已脱敏）</h3>
                <div className="content-comparison">
                  <div>
                    <span>原内容</span>
                    <pre>{mcpPreview.maskedBefore}</pre>
                  </div>
                  <div>
                    <span>变更后</span>
                    <pre>{mcpPreview.maskedAfter}</pre>
                  </div>
                </div>
              </div>
            </div>
            <footer className="modal-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={closeMcpPreviewModal}>
                返回
              </button>
              {mcpPreview.conflicts.length > 0 && !mcpPreview.force && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void startMcpPreview(mcpPreview.action, true)}
                >
                  覆盖修复预览
                </button>
              )}
              <button
                type="button"
                className={mcpPreview.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={busy || mcpPreview.conflicts.length > 0}
                onClick={() => void applyCurrentMcpPreview()}
              >
                确认{mcpPreview.force ? "覆盖修复" : ACTION_VERBS[mcpPreview.action]}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
