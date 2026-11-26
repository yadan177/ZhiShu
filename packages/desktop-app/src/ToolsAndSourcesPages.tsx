import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Check, CheckCircle, FolderOpen, PencilSimple, Plus, ShieldCheck, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { AssetGlyph, IconTile, glyphForAsset } from "./BrandIcons";
import { APP_COPY, RULEPACK_CATALOG } from "./copy";
import { Dropdown } from "./Dropdown";
import {
  formatErrorMessage,
  type AssetIde,
  type AssetSourceRecord,
  type DesktopApi,
  type InstalledAssetRecord,
  type InstalledMcpRecord,
  type LegacyAssetCandidate,
  type LegacyMcpCandidate,
  type McpPreview,
  type McpServerDefinition,
  type McpToolId,
  type PluginSource,
  type SourceTestResult,
  type ToolInspection,
  type UserAssetPlan,
  type WorkspaceSourceInfo,
} from "./types";

const TOOL_LABELS: Record<AssetIde, string> = {
  codex: "OpenAI Codex",
  antigravity: "Antigravity",
  traework: "TRAE / TraeWork",
  generic: "通用标准目录",
};

const TOOL_SHORT_LABELS: Record<AssetIde, string> = {
  codex: "Codex",
  antigravity: "Antigravity",
  traework: "TRAE",
  generic: "通用目录",
};

const CAPABILITY_LABELS: Record<"rules" | "skill" | "mcp" | "plugin", string> = {
  rules: "规则",
  skill: "技能",
  mcp: "MCP",
  plugin: "插件",
};

const CAPABILITY_ORDER: Array<"rules" | "skill" | "mcp" | "plugin"> = ["rules", "skill", "mcp", "plugin"];

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

function formatCompactPath(rawPath: string): string {
  const unixHome = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(rawPath);
  if (unixHome) return `~${unixHome[1] ?? ""}`;
  const winHome = /^[A-Za-z]:\\Users\\[^\\]+(\\.*)?$/.exec(rawPath);
  if (winHome) return `~${(winHome[1] ?? "").replace(/\\/g, "/")}`;
  const sandboxHome = /\/user-home(\/.*)?$/.exec(rawPath);
  if (sandboxHome) return `~${sandboxHome[1] ?? ""}`;
  return rawPath;
}

function formatCapabilities(tool: ToolInspection): string {
  if (tool.id === "generic") return "多工具共享技能";
  return CAPABILITY_ORDER.filter((cap) => tool.capabilities.includes(cap))
    .map((cap) => CAPABILITY_LABELS[cap])
    .join(" · ");
}

function formatToolCount(tool: ToolInspection): string {
  const total = tool.counts.plugins + tool.counts.skills + tool.counts.mcps;
  if (total === 0) return "已装 0 项";
  const parts: string[] = [];
  if (tool.counts.plugins > 0) parts.push(`插件 ${tool.counts.plugins}`);
  if (tool.counts.skills > 0) parts.push(`技能 ${tool.counts.skills}`);
  if (tool.counts.mcps > 0) parts.push(`MCP ${tool.counts.mcps}`);
  return `已装 ${total} 项（${parts.join(" · ")}）`;
}

