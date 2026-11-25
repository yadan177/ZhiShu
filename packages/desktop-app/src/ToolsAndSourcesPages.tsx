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

const ACTION_VERBS = { install: "安装", update: "更新", uninstall: "卸载" } as const;

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
  const [mcpCatalog, setMcpCatalog] = useState<McpServerDefinition[]>([]);
  const [installedMcps, setInstalledMcps] = useState<InstalledMcpRecord[]>([]);
  const [updateKeys, setUpdateKeys] = useState<Record<string, string>>({});

  const [assetPlan, setAssetPlan] = useState<UserAssetPlan>();
  const [mcpPreview, setMcpPreview] = useState<McpPreview>();
  const [editingMcp, setEditingMcp] = useState<{ record: InstalledMcpRecord; def: McpServerDefinition }>();
  const [editEnv, setEditEnv] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshAll(currentApi: DesktopApi): Promise<void> {
    const [toolList, imports, assets, catalog, mcps] = await Promise.all([
      currentApi.inspectTools(),
      currentApi.listPluginImports(),
      currentApi.listUserAssets(),
      currentApi.listMcpCatalog(),
      currentApi.listInstalledMcps(),
    ]);
    setTools(toolList);
    setSources(imports);
    setInstalledAssets(assets);
    setMcpCatalog(catalog);
    setInstalledMcps(mcps);
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
        const [toolList, imports, assets, catalog, mcps] = await Promise.all([
          api.inspectTools(),
          api.listPluginImports(),
          api.listUserAssets(),
          api.listMcpCatalog(),
          api.listInstalledMcps(),
        ]);
        if (cancelled) return;
        setTools(toolList);
        setSources(imports);
        setInstalledAssets(assets);
        setMcpCatalog(catalog);
        setInstalledMcps(mcps);
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

  return (
    <div className="workspace-scroll">
      <header className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.tools}</h1>
          {selectedTool !== "all" && (
            <button type="button" className="pill-btn active" onClick={() => setSelectedTool("all")}>
              筛选：{TOOL_LABELS[selectedTool]} ×
            </button>
          )}
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
          const total = tool.counts.plugins + tool.counts.skills + tool.counts.mcps;
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
                      : tool.available
                        ? "badge--success"
                        : "badge--muted"
                  }`}
                >
                  {tool.statusLabel}
                </span>
              </div>
              <span className="tool-card-path" title={tool.paths.join("\n")}>
                {tool.displayPath}
              </span>
              <div className="asset-card-meta">
                <span className="badge badge--muted">已装 {total}</span>
                {tool.counts.plugins > 0 && <span className="badge badge--enterprise">插件 {tool.counts.plugins}</span>}
                {tool.counts.skills > 0 && <span className="badge badge--brand">技能 {tool.counts.skills}</span>}
                {tool.counts.mcps > 0 && <span className="badge badge--mcp">MCP {tool.counts.mcps}</span>}
              </div>
            </button>
          );
        })}
      </section>

      <section className="surface-card">
        <div className="card-header">
          <h2>
            已安装清单{selectedTool !== "all" ? ` · ${TOOL_LABELS[selectedTool]}` : ""}
          </h2>
          <span className="badge badge--muted">{filteredAssets.length + filteredMcps.length}</span>
        </div>

        {filteredAssets.length === 0 && filteredMcps.length === 0 ? (
          <div className="empty-state">
            <span>暂无已安装的插件、技能或 MCP</span>
            <button type="button" className="primary-button" onClick={onOpenAssets}>
              前往{APP_COPY.nav.assets}
            </button>
          </div>
        ) : (
          <>
            {filteredAssets.map((item) => {
              const sourceName = item.sourceKey.split("@")[0].replace(/^skill\./, "");
              const candidates = sources.filter(
                (candidate) =>
                  candidate.name === sourceName &&
                  candidate.kind === (item.sourceKey.startsWith("skill.") ? "skill" : "capability-plugin"),
              );
              const rowKey = `${item.target.ideId}:${item.id}`;
              const selectedVersionKey =
                candidates.find((c) => c.key === updateKeys[rowKey])?.key ?? candidates.at(-1)?.key ?? item.sourceKey;
              return (
                <article className="imported-plugin" key={rowKey}>
                  <div className="imported-plugin-row">
                    <IconTile size="sm">
                      <AssetGlyph kind={glyphForAsset(item.id, item.kind)} size={18} />
                    </IconTile>
                    <span className={`badge ${item.kind === "skill" ? "badge--brand" : "badge--enterprise"}`}>
                      {item.kind === "skill" ? "技能" : "插件"}
                    </span>
                    <strong>
                      {item.title} · v{item.version}
                    </strong>
                    <span className="badge badge--muted">{TOOL_LABELS[item.target.ideId]}</span>
                    <span className={`badge ${item.issues.length ? "badge--danger" : "badge--success"}`}>
                      {item.issues.length ? "冲突·需处理" : item.recognition === "host-verified" ? "已识别" : "正常"}
                    </span>
                    {item.recognitionNote && <span className="badge badge--warning">已停用</span>}
                  </div>
                  <span className="asset-destination">{item.destination}</span>
                  {item.issues.map((issue) => (
                    <p className="inline-issue" key={issue}>
                      {issue}
                    </p>
                  ))}
                  <div className="asset-actions">
                    {candidates.length > 0 && (
                      <div className="dropdown-field">
                        <span>版本</span>
                        <Dropdown
                          label={`版本：${item.title}`}
                          value={selectedVersionKey}
                          disabled={busy}
                          onChange={(value) => setUpdateKeys((cur) => ({ ...cur, [rowKey]: value }))}
                          options={candidates.map((c) => ({ value: c.key, label: `v${c.version}` }))}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !api || !candidates.length || !!item.issues.length}
                      onClick={() => {
                        if (api) {
                          void run(async () => {
                            setAssetPlan(await api.previewUserAsset("update", selectedVersionKey, item.target.ideId, item.id));
                          });
                        }
                      }}
                    >
                      更新
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !api || !!item.issues.length}
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
                  </div>
                </article>
              );
            })}

            {filteredMcps.map((record) => {
              const def = mcpCatalog.find((item) => item.id === record.id);
              return (
                <article className="imported-plugin" key={`mcp:${record.toolId}:${record.id}`}>
                  <div className="imported-plugin-row">
                    <IconTile size="sm">
                      <AssetGlyph kind={record.id === "feishu-mcp" ? "feishu" : "local_plugin"} size={18} />
                    </IconTile>
                    <span className="badge badge--mcp">MCP</span>
                    <strong>
                      {record.title} · v{record.version}
                    </strong>
                    <span className="badge badge--muted">{TOOL_LABELS[record.toolId]}</span>
                    <span className={`badge ${record.issues.length ? "badge--danger" : "badge--success"}`}>
                      {record.issues.length ? "冲突·需处理" : "正常"}
                    </span>
                    {record.secretKeys.length > 0 && (
                      <span className="badge badge--muted">{record.secretKeys.length} 项脱敏密钥</span>
                    )}
                  </div>
                  <span className="asset-destination">{record.targetPath}</span>
                  {record.issues.map((issue) => (
                    <p className="inline-issue" key={issue}>
                      {issue}
                    </p>
                  ))}
                  <div className="asset-actions">
                    {def && def.envSchema.length > 0 && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy || !api || !!record.issues.length}
                        onClick={() => {
                          setEditingMcp({ record, def });
                          setEditEnv(Object.fromEntries(def.envSchema.map((f) => [f.key, ""])));
                          setRevealedKeys({});
                        }}
                      >
                        修改环境变量
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !api || !!record.issues.length}
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
          </>
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
