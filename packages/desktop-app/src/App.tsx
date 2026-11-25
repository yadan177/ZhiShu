import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Cpu, Database, FolderSimple, SquaresFour } from "@phosphor-icons/react";
import { AssetsPage } from "./AssetsPage";
import { ZhiShuMark } from "./BrandIcons";
import { APP_COPY, RULEPACK_BY_ID } from "./copy";
import { PreviewDialog } from "./PreviewDialog";
import { ProjectRulesPage } from "./ProjectRulesPage";
import { ProjectsPage } from "./ProjectsPage";
import { SourcesPage, ToolsPage } from "./ToolsAndSourcesPages";
import {
  formatErrorMessage,
  type ActiveView,
  type AssetSourceRecord,
  type DesktopApi,
  type PlatformChoice,
  type Preview,
  type ProjectStatus,
  type RegisteredProject,
  type RuleMode,
  type SoftwareUpdateState,
  type UpdateCheck,
  type WorkspaceSourceInfo,
} from "./types";

export function App() {
  const [view, setView] = useState<ActiveView>("projects");
  const [mode, setMode] = useState<RuleMode>("install");
  const [status, setStatus] = useState<ProjectStatus>();
  const [projects, setProjects] = useState<RegisteredProject[]>([]);
  const [sources, setSources] = useState<AssetSourceRecord[]>([]);
  const [sourceKind, setSourceKind] = useState<"github" | "workspace">("github");
  const [workspaceSource, setWorkspaceSource] = useState<WorkspaceSourceInfo>();
  const [selectedRulepacks, setSelectedRulepacks] = useState<string[]>(["common"]);
  const [selectedTargets, setSelectedTargets] = useState<PlatformChoice[]>(["codex"]);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [softwareState, setSoftwareState] = useState<SoftwareUpdateState>();
  const [softwareBusy, setSoftwareBusy] = useState(false);
  const [softwareError, setSoftwareError] = useState("");
  const unavailable = !window.zhishu;

  const enterpriseRequiredPacks = useMemo(() => {
    const required = new Set<string>();
    for (const src of sources) {
      if (src.tier !== "enterprise") continue;
      for (const packId of src.requiredRulepacks) required.add(packId);
    }
    return required;
  }, [sources]);

  useEffect(() => {
    const desktop = window.zhishu;
    if (!desktop) return;
    let cancelled = false;
    const unsubscribe = desktop.onSoftwareUpdate((nextState) => {
      if (!cancelled) setSoftwareState(nextState);
    });
    void desktop
      .getSoftwareUpdate()
      .then((nextState) => {
        if (!cancelled) setSoftwareState(nextState);
      })
      .catch(() => {
        // 启动阶段版本检测失败不阻塞本地项目与规则管理，状态推送会按需刷新。
      });
    void desktop
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((problem) => {
        if (!cancelled) setError(formatErrorMessage(problem));
      });
    void desktop
      .listSources()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        // 来源列表读取失败不阻塞基础项目管理。
      });
    void desktop
      .getDefaultWorkspaceSource()
      .then((detected) => {
        if (!cancelled && detected) setWorkspaceSource(detected);
      })
      .catch(() => {
        // 未检测到默认开发规则仓库时保持官方源默认，用户仍可手动选择本地规则源。
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function api(): DesktopApi {
    if (!window.zhishu) throw new Error("请在桌面应用中使用智枢");
    return window.zhishu;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (problem) {
      setError(formatErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  function clearPreview(): void {
    setPreview(undefined);
    if (window.zhishu) {
      void window.zhishu.clearPreview().catch((problem) => setError(formatErrorMessage(problem)));
    }
  }

  function filterPacksForSource(packs: readonly string[], nextSource: "github" | "workspace", ws?: WorkspaceSourceInfo): string[] {
    const merged = [...new Set([...packs, ...enterpriseRequiredPacks])];
    if (nextSource === "workspace") {
      const allowed = ws ? new Set(ws.packs.map((pack) => pack.id)) : undefined;
      const kept = allowed ? merged.filter((id) => allowed.has(id)) : merged;
      return kept.length ? kept : ["common"];
    }
    const kept = merged.filter((id) => RULEPACK_BY_ID[id]?.releasedInOfficial015);
    return kept.length ? kept : ["common"];
  }

  function showProject(selected: ProjectStatus, openRules = true): void {
    setStatus(selected);
    setMode(selected.installed ? "update" : "install");
    setSelectedTargets(selected.installed ? selected.targets : ["codex"]);
    setSelectedRulepacks(
      selected.installed
        ? selected.rulepacks
        : filterPacksForSource(selected.recommendedRulepacks, sourceKind, workspaceSource),
    );
    setUpdateCheck(undefined);
    setPreview(undefined);
    setNotice("");
    if (openRules) setView("rules");
  }

  function chooseProject(openRules = false): void {
    void run(async () => {
      const selected = await api().chooseProject();
      if (selected) {
        showProject(selected, openRules);
        setProjects(await api().listProjects());
      }
    });
  }

  function selectProject(root: string): void {
    void run(async () => {
      showProject(await api().selectProject(root), true);
    });
  }

  function forgetProject(root: string): void {
    void run(async () => {
      await api().forgetProject(root);
      if (status?.root === root) {
        setStatus(undefined);
        setPreview(undefined);
        setUpdateCheck(undefined);
      }
      setProjects(await api().listProjects());
      setNotice("已移出列表");
    });
  }

  function recoverProject(root?: string): void {
    void run(async () => {
      const result = await api().recoverProject(root);
      setStatus(result.status);
      setProjects(await api().listProjects());
      setUpdateCheck(undefined);
      setPreview(undefined);
      setNotice(result.recoveredPath ? `已恢复中断事务，原记录保留在 ${result.recoveredPath}` : "没有未完成事务");
    });
  }

  function chooseWorkspaceSource(): void {
    void run(async () => {
      const selected = await api().chooseWorkspaceSource();
      if (selected) {
        setWorkspaceSource(selected);
        setSourceKind("workspace");
        setSelectedRulepacks((current) => filterPacksForSource(current, "workspace", selected));
        setNotice(`已加载本地规则源（${selected.packs.length} 个规则包）`);
      }
    });
  }

  function handleChangeSourceKind(nextKind: "github" | "workspace"): void {
    setSourceKind(nextKind);
    setSelectedRulepacks((current) => filterPacksForSource(current, nextKind, workspaceSource));
    setNotice("");
  }

  function selectRegisteredSource(src: AssetSourceRecord): void {
    if (src.access === "github-release") {
      handleChangeSourceKind("github");
      return;
    }
    const targetDir = src.access === "local" ? src.location : src.localCheckoutPath;
    if (!targetDir) {
      setError("请先在「来源管理」同步该 Git 来源");
      return;
    }
    void run(async () => {
      const info = await api().inspectWorkspaceSource(targetDir);
      setWorkspaceSource(info);
      setSourceKind("workspace");
      setSelectedRulepacks((current) => filterPacksForSource(current, "workspace", info));
      setNotice(`已切换至 ${src.name}（${info.packs.length} 个规则包）`);
    });
  }

  function toggleRulepack(packId: string): void {
    if (enterpriseRequiredPacks.has(packId)) return;
    setSelectedRulepacks((current) =>
      current.includes(packId) ? current.filter((item) => item !== packId) : [...current, packId],
    );
    setUpdateCheck(undefined);
    setNotice("");
  }

  function applyRecommendation(): void {
    if (!status) return;
    setSelectedRulepacks(filterPacksForSource(status.recommendedRulepacks, sourceKind, workspaceSource));
    setNotice("已套用检测推荐规则包");
  }

  function toggleTarget(target: PlatformChoice): void {
    setSelectedTargets((current) =>
      current.includes(target) ? current.filter((item) => item !== target) : [...current, target],
    );
    setUpdateCheck(undefined);
    setNotice("");
  }

  function checkForUpdate(): void {
    void run(async () => {
      if (!status) throw new Error("请先选择项目文件夹");
      const result = await api().checkUpdate(selectedTargets, selectedRulepacks);
      setUpdateCheck(result);
      setNotice(
        result.rulepacksChanged
          ? "规则包配置已变更，可查看变更"
          : result.targetsChanged
            ? "适用工具已变更，可查看变更"
            : result.available
              ? `发现可更新版本 ${result.latestVersion}`
              : "已是最新版本",
      );
    });
  }

  function openPreview(): void {
    void run(async () => {
      if (!status) throw new Error("请先选择项目文件夹");
      if (mode === "install") {
        const source =
          sourceKind === "workspace"
            ? workspaceSource
              ? { type: "workspace" as const, path: workspaceSource.root }
              : (() => {
                  throw new Error("请先选择本地规则源目录");
                })()
            : { type: "github" as const };
        setPreview(
          await api().previewInstall({
            rulepacks: selectedRulepacks,
            targets: selectedTargets,
            source,
          }),
        );
      } else if (mode === "update") {
        setPreview(await api().previewUpdate());
      } else {
        setPreview(await api().previewUninstall());
      }
    });
  }

  function applyPreview(): void {
    if (!preview) return;
    void run(async () => {
      const result =
        preview.kind === "install"
          ? await api().applyInstall()
          : preview.kind === "update"
            ? await api().applyUpdate()
            : await api().applyUninstall();
      setStatus(result);
      setSelectedTargets(result.installed ? result.targets : ["codex"]);
      setSelectedRulepacks(
        result.installed
          ? result.rulepacks
          : filterPacksForSource(result.recommendedRulepacks, sourceKind, workspaceSource),
      );
      setPreview(undefined);
      setUpdateCheck(undefined);
      setProjects(await api().listProjects());
      setNotice(preview.kind === "install" ? "安装完成" : preview.kind === "update" ? "更新完成" : "卸载完成");
      if (!result.valid && result.installed) {
        setError(result.issues.map((item) => item.message).join("；"));
      }
    });
  }

  function softwareAction(): void {
    const desktop = window.zhishu;
    if (!desktop || softwareBusy) return;
    setSoftwareBusy(true);
    setSoftwareError("");
    void (async () => {
      try {
        if (softwareState?.phase === "manual") return await desktop.openSoftwareDownload();
        if (softwareState?.phase === "ready") return await desktop.installSoftwareUpdate();
        let state = softwareState;
        if (!state || state.phase === "idle" || state.phase === "current" || state.phase === "error") {
          state = await desktop.checkSoftwareUpdate();
        }
        if (state.phase === "manual") return await desktop.openSoftwareDownload();
        if (state.phase === "error") {
          setSoftwareError(state.message ?? "检查软件版本失败");
          return;
        }
        if (state.phase !== "available") return;
        state = await desktop.downloadSoftwareUpdate();
        if (state.phase === "ready") await desktop.installSoftwareUpdate();
        else if (state.phase === "error") setSoftwareError(state.message ?? "下载软件更新失败");
      } catch (problem) {
        setSoftwareError(formatErrorMessage(problem));
      } finally {
        setSoftwareBusy(false);
      }
    })();
  }

  const hasSoftwareUpdate =
    softwareState?.phase === "available" ||
    softwareState?.phase === "manual" ||
    softwareState?.phase === "downloading" ||
    softwareState?.phase === "ready" ||
    (softwareState?.phase === "error" && !!softwareState.availableVersion);
  const softwareLabel =
    softwareState?.phase === "ready"
      ? APP_COPY.actions.restartUpdate
      : softwareState?.phase === "downloading"
        ? `下载 ${softwareState.percent ?? 0}%`
        : softwareState?.phase === "error" && softwareState.availableVersion
          ? APP_COPY.actions.retryUpdate
          : hasSoftwareUpdate
            ? APP_COPY.actions.downloadUpdate
            : softwareState?.phase === "checking"
              ? "检查中…"
              : APP_COPY.actions.checkSoftwareUpdate;

  function navigateTo(next: ActiveView): void {
    clearPreview();
    setError("");
    setNotice("");
    setView(next);
  }

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-brand">
          <ZhiShuMark size={32} />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">{APP_COPY.brandName}</span>
            <span className="sidebar-brand-sub">{APP_COPY.brandEn}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-item${view === "projects" || view === "rules" ? " active" : ""}`}
            disabled={busy}
            onClick={() => navigateTo("projects")}
          >
            <FolderSimple size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.projects}</span>
            <span className="sidebar-nav-count">{projects.length}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "assets" ? " active" : ""}`}
            disabled={busy}
            onClick={() => navigateTo("assets")}
          >
            <SquaresFour size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.assets}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "tools" ? " active" : ""}`}
            disabled={busy}
            onClick={() => navigateTo("tools")}
          >
            <Cpu size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.tools}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "sources" ? " active" : ""}`}
            disabled={busy}
            onClick={() => navigateTo("sources")}
          >
            <Database size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.sources}</span>
            {sources.some((src) => src.tier === "enterprise") && (
              <span className="sidebar-nav-count">企业</span>
            )}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="version-card">
            <div className="version-card-row">
              <span className="version-tag">v{softwareState?.currentVersion ?? "2.0.0"}</span>
              {hasSoftwareUpdate && softwareState?.availableVersion && (
                <span className="badge badge--brand">v{softwareState.availableVersion}</span>
              )}
              {!hasSoftwareUpdate && softwareState?.phase === "current" && (
                <span className="badge badge--success">最新</span>
              )}
            </div>
            {!unavailable && (
              <button
                type="button"
                className={`version-action${hasSoftwareUpdate ? " has-update" : ""}`}
                onClick={softwareAction}
                disabled={softwareBusy || softwareState?.phase === "downloading" || softwareState?.phase === "checking"}
                title={softwareError || softwareState?.message || undefined}
              >
                <ArrowClockwise size={13} aria-hidden="true" />
                {softwareLabel}
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        {view === "projects" && (
          <ProjectsPage
            projects={projects}
            currentRoot={status?.root}
            busy={busy}
            unavailable={unavailable}
            error={error}
            notice={notice}
            onAddProject={() => chooseProject(false)}
            onSelectProject={selectProject}
            onRecoverProject={(root) => recoverProject(root)}
            onForgetProject={forgetProject}
          />
        )}

        {view === "rules" && (
          <ProjectRulesPage
            projects={projects}
            sources={sources}
            enterpriseRequiredPacks={enterpriseRequiredPacks}
            status={status}
            mode={mode}
            sourceKind={sourceKind}
            workspaceSource={workspaceSource}
            selectedRulepacks={selectedRulepacks}
            selectedTargets={selectedTargets}
            updateCheck={updateCheck}
            busy={busy}
            unavailable={unavailable}
            error={error}
            notice={notice}
            onBackToProjects={() => navigateTo("projects")}
            onSelectProject={selectProject}
            onChangeMode={(nextMode) => {
              setMode(nextMode);
              clearPreview();
              setError("");
              setNotice("");
            }}
            onChangeSourceKind={handleChangeSourceKind}
            onSelectRegisteredSource={selectRegisteredSource}
            onChooseWorkspaceSource={chooseWorkspaceSource}
            onToggleRulepack={toggleRulepack}
            onApplyRecommendation={applyRecommendation}
            onToggleTarget={toggleTarget}
            onRecover={() => recoverProject(status?.root)}
            onCheckUpdate={checkForUpdate}
            onOpenPreview={openPreview}
          />
        )}

        {view === "assets" && <AssetsPage api={window.zhishu} />}

        {view === "tools" && (
          <ToolsPage api={window.zhishu} onOpenAssets={() => navigateTo("assets")} />
        )}

        {view === "sources" && (
          <SourcesPage
            api={window.zhishu}
            sources={sources}
            workspaceSource={workspaceSource}
            onSourcesChange={setSources}
            onChooseWorkspaceSource={chooseWorkspaceSource}
            onOpenAssets={() => navigateTo("assets")}
          />
        )}
      </main>

      {preview && (
        <PreviewDialog
          key={`${preview.kind}:${preview.root}`}
          preview={preview}
          busy={busy}
          onClose={() => {
            if (!busy) clearPreview();
          }}
          onApply={applyPreview}
        />
      )}

      {softwareError && (
        <div className="software-toast" role="alert">
          {softwareError}
        </div>
      )}
    </div>
  );
}