export function ToolsPage({
  api,
  onOpenAssets,
  onBusyChange,
}: {
  api?: DesktopApi;
  onOpenAssets: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [tools, setTools] = useState<ToolInspection[]>([]);
  const [selectedTool, setSelectedTool] = useState<AssetIde | "all">("all");
  const [sources, setSources] = useState<PluginSource[]>([]);
  const [installedAssets, setInstalledAssets] = useState<InstalledAssetRecord[]>([]);
  const [legacyItems, setLegacyItems] = useState<LegacyAssetCandidate[]>([]);
  const [legacyMcps, setLegacyMcps] = useState<LegacyMcpCandidate[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpServerDefinition[]>([]);
  const [installedMcps, setInstalledMcps] = useState<InstalledMcpRecord[]>([]);
  const [updateKeys, setUpdateKeys] = useState<Record<string, string>>({});

  const [showLegacyModal, setShowLegacyModal] = useState(false);
  const [selectedLegacyAssets, setSelectedLegacyAssets] = useState<string[]>([]);
  const [selectedLegacyMcps, setSelectedLegacyMcps] = useState<string[]>([]);
  const [assetPlan, setAssetPlan] = useState<UserAssetPlan & { force?: boolean }>();
  const [assetPlanChangeIdx, setAssetPlanChangeIdx] = useState(0);
  const [mcpPreview, setMcpPreview] = useState<McpPreview & { force?: boolean }>();
  const [editingMcp, setEditingMcp] = useState<{ record: InstalledMcpRecord; def: McpServerDefinition; force?: boolean }>();
  const [editEnv, setEditEnv] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [confirmForget, setConfirmForget] = useState<
    | { kind: "asset"; ide: AssetIde; id: string; title: string; destination: string }
    | { kind: "mcp"; toolId: McpToolId; id: string; title: string; targetPath: string }
  >();

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

  async function refreshAll(currentApi: DesktopApi): Promise<void> {
    if (currentApi.getToolsSnapshot) {
      const [snapshotRes, importsRes, catalogRes] = await Promise.allSettled([
        currentApi.getToolsSnapshot(),
        currentApi.listPluginImports(),
        currentApi.listMcpCatalog(),
      ]);
      if (!mountedRef.current) return;
      const errors: string[] = [];
      if (snapshotRes.status === "fulfilled") {
        setTools(snapshotRes.value.tools);
        setInstalledAssets(snapshotRes.value.assets);
        setInstalledMcps(snapshotRes.value.mcps);
        setLegacyItems(snapshotRes.value.legacyAssets);
        setLegacyMcps(snapshotRes.value.legacyMcps);
      } else {
        errors.push(formatErrorMessage(snapshotRes.reason));
      }
      if (importsRes.status === "fulfilled") setSources(importsRes.value);
      else errors.push(formatErrorMessage(importsRes.reason));
      if (catalogRes.status === "fulfilled") setMcpCatalog(catalogRes.value);
      else errors.push(formatErrorMessage(catalogRes.reason));
      if (errors.length > 0) setError(errors.join("；"));
      return;
    }
    const [toolRes, importsRes, assetsRes, catalogRes, mcpsRes, legacyRes, legacyMcpRes] = await Promise.allSettled([
      currentApi.inspectTools(),
      currentApi.listPluginImports(),
      currentApi.listUserAssets(),
      currentApi.listMcpCatalog(),
      currentApi.listInstalledMcps(),
      currentApi.inspectLegacyAssets ? currentApi.inspectLegacyAssets() : Promise.resolve([]),
      currentApi.inspectLegacyMcps ? currentApi.inspectLegacyMcps() : Promise.resolve([]),
    ]);
    if (!mountedRef.current) return;
    const errors: string[] = [];
    if (toolRes.status === "fulfilled") setTools(toolRes.value);
    else errors.push(formatErrorMessage(toolRes.reason));
    if (importsRes.status === "fulfilled") setSources(importsRes.value);
    else errors.push(formatErrorMessage(importsRes.reason));
    if (assetsRes.status === "fulfilled") setInstalledAssets(assetsRes.value);
    else errors.push(formatErrorMessage(assetsRes.reason));
    if (catalogRes.status === "fulfilled") setMcpCatalog(catalogRes.value);
    else errors.push(formatErrorMessage(catalogRes.reason));
    if (mcpsRes.status === "fulfilled") setInstalledMcps(mcpsRes.value);
    else errors.push(formatErrorMessage(mcpsRes.reason));
    if (legacyRes.status === "fulfilled") setLegacyItems(legacyRes.value);
    if (legacyMcpRes.status === "fulfilled") setLegacyMcps(legacyMcpRes.value);
    if (errors.length > 0) setError(errors.join("；"));
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

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
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

  const filteredAssets = selectedTool === "all"
    ? installedAssets
    : installedAssets.filter((item) => item.target.ideId === selectedTool);
  const filteredMcps = selectedTool === "all"
    ? installedMcps
    : installedMcps.filter((item) => item.toolId === selectedTool);
  const visibleLegacy = selectedTool === "all"
    ? legacyItems
    : legacyItems.filter((item) => item.ideId === selectedTool);
  const visibleLegacyMcps = selectedTool === "all"
    ? legacyMcps
    : legacyMcps.filter((item) => item.toolId === selectedTool);
  const totalLegacyCount = visibleLegacy.length + visibleLegacyMcps.length;

  function openLegacyModal(): void {
    setOverlayError("");
    setSelectedLegacyAssets(visibleLegacy.map((item) => item.key));
    setSelectedLegacyMcps(visibleLegacyMcps.map((item) => item.key));
    setShowLegacyModal(true);
  }

  function closeAssetPlanModal(): void {
    setAssetPlan(undefined);
    setOverlayError("");
    void api?.clearUserAssetPreview?.().catch(() => {});
  }

  function closeMcpPreviewModal(): void {
    setMcpPreview(undefined);
    setOverlayError("");
    void api?.clearMcpPreview?.().catch(() => {});
  }

  const enrichedAssets = filteredAssets.map((item) => {
    const sourceName = item.sourceKey.split("@")[0].replace(/^skill\./, "");
    const expectedKind = item.sourceKey.startsWith("skill.") ? "skill" : "capability-plugin";
    const candidates = sources
      .filter((candidate) => candidate.name === sourceName && candidate.kind === expectedKind)
      .sort((a, b) => compareSemver(a.version, b.version));
    const latestCandidate = candidates.at(-1);
    const hasNewerVersion = latestCandidate ? compareSemver(latestCandidate.version, item.version) > 0 : false;
    const itemDigest = normalizeDigest(item.sourceDigest);
    const latestDigest = normalizeDigest(latestCandidate?.sourceDigest);
    const hasContentUpdate = Boolean(
      !hasNewerVersion &&
        latestCandidate &&
        latestCandidate.version === item.version &&
        itemDigest &&
        latestDigest &&
        latestDigest !== itemDigest,
    );
    const isPreset = candidates.some((c) => c.preset) || (!item.sourceKey.startsWith("skill.") && sourceName.startsWith("zhishu-"));
    return { item, candidates, latestCandidate, hasNewerVersion, hasContentUpdate, isPreset };
  });

  const conflictCount =
    enrichedAssets.filter(({ item }) => item.issues.length > 0).length +
    filteredMcps.filter((record) => record.issues.length > 0).length;
  const updatableCount =
    enrichedAssets.filter(
      ({ item, hasNewerVersion, hasContentUpdate }) => item.issues.length === 0 && (hasNewerVersion || hasContentUpdate),
    ).length +
    filteredMcps.filter((record) => {
      if (record.issues.length > 0) return false;
      const def = mcpCatalog.find((item) => item.id === record.id);
      return Boolean(def && compareSemver(def.version, record.version) > 0);
    }).length;
  const totalVisibleCount = enrichedAssets.length + filteredMcps.length;
  const normalCount = Math.max(0, totalVisibleCount - conflictCount - updatableCount);
  const currentPlanChange = assetPlan?.changes[assetPlanChangeIdx];

  return (
    <div className="workspace-scroll">
      <header className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.tools}</h1>
          {tools.length > 0 && <span className="badge badge--brand">已检测 {tools.length} 个</span>}
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (api) void run(() => refreshAll(api));
            }}
            disabled={busy || !api}
          >
            <ArrowClockwise size={15} aria-hidden="true" />
            重新检查
          </button>
          <button type="button" className="primary-button" onClick={onOpenAssets}>
            前往{APP_COPY.nav.assets}
          </button>
        </div>
      </header>

      <section className="tool-grid" aria-label="本机 AI 工具检测">
        {tools.map((tool) => {
          const isSelected = selectedTool === tool.id;
          return (
            <button
              type="button"
              className={`tool-card${isSelected ? " selected" : ""}`}
              key={tool.id}
              onClick={() => setSelectedTool(isSelected ? "all" : tool.id)}
            >
              <div className="tool-card-head">
                <strong>{tool.name}</strong>
                <span
                  className={`badge ${
                    tool.experimental
                      ? "badge--warning"
                      : tool.id === "generic"
                        ? "badge--muted"
                        : tool.available
                          ? "badge--success"
                          : "badge--muted"
                  }`}
                >
                  {tool.id === "generic" ? "通用" : tool.statusLabel}
                </span>
              </div>
              <span className="tool-card-path" title={tool.paths.join("\n")}>
                {tool.displayPath}
              </span>
              <span className="tool-card-caps">{formatCapabilities(tool)}</span>
              <span className={`tool-card-count${isSelected ? " is-selected" : ""}`}>
                {formatToolCount(tool)}
              </span>
            </button>
          );
        })}
      </section>

      {totalLegacyCount > 0 && (
        <section className="legacy-takeover-banner" role="status" aria-label="旧版记录接管提示">
          <div className="legacy-takeover-left">
            <span className="badge badge--warning">旧版记录</span>
            <span>发现 {totalLegacyCount} 项旧版智枢记录或未纳管官方资产</span>
          </div>
          <button
            type="button"
            className="secondary-button btn-compact"
            disabled={busy || !api}
            onClick={openLegacyModal}
          >
            接管旧版
          </button>
        </section>
      )}

      <section className="surface-card">
        <div className="card-header">
          <div className="tools-list-header-left">
            <h2>{selectedTool === "all" ? "已安装清单" : `${TOOL_LABELS[selectedTool]} · 已安装`}</h2>
            {totalVisibleCount === 0 ? (
              <span className="badge badge--muted">0</span>
            ) : (
              <>
                {normalCount > 0 && <span className="badge badge--success">{normalCount} 正常</span>}
                {updatableCount > 0 && <span className="badge badge--brand">{updatableCount} 可更新</span>}
                {conflictCount > 0 && <span className="badge badge--danger">{conflictCount} 需处理</span>}
              </>
            )}
          </div>
          {selectedTool !== "all" && (
            <button
              type="button"
              className="secondary-button btn-compact"
              onClick={() => setSelectedTool("all")}
            >
              查看全部
            </button>
          )}
        </div>

        {totalVisibleCount === 0 ? (
          <div className="empty-state">
            <span>
              {selectedTool === "all"
                ? "暂无已安装的插件、技能或 MCP"
                : `${TOOL_LABELS[selectedTool]} 暂无已安装的插件、技能或 MCP`}
            </span>
            <button type="button" className="primary-button" onClick={onOpenAssets}>
              前往{APP_COPY.nav.assets}
            </button>
          </div>
        ) : (
          <div className="tool-asset-list">
            {enrichedAssets.map(({ item, candidates, latestCandidate, hasNewerVersion, hasContentUpdate, isPreset }) => {
              const rowKey = `${item.target.ideId}:${item.id}`;
              const hasConflict = item.issues.length > 0;
              const isMultiVersion = candidates.length >= 2;
              const selectedVersionKey =
                candidates.find((c) => c.key === updateKeys[rowKey])?.key ?? latestCandidate?.key ?? item.sourceKey;
              const selectedCandidate = candidates.find((c) => c.key === selectedVersionKey);
              const itemDigest = normalizeDigest(item.sourceDigest);
              const selectedDigest = normalizeDigest(selectedCandidate?.sourceDigest);
              const selectedDiffers = Boolean(
                selectedCandidate &&
                  (selectedCandidate.version !== item.version ||
                    (itemDigest && selectedDigest && selectedDigest !== itemDigest)),
              );
              const compactDest = formatCompactPath(item.destination);
              const subLineText = hasConflict
                ? `${compactDest} · ${item.issues[0]}${item.issues.length > 1 ? `（共 ${item.issues.length} 项）` : ""}`
                : compactDest;
              const subLineTitle = hasConflict
                ? `${item.destination}\n${item.issues.join("\n")}`
                : item.destination;

              return (
                <article className={`tool-asset-row${hasConflict ? " has-conflict" : ""}`} key={rowKey}>
                  <div className="tool-asset-main">
                    <IconTile size="sm">
                      <AssetGlyph kind={glyphForAsset(item.id, item.kind)} size={18} />
                    </IconTile>
                    <div className="tool-asset-info">
                      <div className="tool-asset-title-line">
                        <span className={`badge ${item.kind === "skill" ? "badge--brand" : "badge--enterprise"}`}>
                          {item.kind === "skill" ? "技能" : "插件"}
                        </span>
                        <strong className="tool-asset-title">{item.title}</strong>
                        <span className="tool-asset-version">v{item.version}</span>
                        <span className="badge badge--muted">{isPreset ? "官方预设" : "本地导入"}</span>
                        {selectedTool === "all" && (
                          <span className="badge badge--muted">{TOOL_SHORT_LABELS[item.target.ideId]}</span>
                        )}
                      </div>
                      <span
                        className={`tool-asset-path${hasConflict ? " is-danger" : ""}`}
                        title={subLineTitle}
                      >
                        {subLineText}
                      </span>
                    </div>
                  </div>

                  <div className="tool-asset-actions">
                    {hasConflict ? (
                      <>
                        <span className="badge badge--danger">冲突·需处理</span>
                        {latestCandidate && (
                          <button
                            type="button"
                            className="primary-button btn-compact"
                            disabled={busy || !api}
                            onClick={() => {
                              if (api) {
                                void run(async () => {
                                  const plan = await api.previewUserAsset(
                                    "update",
                                    latestCandidate.key,
                                    item.target.ideId,
                                    item.id,
                                    true,
                                  );
                                  if (mountedRef.current) {
                                    setAssetPlanChangeIdx(0);
                                    setOverlayError("");
                                    setAssetPlan({ ...plan, force: true });
                                  }
                                });
                              }
                            }}
                          >
                            覆盖修复
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger-outline-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset(
                                  "uninstall",
                                  "",
                                  item.target.ideId,
                                  item.id,
                                  true,
                                );
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan({ ...plan, force: true });
                                }
                              });
                            }
                          }}
                        >
                          强制卸载
                        </button>
                        {api?.forgetUserAsset && (
                          <button
                            type="button"
                            className="text-button btn-compact"
                            disabled={busy}
                            onClick={() => {
                              setOverlayError("");
                              setConfirmForget({
                                kind: "asset",
                                ide: item.target.ideId,
                                id: item.id,
                                title: item.title,
                                destination: item.destination,
                              });
                            }}
                          >
                            清除记录
                          </button>
                        )}
                      </>
                    ) : isMultiVersion ? (
                      <>
                        {hasNewerVersion && latestCandidate ? (
                          <span className="badge badge--brand">可更新至 v{latestCandidate.version}</span>
                        ) : hasContentUpdate ? (
                          <span className="badge badge--brand">有内容更新</span>
                        ) : (
                          <span className="badge badge--success">
                            {item.recognition === "host-verified" ? "已识别" : "正常"}
                          </span>
                        )}
                        {item.recognitionNote && <span className="badge badge--warning">已停用</span>}
                        <Dropdown
                          className="dropdown--compact"
                          label={`版本：${item.title}`}
                          value={selectedVersionKey}
                          disabled={busy}
                          onChange={(value) => setUpdateKeys((cur) => ({ ...cur, [rowKey]: value }))}
                          options={candidates.map((c) => ({ value: c.key, label: `v${c.version}` }))}
                        />
                        <button
                          type="button"
                          className={`${selectedDiffers ? "primary-button" : "secondary-button"} btn-compact`}
                          disabled={busy || !api || !selectedDiffers}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset(
                                  "update",
                                  selectedVersionKey,
                                  item.target.ideId,
                                  item.id,
                                );
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan(plan);
                                }
                              });
                            }
                          }}
                        >
                          更新
                        </button>
                        <button
                          type="button"
                          className="secondary-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset("uninstall", "", item.target.ideId, item.id);
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan(plan);
                                }
                              });
                            }
                          }}
                        >
                          卸载
                        </button>
                      </>
                    ) : (hasNewerVersion || hasContentUpdate) && latestCandidate ? (
                      <>
                        <span className="badge badge--brand">
                          {hasNewerVersion ? `可更新至 v${latestCandidate.version}` : "有内容更新"}
                        </span>
                        {item.recognitionNote && <span className="badge badge--warning">已停用</span>}
                        <button
                          type="button"
                          className="primary-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset(
                                  "update",
                                  latestCandidate.key,
                                  item.target.ideId,
                                  item.id,
                                );
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan(plan);
                                }
                              });
                            }
                          }}
                        >
                          更新
                        </button>
                        <button
                          type="button"
                          className="secondary-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset("uninstall", "", item.target.ideId, item.id);
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan(plan);
                                }
                              });
                            }
                          }}
                        >
                          卸载
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="badge badge--success">
                          {item.recognition === "host-verified" ? "已识别" : "正常"}
                        </span>
                        {item.recognitionNote && <span className="badge badge--warning">已停用</span>}
                        <button
                          type="button"
                          className="secondary-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const plan = await api.previewUserAsset("uninstall", "", item.target.ideId, item.id);
                                if (mountedRef.current) {
                                  setAssetPlanChangeIdx(0);
                                  setOverlayError("");
                                  setAssetPlan(plan);
                                }
                              });
                            }
                          }}
                        >
                          卸载
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}

            {filteredMcps.map((record) => {
              const def = mcpCatalog.find((item) => item.id === record.id);
              const hasConflict = record.issues.length > 0;
              const hasUpdate = Boolean(!hasConflict && def && compareSemver(def.version, record.version) > 0);
              const compactTarget = formatCompactPath(record.targetPath);
              const subLine = hasConflict
                ? `${compactTarget} · ${record.issues[0]}`
                : record.secretKeys.length > 0
                  ? `${compactTarget} · ${record.secretKeys.length} 项脱敏密钥`
                  : compactTarget;
              return (
                <article
                  className={`tool-asset-row${hasConflict ? " has-conflict" : ""}`}
                  key={`mcp:${record.toolId}:${record.id}`}
                >
                  <div className="tool-asset-main">
                    <IconTile size="sm">
                      <AssetGlyph kind={record.id === "feishu-mcp" ? "feishu" : "local_plugin"} size={18} />
                    </IconTile>
                    <div className="tool-asset-info">
                      <div className="tool-asset-title-line">
                        <span className="badge badge--mcp">MCP</span>
                        <strong className="tool-asset-title">{record.title}</strong>
                        <span className="tool-asset-version">v{record.version}</span>
                        <span className="badge badge--muted">{def?.preset ? "官方预设" : "自定义"}</span>
                        {selectedTool === "all" && (
                          <span className="badge badge--muted">{TOOL_SHORT_LABELS[record.toolId]}</span>
                        )}
                      </div>
                      <span
                        className={`tool-asset-path${hasConflict ? " is-danger" : ""}`}
                        title={hasConflict ? `${record.targetPath}\n${record.issues.join("\n")}` : record.targetPath}
                      >
                        {subLine}
                      </span>
                    </div>
                  </div>
                  <div className="tool-asset-actions">
                    <span
                      className={`badge ${
                        hasConflict ? "badge--danger" : hasUpdate ? "badge--brand" : "badge--success"
                      }`}
                    >
                      {hasConflict ? "冲突·需处理" : hasUpdate && def ? `可更新至 v${def.version}` : "正常"}
                    </span>
                    {hasConflict ? (
                      <>
                        {def && (
                          <button
                            type="button"
                            className="primary-button btn-compact"
                            disabled={busy || !api}
                            onClick={() => {
                              setOverlayError("");
                              if (def.envSchema.length > 0) {
                                setEditingMcp({ record, def, force: true });
                                setEditEnv(Object.fromEntries(def.envSchema.map((f) => [f.key, ""])));
                                setRevealedKeys({});
                              } else if (api) {
                                void run(async () => {
                                  const preview = await api.previewMcp("update", record.id, record.toolId, {}, true);
                                  if (mountedRef.current) setMcpPreview({ ...preview, force: true });
                                });
                              }
                            }}
                          >
                            覆盖修复
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger-outline-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const preview = await api.previewMcp("uninstall", record.id, record.toolId, {}, true);
                                if (mountedRef.current) {
                                  setOverlayError("");
                                  setMcpPreview({ ...preview, force: true });
                                }
                              });
                            }
                          }}
                        >
                          强制卸载
                        </button>
                        {api?.forgetMcp && (
                          <button
                            type="button"
                            className="text-button btn-compact"
                            disabled={busy}
                            onClick={() => {
                              setOverlayError("");
                              setConfirmForget({
                                kind: "mcp",
                                toolId: record.toolId,
                                id: record.id,
                                title: record.title,
                                targetPath: record.targetPath,
                              });
                            }}
                          >
                            清除记录
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {def && (def.envSchema.length > 0 || hasUpdate) && (
                          <button
                            type="button"
                            className={`${hasUpdate ? "primary-button" : "secondary-button"} btn-compact`}
                            disabled={busy || !api}
                            onClick={() => {
                              setOverlayError("");
                              if (def.envSchema.length > 0) {
                                setEditingMcp({ record, def });
                                setEditEnv(Object.fromEntries(def.envSchema.map((f) => [f.key, ""])));
                                setRevealedKeys({});
                              } else if (api) {
                                void run(async () => {
                                  const preview = await api.previewMcp("update", record.id, record.toolId, {});
                                  if (mountedRef.current) setMcpPreview(preview);
                                });
                              }
                            }}
                          >
                            {hasUpdate ? "更新" : "环境变量"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary-button btn-compact"
                          disabled={busy || !api}
                          onClick={() => {
                            if (api) {
                              void run(async () => {
                                const preview = await api.previewMcp("uninstall", record.id, record.toolId);
                                if (mountedRef.current) {
                                  setOverlayError("");
                                  setMcpPreview(preview);
                                }
                              });
                            }
                          }}
                        >
                          卸载
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

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

      {/* 接管旧版记录预览弹窗 (04-C) */}
      {showLegacyModal && totalLegacyCount > 0 && (
        <div className="modal-backdrop">
          <section className="modal legacy-modal" role="dialog" aria-modal="true" aria-label="接管旧版记录">
            <header className="modal-header">
              <div className="tools-list-header-left">
                <h2>接管旧版记录</h2>
                <span className="badge badge--warning">{totalLegacyCount} 项待接管</span>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setShowLegacyModal(false);
                  setOverlayError("");
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0, marginBottom: 10 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              <div className="target-config-strip">
                <span className="badge badge--success">按勾选接管</span>
                <span>仅补写智枢本地回执（旧版 Codex 插件会迁移至新数据目录），不覆盖目标工具已有技能</span>
              </div>
              <div className="tool-asset-list" style={{ marginTop: 12 }}>
                {visibleLegacy.map((item) => {
                  const checked = selectedLegacyAssets.includes(item.key);
                  return (
                    <article className={`tool-asset-row${item.issues.length ? " has-conflict" : ""}`} key={`asset:${item.key}`}>
                      <div className="tool-asset-main">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`勾选接管 ${item.title}`}
                          onChange={() =>
                            setSelectedLegacyAssets((cur) =>
                              cur.includes(item.key) ? cur.filter((k) => k !== item.key) : [...cur, item.key],
                            )
                          }
                        />
                        <IconTile size="sm">
                          <AssetGlyph kind={glyphForAsset(item.id, item.assetKind)} size={18} />
                        </IconTile>
                        <div className="tool-asset-info">
                          <div className="tool-asset-title-line">
                            <span className={`badge ${item.assetKind === "skill" ? "badge--brand" : "badge--enterprise"}`}>
                              {item.assetKind === "skill" ? "技能" : "插件"}
                            </span>
                            <strong className="tool-asset-title">{item.title}</strong>
                            <span className="tool-asset-version">v{item.version}</span>
                            <span className="badge badge--muted">{TOOL_SHORT_LABELS[item.ideId]}</span>
                          </div>
                          <span
                            className={`tool-asset-path${item.issues.length ? " is-danger" : ""}`}
                            title={item.issues.length ? `${item.destination}\n${item.issues.join("\n")}` : item.destination}
                          >
                            {formatCompactPath(item.destination)}
                            {item.issues.length > 0 ? ` · ${item.issues[0]}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="tool-asset-actions">
                        <span
                          className={`badge ${
                            item.issues.length
                              ? "badge--danger"
                              : item.kind === "legacy-receipt"
                                ? "badge--brand"
                                : "badge--warning"
                          }`}
                        >
                          {item.originLabel}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {visibleLegacyMcps.map((item) => {
                  const checked = selectedLegacyMcps.includes(item.key);
                  return (
                    <article className={`tool-asset-row${item.issues.length ? " has-conflict" : ""}`} key={`mcp:${item.key}`}>
                      <div className="tool-asset-main">
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-label={`勾选接管 ${item.title}`}
                          onChange={() =>
                            setSelectedLegacyMcps((cur) =>
                              cur.includes(item.key) ? cur.filter((k) => k !== item.key) : [...cur, item.key],
                            )
                          }
                        />
                        <IconTile size="sm">
                          <AssetGlyph kind={item.id === "feishu-mcp" ? "feishu" : "local_plugin"} size={18} />
                        </IconTile>
                        <div className="tool-asset-info">
                          <div className="tool-asset-title-line">
                            <span className="badge badge--mcp">MCP</span>
                            <strong className="tool-asset-title">{item.title}</strong>
                            <span className="tool-asset-version">v{item.version}</span>
                            <span className="badge badge--muted">{TOOL_SHORT_LABELS[item.toolId]}</span>
                          </div>
                          <span
                            className={`tool-asset-path${item.issues.length ? " is-danger" : ""}`}
                            title={item.issues.length ? `${item.targetPath}\n${item.issues.join("\n")}` : item.targetPath}
                          >
                            {formatCompactPath(item.targetPath)}
                            {item.issues.length > 0 ? ` · ${item.issues[0]}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="tool-asset-actions">
                        <span className={`badge ${item.issues.length ? "badge--danger" : "badge--brand"}`}>
                          {item.originLabel}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            <footer className="modal-actions modal-actions--spread">
              <span className="modal-footer-hint">接管后可在已安装清单中直接更新、修复或卸载</span>
              <div className="modal-actions-group">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setShowLegacyModal(false);
                    setOverlayError("");
                  }}
                >
                  返回
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !api || selectedLegacyAssets.length + selectedLegacyMcps.length === 0}
                  onClick={() => {
                    if (!api) return;
                    const assetKeys = [...selectedLegacyAssets];
                    const mcpKeys = [...selectedLegacyMcps];
                    void run(
                      async () => {
                        let adopted = 0;
                        try {
                          if (assetKeys.length > 0 && api.adoptLegacyAssets) {
                            const res = await api.adoptLegacyAssets(assetKeys);
                            adopted += res.adoptedCount;
                          }
                          if (mcpKeys.length > 0 && api.adoptLegacyMcps) {
                            const res = await api.adoptLegacyMcps(mcpKeys);
                            adopted += res.adoptedCount;
                          }
                        } finally {
                          await refreshAll(api);
                        }
                        if (mountedRef.current) {
                          setShowLegacyModal(false);
                          setNotice(`已接管 ${adopted} 项旧版记录`);
                        }
                      },
                      { overlay: true },
                    );
                  }}
                >
                  确认接管 ({selectedLegacyAssets.length + selectedLegacyMcps.length})
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {/* 清除记录确认弹窗 */}
      {confirmForget && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="确认清除本地记录">
            <header className="modal-header">
              <h2>清除智枢安装记录</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setConfirmForget(undefined);
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
                <strong>{confirmForget.title}</strong>
                <span>{confirmForget.kind === "asset" ? confirmForget.destination : confirmForget.targetPath}</span>
              </div>
              <p className="mono-inline" style={{ marginTop: 10 }}>
                仅移除智枢本地跟踪回执，不修改或删除目标工具目录中的已有文件。
              </p>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setConfirmForget(undefined);
                  setOverlayError("");
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy || !api}
                onClick={() => {
                  if (!api) return;
                  const target = confirmForget;
                  void run(
                    async () => {
                      if (target.kind === "asset" && api.forgetUserAsset) {
                        await api.forgetUserAsset(target.ide, target.id);
                      } else if (target.kind === "mcp" && api.forgetMcp) {
                        await api.forgetMcp(target.toolId, target.id);
                      }
                      await refreshAll(api);
                      if (mountedRef.current) {
                        setConfirmForget(undefined);
                        setNotice(`已清除记录：${target.title}`);
                      }
                    },
                    { overlay: true },
                  );
                }}
              >
                确认清除记录
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* MCP 环境变量快捷修改 / 覆盖修复弹窗 */}
      {editingMcp && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="修改 MCP 环境变量">
            <header className="modal-header">
              <h2>
                {editingMcp.force ? "覆盖修复 · " : "修改环境变量 · "}
                {editingMcp.record.title} ({TOOL_LABELS[editingMcp.record.toolId]})
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setEditingMcp(undefined);
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
                <div className="target-config-strip">
                  <span className="badge badge--muted">目标配置</span>
                  <span className="mono-inline" title={editingMcp.record.targetPath}>
                    {editingMcp.record.targetPath}
                  </span>
                </div>
                <div className="form-label-row">
                  <span>重新填写本机参数</span>
                  <span className="badge badge--success">
                    <ShieldCheck size={12} aria-hidden="true" />
                    仅存本机
                  </span>
                </div>
                {editingMcp.def.envSchema.map((field) => {
                  const revealed = !!revealedKeys[field.key];
                  return (
                    <label className="form-field" key={field.key}>
                      <span className="form-label-row">
                        <span>{field.label}</span>
                        <span className="mono-inline">{field.key}</span>
                      </span>
                      <div className="secret-input-wrap">
                        <input
                          type={field.secret && !revealed ? "password" : "text"}
                          className="form-input mono"
                          value={editEnv[field.key] ?? ""}
                          placeholder={field.placeholder ?? ""}
                          onChange={(e) => {
                            setOverlayError("");
                            setEditEnv((cur) => ({ ...cur, [field.key]: e.target.value }));
                          }}
                        />
                        {field.secret && (
                          <button
                            type="button"
                            className="text-button secret-toggle-btn"
                            onClick={() =>
                              setRevealedKeys((cur) => ({ ...cur, [field.key]: !cur[field.key] }))
                            }
                          >
                            {revealed ? "隐藏" : "显示明文"}
                          </button>
                        )}
                      </div>
                    </label>
                  );
                })}
                <div className="security-notice">
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>密钥仅写入本机工具配置文件，不上传至规则源或资产包</span>
                </div>
              </div>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setEditingMcp(undefined);
                  setOverlayError("");
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !api}
                onClick={() => {
                  if (api) {
                    const target = editingMcp;
                    void run(
                      async () => {
                        const preview = await api.previewMcp(
                          "update",
                          target.record.id,
                          target.record.toolId,
                          editEnv,
                          Boolean(target.force),
                        );
                        if (mountedRef.current) {
                          setEditingMcp(undefined);
                          setMcpPreview({ ...preview, force: target.force });
                        }
                      },
                      { overlay: true },
                    );
                  }
                }}
              >
                {editingMcp.force ? "覆盖修复预览" : "查看配置变更"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 资产更新/卸载/覆盖修复预览弹窗 */}
      {assetPlan && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="变更预览">
            <header className="modal-header">
              <h2>
                {assetPlan.force
                  ? assetPlan.action === "uninstall"
                    ? "强制卸载预览"
                    : "覆盖修复预览"
                  : `${ACTION_VERBS[assetPlan.action]}预览`}{" "}
                · {TOOL_LABELS[assetPlan.ideId as AssetIde] ?? assetPlan.ideId}
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={closeAssetPlanModal}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="preview-meta">
                <strong>
                  {assetPlan.title} · v{assetPlan.version}
                </strong>
                <span>{assetPlan.destination}</span>
              </div>
              {overlayError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{overlayError}</span>
                </div>
              )}
              {assetPlan.conflicts.length > 0 && (
                <div className="issue-box" role="alert">
                  <WarningCircle size={18} style={{ flex: "none" }} />
                  <div>
                    {assetPlan.conflicts.map((conflict) => (
                      <p key={conflict}>{conflict}</p>
                    ))}
                  </div>
                </div>
              )}
              <div className="preview-section">
                <h3>文件变更 · {assetPlan.changes.length}</h3>
                {assetPlan.changes.length === 0 ? (
                  <div className="mono-inline">受管文件内容一致，仅刷新本地回执。</div>
                ) : (
                  <div className="change-list">
                    {assetPlan.changes.map((file, index) => (
                      <button
                        type="button"
                        className={`change-row${assetPlanChangeIdx === index ? " active" : ""}`}
                        key={file.path}
                        onClick={() => setAssetPlanChangeIdx(index)}
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
              {currentPlanChange && (
                <div className="file-diff">
                  <pre>{currentPlanChange.before ?? "（原文件不存在）"}</pre>
                  <pre>{currentPlanChange.after ?? "（将删除）"}</pre>
                </div>
              )}
              {assetPlan.retainedPaths.length > 0 && (
                <div className="preview-section">
                  <h3>保留用户文件 · {assetPlan.retainedPaths.length}</h3>
                  <ul className="retained-list">
                    {assetPlan.retainedPaths.map((item) => (
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
              <button
                type="button"
                className={assetPlan.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={busy || assetPlan.conflicts.length > 0 || !api}
                onClick={() => {
                  if (api) {
                    const current = assetPlan;
                    void run(
                      async () => {
                        await api.applyUserAsset(current.token);
                        await refreshAll(api);
                        if (mountedRef.current) {
                          setAssetPlan(undefined);
                          setNotice(
                            current.force
                              ? current.action === "uninstall"
                                ? "强制卸载完成"
                                : "覆盖修复完成"
                              : `${ACTION_VERBS[current.action]}完成`,
                          );
                        }
                      },
                      { overlay: true },
                    );
                  }
                }}
              >
                {assetPlan.force
                  ? assetPlan.action === "uninstall"
                    ? "确认强制卸载"
                    : "确认覆盖修复"
                  : `确认${ACTION_VERBS[assetPlan.action]}`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* MCP 脱敏预览弹窗 */}
      {mcpPreview && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="MCP 变更预览">
            <header className="modal-header">
              <h2>
                MCP{" "}
                {mcpPreview.force
                  ? mcpPreview.action === "uninstall"
                    ? "强制卸载"
                    : "覆盖修复"
                  : ACTION_VERBS[mcpPreview.action]}
                确认 · {TOOL_LABELS[mcpPreview.toolId]}
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
                <span>{mcpPreview.targetPath} · 敏感字段已脱敏</span>
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
                <h3>配置文件对比</h3>
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
              <button
                type="button"
                className={mcpPreview.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={busy || mcpPreview.conflicts.length > 0 || !api}
                onClick={() => {
                  if (api) {
                    const current = mcpPreview;
                    void run(
                      async () => {
                        await api.applyMcp(current.token);
                        await refreshAll(api);
                        if (mountedRef.current) {
                          setMcpPreview(undefined);
                          setNotice(
                            current.force
                              ? current.action === "uninstall"
                                ? "MCP 强制卸载完成"
                                : "MCP 覆盖修复完成"
                              : `MCP ${ACTION_VERBS[current.action]}完成`,
                          );
                        }
                      },
                      { overlay: true },
                    );
                  }
                }}
              >
                {mcpPreview.force
                  ? mcpPreview.action === "uninstall"
                    ? "确认强制卸载"
                    : "确认覆盖修复"
                  : `确认${ACTION_VERBS[mcpPreview.action]}`}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export function SourcesPage({
  api,
  sources,
  workspaceSource,
  onSourcesChange,
  onWorkspaceSourceChange,
  onOpenAssets,
  onBusyChange,
}: {
  api?: DesktopApi;
  sources: AssetSourceRecord[];
  workspaceSource?: WorkspaceSourceInfo;
  onSourcesChange: (next: AssetSourceRecord[]) => void;
  onWorkspaceSourceChange: (next: WorkspaceSourceInfo) => void;
  onOpenAssets: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [imports, setImports] = useState<PluginSource[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSource, setEditingSource] = useState<AssetSourceRecord>();
  const [confirmRemove, setConfirmRemove] = useState<AssetSourceRecord>();
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formTier, setFormTier] = useState<"enterprise" | "personal">("enterprise");
  const [formAccess, setFormAccess] = useState<"local" | "git">("git");
  const [formLocation, setFormLocation] = useState("");
  const [formBranch, setFormBranch] = useState("main");
  const [formToken, setFormToken] = useState("");
  const [formClearToken, setFormClearToken] = useState(false);
  const [formRequired, setFormRequired] = useState<string[]>(["common"]);
  const [testResult, setTestResult] = useState<SourceTestResult>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
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

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    void Promise.allSettled([api.listPluginImports(), api.listSources()])
      .then(([importsRes, sourcesRes]) => {
        if (cancelled || !mountedRef.current) return;
        const errors: string[] = [];
        if (importsRes.status === "fulfilled") setImports(importsRes.value);
        else errors.push(formatErrorMessage(importsRes.reason));
        if (sourcesRes.status === "fulfilled") onSourcesChange(sourcesRes.value);
        else errors.push(formatErrorMessage(sourcesRes.reason));
        if (errors.length > 0) setError(errors.join("；"));
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function run(action: () => Promise<void>, options: { modal?: boolean } = {}): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyState(true);
    if (options.modal) setModalError("");
    else setError("");
    setNotice("");
    try {
      await action();
    } catch (problem) {
      if (!mountedRef.current) return;
      const msg = formatErrorMessage(problem);
      if (options.modal) setModalError(msg);
      else setError(msg);
    } finally {
      inFlightRef.current = false;
      setBusyState(false);
    }
  }

  function closeSourceModal(): void {
    setShowAdd(false);
    setEditingSource(undefined);
    setFormToken("");
    setFormClearToken(false);
    setTestResult(undefined);
    setModalError("");
  }

  function openAddSourceModal(): void {
    setEditingSource(undefined);
    setFormId("");
    setFormName("");
    setFormTier("enterprise");
    setFormAccess("git");
    setFormLocation("");
    setFormBranch("main");
    setFormToken("");
    setFormClearToken(false);
    setFormRequired(["common"]);
    setTestResult(undefined);
    setModalError("");
    setShowAdd(true);
  }

  function openEditSourceModal(src: AssetSourceRecord): void {
    setEditingSource(src);
    setFormId(src.id);
    setFormName(src.name);
    setFormTier(src.tier === "enterprise" ? "enterprise" : "personal");
    setFormAccess(src.access === "local" ? "local" : "git");
    setFormLocation(src.location);
    setFormBranch(src.branch ?? "");
    setFormToken("");
    setFormClearToken(false);
    setFormRequired([...src.requiredRulepacks]);
    setTestResult(undefined);
    setModalError("");
    setShowAdd(true);
  }

  function toggleRequiredPack(packId: string): void {
    setModalError("");
    setFormRequired((current) =>
      current.includes(packId) ? current.filter((item) => item !== packId) : [...current, packId],
    );
  }

  async function handleChooseTempWorkspace(): Promise<void> {
    if (!api) return;
    await run(async () => {
      const selected = await api.chooseWorkspaceSource();
      if (selected && mountedRef.current) {
        onWorkspaceSourceChange(selected);
        setNotice(`已加载临时本地规则源（${selected.packs.length} 个规则包）`);
      }
    });
  }

  async function handleExport(key: string): Promise<void> {
    if (!api) return;
    await run(async () => {
      const result = await api.exportTraeWorkSkill(key);
      if (result && mountedRef.current) setNotice(`已导出：${result.path}`);
    });
  }

  async function handleTestForm(): Promise<void> {
    if (!api) return;
    setTestResult(undefined);
    await run(
      async () => {
        const result = await api.testSource({
          id: editingSource?.id,
          access: formAccess,
          location: formLocation.trim(),
          branch: formAccess === "git" ? formBranch.trim() || undefined : undefined,
          token: formAccess === "git" && !formClearToken ? formToken.trim() || undefined : undefined,
        });
        if (mountedRef.current) setTestResult(result);
      },
      { modal: true },
    );
  }

  async function handleSubmitSource(): Promise<void> {
    if (!api) return;
    await run(
      async () => {
        if (editingSource && api.updateSource) {
          const next = await api.updateSource({
            id: editingSource.id,
            name: formName.trim(),
            branch: formAccess === "git" ? formBranch.trim() : undefined,
            token: formAccess === "git" && !formClearToken ? formToken.trim() || undefined : undefined,
            clearToken: formClearToken,
            requiredRulepacks: formTier === "enterprise" ? formRequired : [],
          });
          onSourcesChange(next);
          if (mountedRef.current) {
            closeSourceModal();
            setNotice("来源已更新");
          }
          return;
        }
        const next = await api.addSource({
          id: formId.trim(),
          name: formName.trim(),
          tier: formTier,
          access: formAccess,
          location: formLocation.trim(),
          branch: formAccess === "git" ? formBranch.trim() || undefined : undefined,
          token: formAccess === "git" ? formToken.trim() || undefined : undefined,
          requiredRulepacks: formTier === "enterprise" ? formRequired : [],
        });
        onSourcesChange(next);
        if (mountedRef.current) {
          closeSourceModal();
          setNotice("来源已添加");
        }
      },
      { modal: true },
    );
  }

  const tierLabel = { enterprise: "企业源", personal: "个人源", official: "官方源" } as const;
  const tierTone = { enterprise: "badge--enterprise", personal: "badge--brand", official: "badge--success" } as const;
  const accessLabel = { local: "本地目录", git: "私有 Git", "github-release": "GitHub Release" } as const;

  return (
    <div className="workspace-scroll">
      <header className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.sources}</h1>
          <span className="badge badge--muted">{sources.length}</span>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleChooseTempWorkspace()}
            disabled={busy || !api}
          >
            <FolderOpen size={15} aria-hidden="true" />
            临时本地规则源
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={openAddSourceModal}
            disabled={busy || !api}
          >
            <Plus size={15} aria-hidden="true" />
            添加来源
          </button>
        </div>
      </header>

      <section className="surface-card">
        <div className="card-header">
          <h2>已接入来源</h2>
          {workspaceSource && (
            <span className="badge badge--muted">临时工作区：{workspaceSource.packs.length} 包</span>
          )}
        </div>

        {sources.map((src) => (
          <article className="source-card" key={src.id}>
            <div className="source-card-main">
              <div className="project-card-title-row">
                <strong>{src.name}</strong>
                <span className={`badge ${tierTone[src.tier]}`}>{tierLabel[src.tier]}</span>
                <span className="badge badge--muted">{accessLabel[src.access]}</span>
                {src.readonly && <span className="badge badge--muted">内置只读</span>}
                {src.tier === "enterprise" && src.requiredRulepacks.length > 0 && (
                  <span className="badge badge--enterprise">必选 {src.requiredRulepacks.length} 项</span>
                )}
                {src.availableRulepacks && (
                  <span className="badge badge--success">{src.availableRulepacks.length} 规则包</span>
                )}
                {src.hasLocalToken && (
                  <span className="badge badge--muted">凭据 {src.maskedToken ?? "••••"}</span>
                )}
              </div>
              <span className="mono-inline" title={src.location}>
                {src.location}
                {src.branch ? ` · ${src.branch}` : ""}
                {src.lastSyncedAt ? ` · 上次同步 ${src.lastSyncedAt.slice(0, 16).replace("T", " ")}` : ""}
              </span>
            </div>

            <div className="asset-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !api}
                onClick={() => {
                  if (api) {
                    void run(async () => {
                      const result = await api.testSource({
                        id: src.id,
                        access: src.access,
                        location: src.location,
                        branch: src.branch,
                      });
                      if (mountedRef.current) setNotice(`${src.name}：${result.message}`);
                    });
                  }
                }}
              >
                测试连接
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !api}
                onClick={() => {
                  if (api) {
                    void run(async () => {
                      const result = await api.syncSource(src.id);
                      onSourcesChange(result.sources);
                      if (mountedRef.current) setNotice(result.message);
                    });
                  }
                }}
              >
                <ArrowClockwise size={14} aria-hidden="true" />
                同步
              </button>
              {!src.readonly && api?.updateSource && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => openEditSourceModal(src)}
                >
                  <PencilSimple size={14} aria-hidden="true" />
                  编辑
                </button>
              )}
              {!src.readonly && (
                <button
                  type="button"
                  className="danger-outline-button"
                  aria-label={`移除 ${src.name}`}
                  disabled={busy || !api}
                  onClick={() => {
                    setModalError("");
                    setConfirmRemove(src);
                  }}
                >
                  <Trash size={14} aria-hidden="true" />
                  移除
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="surface-card">
        <div className="card-header">
          <h2>本机导入快照</h2>
          <div className="page-header-actions">
            <span className="badge badge--muted">{imports.filter((item) => !item.preset).length}</span>
            <button type="button" className="text-button" onClick={onOpenAssets}>
              去安装
            </button>
          </div>
        </div>
        {imports.filter((item) => !item.preset).length === 0 ? (
          <div className="empty-state">
            <span>暂无本机导入快照</span>
          </div>
        ) : (
          imports.filter((item) => !item.preset).map((item) => (
            <article className="imported-plugin" key={item.key}>
              <div className="imported-plugin-row">
                <IconTile size="sm">
                  <AssetGlyph kind={item.kind === "skill" ? "skill" : "local_plugin"} size={18} />
                </IconTile>
                <strong>
                  {item.title} · v{item.version}
                </strong>
                <span className={`badge ${item.kind === "skill" ? "badge--brand" : "badge--enterprise"}`}>
                  {item.kind === "skill" ? "技能" : `插件 · ${item.skills.length} 技能`}
                </span>
                <span className="badge badge--muted">{item.license}</span>
              </div>
              <div className="asset-actions">
                <button type="button" className="secondary-button" onClick={onOpenAssets}>
                  去安装
                </button>
                {item.delivery === "traework-skill" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !api}
                    onClick={() => void handleExport(item.key)}
                  >
                    导出技能包
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </section>

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

      {/* 移除来源二次确认弹窗 */}
      {confirmRemove && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="确认移除来源">
            <header className="modal-header">
              <h2>移除来源</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => {
                  setConfirmRemove(undefined);
                  setModalError("");
                }}
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {modalError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{modalError}</span>
                </div>
              )}
              <div className="preview-meta">
                <strong>{confirmRemove.name}</strong>
                <span>{confirmRemove.location}</span>
              </div>
              <p className="mono-inline" style={{ marginTop: 10 }}>
                {confirmRemove.access === "git"
                  ? "移除后将清理本机同步缓存与已存凭据；若已有项目指向该缓存路径，后续更新需重新绑定来源。"
                  : "移除仅解除智枢来源登记，不会删除你的本地目录文件。"}
              </p>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setConfirmRemove(undefined);
                  setModalError("");
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy || !api}
                onClick={() => {
                  if (!api) return;
                  const target = confirmRemove;
                  void run(
                    async () => {
                      const next = await api.removeSource(target.id);
                      onSourcesChange(next);
                      if (mountedRef.current) {
                        setConfirmRemove(undefined);
                        setNotice(`已移除来源：${target.name}`);
                      }
                    },
                    { modal: true },
                  );
                }}
              >
                确认移除
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 05-B · 添加 / 编辑来源弹窗 */}
      {showAdd && (
        <div className="modal-backdrop">
          <section
            className="modal preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingSource ? "编辑来源" : "添加来源"}
          >
            <header className="modal-header">
              <h2>{editingSource ? `编辑来源 · ${editingSource.id}` : "添加来源"}</h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={closeSourceModal}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              {modalError && (
                <div className="feedback-error" role="alert" style={{ marginTop: 0 }}>
                  <WarningCircle size={17} style={{ flex: "none" }} />
                  <span>{modalError}</span>
                </div>
              )}
              <div className="drawer-section">
                {!editingSource && (
                  <div className="form-field">
                    <span className="form-label-row"><span>来源级别</span></span>
                    <div className="segmented">
                      <button
                        type="button"
                        className={formTier === "enterprise" ? "active" : ""}
                        onClick={() => {
                          setFormTier("enterprise");
                          setModalError("");
                        }}
                      >
                        企业源（支持必选规范）
                      </button>
                      <button
                        type="button"
                        className={formTier === "personal" ? "active" : ""}
                        onClick={() => {
                          setFormTier("personal");
                          setModalError("");
                        }}
                      >
                        个人源
                      </button>
                    </div>
                  </div>
                )}

                <label className="form-field">
                  <span className="form-label-row">
                    <span>来源标识 ID *</span>
                    <span className="mono-inline">{editingSource ? "编辑时不可变更" : "a-z / 0-9 / -"}</span>
                  </span>
                  <input
                    className="form-input mono"
                    value={formId}
                    disabled={Boolean(editingSource)}
                    onChange={(e) => {
                      setFormId(e.target.value);
                      setModalError("");
                    }}
                    placeholder="corp-xr-rules"
                  />
                </label>

                <label className="form-field">
                  <span className="form-label-row"><span>来源名称 *</span></span>
                  <input
                    className="form-input"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setModalError("");
                    }}
                    placeholder="企业 XR 产研规范源"
                  />
                </label>

                {!editingSource && (
                  <div className="form-field">
                    <span className="form-label-row"><span>接入方式</span></span>
                    <div className="segmented">
                      <button
                        type="button"
                        className={formAccess === "git" ? "active" : ""}
                        onClick={() => {
                          setFormAccess("git");
                          setTestResult(undefined);
                          setModalError("");
                        }}
                      >
                        私有 Git 仓库
                      </button>
                      <button
                        type="button"
                        className={formAccess === "local" ? "active" : ""}
                        onClick={() => {
                          setFormAccess("local");
                          setTestResult(undefined);
                          setModalError("");
                        }}
                      >
                        本地目录
                      </button>
                    </div>
                  </div>
                )}

                <div className="form-field">
                  <span className="form-label-row">
                    <span>{formAccess === "git" ? "仓库地址（HTTPS / SSH）*" : "本地目录绝对路径 *"}</span>
                  </span>
                  <div className="source-row">
                    <input
                      className="form-input mono"
                      style={{ flex: 1 }}
                      value={formLocation}
                      disabled={Boolean(editingSource)}
                      onChange={(e) => {
                        setFormLocation(e.target.value);
                        setTestResult(undefined);
                        setModalError("");
                      }}
                      placeholder={formAccess === "git" ? "https://git.corp.example/org/zhishu-rules.git" : "/path/to/rules-repo"}
                    />
                    {formAccess === "local" && !editingSource && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !api}
                        onClick={() => {
                          if (api) {
                            void run(
                              async () => {
                                const picked = await api.chooseSourceDir();
                                if (picked && mountedRef.current) {
                                  setFormLocation(picked);
                                  setTestResult(undefined);
                                }
                              },
                              { modal: true },
                            );
                          }
                        }}
                      >
                        浏览
                      </button>
                    )}
                  </div>
                </div>

                {formAccess === "git" && (
                  <>
                    <label className="form-field">
                      <span className="form-label-row"><span>分支</span></span>
                      <input
                        className="form-input mono"
                        value={formBranch}
                        onChange={(e) => {
                          setFormBranch(e.target.value);
                          setTestResult(undefined);
                          setModalError("");
                        }}
                        placeholder="main"
                      />
                    </label>
                    <label className="form-field">
                      <span className="form-label-row">
                        <span>HTTPS 访问令牌（可选）</span>
                        <span className="badge badge--success">
                          <ShieldCheck size={12} aria-hidden="true" />
                          仅存本机
                        </span>
                      </span>
                      <input
                        type="password"
                        className="form-input mono"
                        disabled={formClearToken}
                        value={formToken}
                        onChange={(e) => {
                          setFormToken(e.target.value);
                          setTestResult(undefined);
                          setModalError("");
                        }}
                        placeholder={
                          editingSource?.hasLocalToken
                            ? `留空保留当前凭据（${editingSource.maskedToken ?? "••••"}）`
                            : "留空则使用本机 SSH 或系统 Git 凭据"
                        }
                      />
                    </label>
                    {editingSource?.hasLocalToken && (
                      <label className="asset-card-meta">
                        <input
                          type="checkbox"
                          checked={formClearToken}
                          onChange={(e) => {
                            setFormClearToken(e.target.checked);
                            if (e.target.checked) setFormToken("");
                            setTestResult(undefined);
                          }}
                        />
                        <span>清除已保存的本机访问令牌</span>
                      </label>
                    )}
                  </>
                )}

                {formTier === "enterprise" && (
                  <div className="form-field">
                    <span className="form-label-row">
                      <span>企业必选规则包（在项目规则页锁定）</span>
                      <span className="badge badge--enterprise">已选 {formRequired.length}</span>
                    </span>
                    <div className="rulepack-grid">
                      {RULEPACK_CATALOG.filter((pack) => pack.group !== "meta").map((pack) => {
                        const checked = formRequired.includes(pack.id);
                        return (
                          <button
                            type="button"
                            key={pack.id}
                            className={`rulepack-item${checked ? " selected" : ""}`}
                            onClick={() => toggleRequiredPack(pack.id)}
                          >
                            <span className="check-box" aria-hidden="true">
                              {checked && <Check size={11} weight="bold" />}
                            </span>
                            <span className="rulepack-item-body">
                              <span className="rulepack-item-name">{pack.name}</span>
                              <span className="rulepack-item-id">{pack.id}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {testResult && (
                  <div className="feedback-notice" role="status">
                    <CheckCircle size={16} />
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !formLocation.trim()}
                onClick={() => void handleTestForm()}
              >
                测试连接
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={closeSourceModal}>
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !formId.trim() || !formName.trim() || !formLocation.trim()}
                onClick={() => void handleSubmitSource()}
              >
                {editingSource ? "保存修改" : "确认添加"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
