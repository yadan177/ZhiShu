import { useEffect, useState } from "react";
import { ArrowClockwise, Check, CheckCircle, FolderOpen, Plus, ShieldCheck, Trash, WarningCircle, X } from "@phosphor-icons/react";
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
  type McpPreview,
  type McpServerDefinition,
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
  const [aCore = "", aPre] = a.split("-", 2);
  const [bCore = "", bPre] = b.split("-", 2);
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
}: {
  api?: DesktopApi;
  onOpenAssets: () => void;
}) {
  const [tools, setTools] = useState<ToolInspection[]>([]);
  const [selectedTool, setSelectedTool] = useState<AssetIde | "all">("all");
  const [sources, setSources] = useState<PluginSource[]>([]);
  const [installedAssets, setInstalledAssets] = useState<InstalledAssetRecord[]>([]);
  const [legacyItems, setLegacyItems] = useState<LegacyAssetCandidate[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpServerDefinition[]>([]);
  const [installedMcps, setInstalledMcps] = useState<InstalledMcpRecord[]>([]);
  const [updateKeys, setUpdateKeys] = useState<Record<string, string>>({});

  const [showLegacyModal, setShowLegacyModal] = useState(false);
  const [assetPlan, setAssetPlan] = useState<UserAssetPlan>();
  const [mcpPreview, setMcpPreview] = useState<McpPreview>();
  const [editingMcp, setEditingMcp] = useState<{ record: InstalledMcpRecord; def: McpServerDefinition }>();
  const [editEnv, setEditEnv] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshAll(currentApi: DesktopApi): Promise<void> {
    const [toolList, imports, assets, catalog, mcps, legacy] = await Promise.all([
      currentApi.inspectTools(),
      currentApi.listPluginImports(),
      currentApi.listUserAssets(),
      currentApi.listMcpCatalog(),
      currentApi.listInstalledMcps(),
      currentApi.inspectLegacyAssets ? currentApi.inspectLegacyAssets() : Promise.resolve([]),
    ]);
    setTools(toolList);
    setSources(imports);
    setInstalledAssets(assets);
    setMcpCatalog(catalog);
    setInstalledMcps(mcps);
    setLegacyItems(legacy);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (problem) {
      setError(formatErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const [toolList, imports, assets, catalog, mcps, legacy] = await Promise.all([
          api.inspectTools(),
          api.listPluginImports(),
          api.listUserAssets(),
          api.listMcpCatalog(),
          api.listInstalledMcps(),
          api.inspectLegacyAssets ? api.inspectLegacyAssets() : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setTools(toolList);
        setSources(imports);
        setInstalledAssets(assets);
        setMcpCatalog(catalog);
        setInstalledMcps(mcps);
        setLegacyItems(legacy);
      } catch (problem) {
        if (!cancelled) setError(formatErrorMessage(problem));
      } finally {
        if (!cancelled) setBusy(false);
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

  const enrichedAssets = filteredAssets.map((item) => {
    const sourceName = item.sourceKey.split("@")[0].replace(/^skill\./, "");
    const expectedKind = item.sourceKey.startsWith("skill.") ? "skill" : "capability-plugin";
    const candidates = sources
      .filter((candidate) => candidate.name === sourceName && candidate.kind === expectedKind)
      .sort((a, b) => compareSemver(a.version, b.version));
    const latestCandidate = candidates.at(-1);
    const hasNewerVersion = latestCandidate ? compareSemver(latestCandidate.version, item.version) > 0 : false;
    const hasContentUpdate = Boolean(
      !hasNewerVersion &&
        latestCandidate &&
        latestCandidate.version === item.version &&
        item.sourceDigest &&
        /^[a-f0-9]{64}$/.test(item.sourceDigest) &&
        latestCandidate.sourceDigest !== item.sourceDigest,
    );
    const isPreset = candidates.some((c) => c.preset) || (!item.sourceKey.startsWith("skill.") && sourceName.startsWith("zhishu-"));
    return { item, candidates, latestCandidate, hasNewerVersion, hasContentUpdate, isPreset };
  });

  const conflictCount =
    enrichedAssets.filter(({ item }) => item.issues.length > 0).length +
    filteredMcps.filter((record) => record.issues.length > 0).length;
  const updatableCount = enrichedAssets.filter(
    ({ item, hasNewerVersion, hasContentUpdate }) => item.issues.length === 0 && (hasNewerVersion || hasContentUpdate),
  ).length;
  const totalVisibleCount = enrichedAssets.length + filteredMcps.length;
  const normalCount = Math.max(0, totalVisibleCount - conflictCount - updatableCount);

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

      {visibleLegacy.length > 0 && (
        <section className="legacy-takeover-banner" role="status" aria-label="旧版记录接管提示">
          <div className="legacy-takeover-left">
            <span className="badge badge--warning">旧版记录</span>
            <span>发现 {visibleLegacy.length} 项旧版智枢记录或未纳管官方插件</span>
          </div>
          <button
            type="button"
            className="secondary-button btn-compact"
            disabled={busy || !api}
            onClick={() => setShowLegacyModal(true)}
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
              const selectedDiffers = Boolean(
                selectedCandidate &&
                  (selectedCandidate.version !== item.version ||
                    (item.sourceDigest &&
                      /^[a-f0-9]{64}$/.test(item.sourceDigest) &&
                      selectedCandidate.sourceDigest !== item.sourceDigest)),
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
                        <button type="button" className="secondary-button btn-compact" disabled>
                          卸载
                        </button>
                      </>
                    ) : isMultiVersion ? (
                      <>
                        {hasNewerVersion && latestCandidate ? (
                          <span className="badge badge--brand">可更新至 v{latestCandidate.version}</span>
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
                                setAssetPlan(
                                  await api.previewUserAsset("update", selectedVersionKey, item.target.ideId, item.id),
                                );
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
                                setAssetPlan(await api.previewUserAsset("uninstall", "", item.target.ideId, item.id));
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
                                setAssetPlan(
                                  await api.previewUserAsset("update", latestCandidate.key, item.target.ideId, item.id),
                                );
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
                                setAssetPlan(await api.previewUserAsset("uninstall", "", item.target.ideId, item.id));
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
                                setAssetPlan(await api.previewUserAsset("uninstall", "", item.target.ideId, item.id));
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
                    <span className={`badge ${hasConflict ? "badge--danger" : "badge--success"}`}>
                      {hasConflict ? "冲突·需处理" : "正常"}
                    </span>
                    {def && def.envSchema.length > 0 && !hasConflict && (
                      <button
                        type="button"
                        className="secondary-button btn-compact"
                        disabled={busy || !api}
                        onClick={() => {
                          setEditingMcp({ record, def });
                          setEditEnv(Object.fromEntries(def.envSchema.map((f) => [f.key, ""])));
                          setRevealedKeys({});
                        }}
                      >
                        环境变量
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button btn-compact"
                      disabled={busy || !api || hasConflict}
                      onClick={() => {
                        if (api) {
                          void run(async () => {
                            setMcpPreview(await api.previewMcp("uninstall", record.id, record.toolId));
                          });
                        }
                      }}
                    >
                      卸载
                    </button>
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
      {showLegacyModal && visibleLegacy.length > 0 && (
        <div className="modal-backdrop">
          <section className="modal legacy-modal" role="dialog" aria-modal="true" aria-label="接管旧版记录">
            <header className="modal-header">
              <div className="tools-list-header-left">
                <h2>接管旧版记录</h2>
                <span className="badge badge--warning">{visibleLegacy.length} 项待接管</span>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                disabled={busy}
                onClick={() => setShowLegacyModal(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="target-config-strip">
                <span className="badge badge--success">只读安全</span>
                <span>仅补写智枢本地回执，不修改目标工具目录中的已有文件</span>
              </div>
              <div className="tool-asset-list" style={{ marginTop: 12 }}>
                {visibleLegacy.map((item) => (
                  <article className="tool-asset-row" key={item.key}>
                    <div className="tool-asset-main">
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
                      <span className={`badge ${item.kind === "legacy-receipt" ? "badge--brand" : "badge--warning"}`}>
                        {item.originLabel}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <footer className="modal-actions modal-actions--spread">
              <span className="modal-footer-hint">接管后可在已安装清单中直接更新或卸载</span>
              <div className="modal-actions-group">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setShowLegacyModal(false)}
                >
                  返回
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !api?.adoptLegacyAssets}
                  onClick={() => {
                    if (api?.adoptLegacyAssets) {
                      const keys = visibleLegacy.map((item) => item.key);
                      void run(async () => {
                        const result = await api.adoptLegacyAssets!(keys);
                        await refreshAll(api);
                        setShowLegacyModal(false);
                        setNotice(`已接管 ${result.adoptedCount} 项旧版记录`);
                      });
                    }
                  }}
                >
                  确认接管 ({visibleLegacy.length})
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {/* MCP 环境变量快捷修改弹窗 */}
      {editingMcp && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="修改 MCP 环境变量">
            <header className="modal-header">
              <h2>
                修改环境变量 · {editingMcp.record.title} ({TOOL_LABELS[editingMcp.record.toolId]})
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setEditingMcp(undefined)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
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
                          onChange={(e) => setEditEnv((cur) => ({ ...cur, [field.key]: e.target.value }))}
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
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingMcp(undefined)}>
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !api}
                onClick={() => {
                  if (api) {
                    void run(async () => {
                      const preview = await api.previewMcp("update", editingMcp.record.id, editingMcp.record.toolId, editEnv);
                      setEditingMcp(undefined);
                      setMcpPreview(preview);
                    });
                  }
                }}
              >
                查看配置变更
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* 资产更新/卸载预览弹窗 */}
      {assetPlan && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="变更预览">
            <header className="modal-header">
              <h2>
                {ACTION_VERBS[assetPlan.action]}预览 · {TOOL_LABELS[assetPlan.ideId as AssetIde] ?? assetPlan.ideId}
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setAssetPlan(undefined)}>
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
                <div className="change-list">
                  {assetPlan.changes.map((file) => (
                    <div className="change-row" key={file.path}>
                      <span className={`change-action ${file.action}`}>
                        {file.action === "add" ? "新增" : file.action === "remove" ? "删除" : "修改"}
                      </span>
                      <span>{file.path}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <footer className="modal-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setAssetPlan(undefined)}>
                返回
              </button>
              <button
                type="button"
                className={assetPlan.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={busy || assetPlan.conflicts.length > 0 || !api}
                onClick={() => {
                  if (api) {
                    void run(async () => {
                      await api.applyUserAsset(assetPlan.token);
                      await refreshAll(api);
                      setAssetPlan(undefined);
                      setNotice(`${ACTION_VERBS[assetPlan.action]}完成`);
                    });
                  }
                }}
              >
                确认{ACTION_VERBS[assetPlan.action]}
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
                MCP {ACTION_VERBS[mcpPreview.action]}确认 · {TOOL_LABELS[mcpPreview.toolId]}
              </h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setMcpPreview(undefined)}>
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
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setMcpPreview(undefined)}>
                返回
              </button>
              <button
                type="button"
                className={mcpPreview.action === "uninstall" ? "danger-button" : "primary-button"}
                disabled={busy || mcpPreview.conflicts.length > 0 || !api}
                onClick={() => {
                  if (api) {
                    void run(async () => {
                      await api.applyMcp(mcpPreview.token);
                      await refreshAll(api);
                      setMcpPreview(undefined);
                      setNotice(`MCP ${ACTION_VERBS[mcpPreview.action]}完成`);
                    });
                  }
                }}
              >
                确认{ACTION_VERBS[mcpPreview.action]}
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
  onChooseWorkspaceSource,
  onOpenAssets,
}: {
  api?: DesktopApi;
  sources: AssetSourceRecord[];
  workspaceSource?: WorkspaceSourceInfo;
  onSourcesChange: (next: AssetSourceRecord[]) => void;
  onChooseWorkspaceSource: () => void;
  onOpenAssets: () => void;
}) {
  const [imports, setImports] = useState<PluginSource[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formTier, setFormTier] = useState<"enterprise" | "personal">("enterprise");
  const [formAccess, setFormAccess] = useState<"local" | "git">("git");
  const [formLocation, setFormLocation] = useState("");
  const [formBranch, setFormBranch] = useState("main");
  const [formToken, setFormToken] = useState("");
  const [formRequired, setFormRequired] = useState<string[]>(["common"]);
  const [testResult, setTestResult] = useState<SourceTestResult>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    void Promise.all([api.listPluginImports(), api.listSources()])
      .then(([records, sourceList]) => {
        if (cancelled) return;
        setImports(records);
        onSourcesChange(sourceList);
      })
      .catch((problem) => {
        if (!cancelled) setError(formatErrorMessage(problem));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (problem) {
      setError(formatErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  function toggleRequiredPack(packId: string): void {
    setFormRequired((current) =>
      current.includes(packId) ? current.filter((item) => item !== packId) : [...current, packId],
    );
  }

  async function handleExport(key: string): Promise<void> {
    if (!api) return;
    await run(async () => {
      const result = await api.exportTraeWorkSkill(key);
      if (result) setNotice(`已导出：${result.path}`);
    });
  }

  async function handleTestForm(): Promise<void> {
    if (!api) return;
    setTestResult(undefined);
    await run(async () => {
      const result = await api.testSource({
        access: formAccess,
        location: formLocation.trim(),
        branch: formAccess === "git" ? formBranch.trim() || undefined : undefined,
        token: formAccess === "git" ? formToken.trim() || undefined : undefined,
      });
      setTestResult(result);
    });
  }

  async function handleSubmitAdd(): Promise<void> {
    if (!api) return;
    await run(async () => {
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
      setShowAdd(false);
      setFormId("");
      setFormName("");
      setFormLocation("");
      setFormToken("");
      setTestResult(undefined);
      setNotice("来源已添加");
    });
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
            onClick={onChooseWorkspaceSource}
            disabled={busy || !api}
          >
            <FolderOpen size={15} aria-hidden="true" />
            临时本地规则源
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setTestResult(undefined);
              setShowAdd(true);
            }}
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
                      setNotice(`${src.name}：${result.message}`);
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
                      setNotice(result.message);
                    });
                  }
                }}
              >
                <ArrowClockwise size={14} aria-hidden="true" />
                同步
              </button>
              {!src.readonly && (
                <button
                  type="button"
                  className="danger-outline-button"
                  aria-label={`移除 ${src.name}`}
                  disabled={busy || !api}
                  onClick={() => {
                    if (api) {
                      void run(async () => {
                        const next = await api.removeSource(src.id);
                        onSourcesChange(next);
                        setNotice(`已移除来源：${src.name}`);
                      });
                    }
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

      {/* 05-B · 添加来源弹窗 */}
      {showAdd && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="添加来源">
            <header className="modal-header">
              <h2>添加来源</h2>
              <button type="button" className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setShowAdd(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <div className="drawer-section">
                <div className="form-field">
                  <span className="form-label-row"><span>来源级别</span></span>
                  <div className="segmented">
                    <button type="button" className={formTier === "enterprise" ? "active" : ""} onClick={() => setFormTier("enterprise")}>
                      企业源（支持必选规范）
                    </button>
                    <button type="button" className={formTier === "personal" ? "active" : ""} onClick={() => setFormTier("personal")}>
                      个人源
                    </button>
                  </div>
                </div>

                <label className="form-field">
                  <span className="form-label-row">
                    <span>来源标识 ID *</span>
                    <span className="mono-inline">a-z / 0-9 / -</span>
                  </span>
                  <input className="form-input mono" value={formId} onChange={(e) => setFormId(e.target.value)} placeholder="corp-xr-rules" />
                </label>

                <label className="form-field">
                  <span className="form-label-row"><span>来源名称 *</span></span>
                  <input className="form-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="企业 XR 产研规范源" />
                </label>

                <div className="form-field">
                  <span className="form-label-row"><span>接入方式</span></span>
                  <div className="segmented">
                    <button type="button" className={formAccess === "git" ? "active" : ""} onClick={() => setFormAccess("git")}>
                      私有 Git 仓库
                    </button>
                    <button type="button" className={formAccess === "local" ? "active" : ""} onClick={() => setFormAccess("local")}>
                      本地目录
                    </button>
                  </div>
                </div>

                <div className="form-field">
                  <span className="form-label-row">
                    <span>{formAccess === "git" ? "仓库地址（HTTPS / SSH）*" : "本地目录绝对路径 *"}</span>
                  </span>
                  <div className="source-row">
                    <input
                      className="form-input mono"
                      style={{ flex: 1 }}
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      placeholder={formAccess === "git" ? "https://git.corp.example/org/zhishu-rules.git" : "/path/to/rules-repo"}
                    />
                    {formAccess === "local" && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !api}
                        onClick={() => {
                          if (api) {
                            void run(async () => {
                              const picked = await api.chooseSourceDir();
                              if (picked) setFormLocation(picked);
                            });
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
                      <input className="form-input mono" value={formBranch} onChange={(e) => setFormBranch(e.target.value)} placeholder="main" />
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
                        value={formToken}
                        onChange={(e) => setFormToken(e.target.value)}
                        placeholder="留空则使用本机 SSH 或系统 Git 凭据"
                      />
                    </label>
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
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setShowAdd(false)}>
                返回
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !formId.trim() || !formName.trim() || !formLocation.trim()}
                onClick={() => void handleSubmitAdd()}
              >
                确认添加
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
