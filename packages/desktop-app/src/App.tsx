import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, Cpu, Database, FolderSimple, GitDiff, SquaresFour, X } from "@phosphor-icons/react";
import { AssetsPage } from "./AssetsPage";
import { ZhiShuMark } from "./BrandIcons";
import { APP_COPY, RULEPACK_BY_ID } from "./copy";
import { EvolutionPage } from "./EvolutionPage";
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
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [subPageBusy, setSubPageBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [softwareState, setSoftwareState] = useState<SoftwareUpdateState>();
  const [softwareBusy, setSoftwareBusy] = useState(false);
  const [softwareToast, setSoftwareToast] = useState<{ tone: "error" | "info"; text: string }>();
  const [evolutionBadgeCount, setEvolutionBadgeCount] = useState(0);
  const unavailable = !window.zhishu;

  const inFlightRef = useRef(false);
  const userTouchedProjectsRef = useRef(false);
  const userTouchedWorkspaceRef = useRef(false);
  const previewRef = useRef<Preview | undefined>(undefined);
  previewRef.current = preview;

  const enterpriseRequiredPacks = useMemo(() => {
    const required = new Set<string>();
    for (const src of sources) {
      if (src.tier !== "enterprise") continue;
      for (const packId of src.requiredRulepacks) required.add(packId);
    }
    return required;
  }, [sources]);

  // 单一真值源：页面展示、底部计数、检查更新与安装/修复提交均使用同一合并集合。
  const effectiveSelectedRulepacks = useMemo(() => {
    const effectiveSourceType = mode === "install" ? sourceKind : status?.sourceType ?? "github";
    const allowedWorkspace =
      mode === "install" && effectiveSourceType === "workspace" && workspaceSource
        ? new Set(workspaceSource.packs.map((pack) => pack.id))
        : undefined;
    const extraRequired: string[] = [];
    for (const packId of enterpriseRequiredPacks) {
      if (effectiveSourceType === "workspace") {
        if (!allowedWorkspace || allowedWorkspace.has(packId)) extraRequired.push(packId);
      } else if (RULEPACK_BY_ID[packId]) {
        extraRequired.push(packId);
      }
    }
    return [...new Set([...selectedRulepacks, ...extraRequired])];
  }, [selectedRulepacks, enterpriseRequiredPacks, mode, sourceKind, status?.sourceType, workspaceSource]);

  useEffect(() => {
    const desktop = window.zhishu;
    if (!desktop) return;
    let cancelled = false;
    const unsubscribe = desktop.onSoftwareUpdate((nextState) => {
      if (cancelled) return;
      setSoftwareState(nextState);
      if (nextState.phase !== "error") {
        setSoftwareToast((cur) => (cur?.tone === "error" ? undefined : cur));
      }
    });
    const unsubEvo = desktop.onEvolutionUpdated?.(() => {
      if (cancelled) return;
      void desktop
        .listEvolutionProposals()
        .then((listed) => {
          if (!cancelled) setEvolutionBadgeCount(listed.counts.badge);
        })
        .catch(() => {});
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
        if (!cancelled && !userTouchedProjectsRef.current) setProjects(list);
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
        if (!cancelled && detected && !userTouchedWorkspaceRef.current) setWorkspaceSource(detected);
      })
      .catch(() => {
        // 未检测到默认开发规则仓库时保持官方源默认，用户仍可手动选择本地规则源。
      });
    void desktop
      .listEvolutionProposals()
      .then((listed) => {
        if (!cancelled) setEvolutionBadgeCount(listed.counts.badge);
      })
      .catch(() => {
        // 收件箱初始化异常不阻塞项目管理主流程，切入规则进化页会完整报错。
      });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubEvo?.();
    };
  }, []);

  useEffect(() => {
    if (!softwareToast) return;
    const timer = window.setTimeout(() => setSoftwareToast(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [softwareToast]);

  const handleSubPageBusyChange = useCallback((next: boolean) => {
    setSubPageBusy(next);
  }, []);

  function api(): DesktopApi {
    if (!window.zhishu) throw new Error("请在桌面应用中使用智枢");
    return window.zhishu;
  }

  async function run(action: () => Promise<void>, options: { previewModal?: boolean } = {}): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    if (options.previewModal) {
      setPreviewError("");
    } else {
      setError("");
      setNotice("");
    }
    try {
      await action();
    } catch (problem) {
      const msg = formatErrorMessage(problem);
      if (options.previewModal) setPreviewError(msg);
      else setError(msg);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  function clearPreview(): void {
    const hadPreview = Boolean(previewRef.current);
    setPreview(undefined);
    setPreviewError("");
    if (hadPreview && window.zhishu) {
      void window.zhishu.clearPreview().catch((problem) => setError(formatErrorMessage(problem)));
    }
  }

  function filterPacksForSource(packs: readonly string[], nextSource: "github" | "workspace", ws?: WorkspaceSourceInfo): string[] {
    const merged = [...new Set([...packs, ...enterpriseRequiredPacks])];
    if (nextSource === "workspace") {
      const allowed = ws ? new Set(ws.packs.map((pack) => pack.id)) : undefined;
      const kept = allowed ? merged.filter((id) => allowed.has(id)) : merged;
      if (kept.length > 0) return kept;
      if (ws?.packs[0]?.id) return [ws.packs[0].id];
      return ["common"];
    }
    const kept = merged.filter((id) => Boolean(RULEPACK_BY_ID[id]));
    return kept.length ? kept : ["common"];
  }

  function syncProjectViewState(selected: ProjectStatus): void {
    setStatus(selected);
    setMode(selected.installed ? "update" : "install");
    setSelectedTargets(selected.installed && selected.targets.length > 0 ? selected.targets : ["codex"]);
    setSelectedRulepacks(
      selected.installed && selected.rulepacks.length > 0
        ? selected.rulepacks
        : filterPacksForSource(selected.recommendedRulepacks, sourceKind, workspaceSource),
    );
    setUpdateCheck(undefined);
    setPreview(undefined);
    setPreviewError("");
  }

  function showProject(selected: ProjectStatus, openRules = true): void {
    syncProjectViewState(selected);
    setNotice("");
    if (openRules) setView("rules");
  }

  function refreshProjects(): void {
    void run(async () => {
      userTouchedProjectsRef.current = true;
      const list = await api().listProjects();
      setProjects(list);
      if (status) {
        const refreshed = list.find((item) => item.root === status.root);
        if (refreshed?.status) setStatus(refreshed.status);
      }
      setNotice("项目状态已刷新");
    });
  }

  function refreshCurrentProject(): void {
    if (!status) return;
    void run(async () => {
      userTouchedProjectsRef.current = true;
      const latest = await api().selectProject(status.root);
      syncProjectViewState(latest);
      setProjects(await api().listProjects());
      setNotice("已重新检测项目状态");
    });
  }

  function chooseProject(openRules = false): void {
    void run(async () => {
      const selected = await api().chooseProject();
      if (selected) {
        userTouchedProjectsRef.current = true;
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
      userTouchedProjectsRef.current = true;
      await api().forgetProject(root);
      if (status?.root === root) {
        setStatus(undefined);
        setPreview(undefined);
        setPreviewError("");
        setUpdateCheck(undefined);
      }
      setProjects(await api().listProjects());
      setNotice("已移出列表");
    });
  }

  function recoverProject(root?: string): void {
    void run(async () => {
      userTouchedProjectsRef.current = true;
      const result = await api().recoverProject(root);
      syncProjectViewState(result.status);
      setProjects(await api().listProjects());
      setNotice(result.recoveredPath ? `已恢复中断事务，原记录保留在 ${result.recoveredPath}` : "没有未完成事务");
    });
  }

  function chooseWorkspaceSource(): void {
    void run(async () => {
      const selected = await api().chooseWorkspaceSource();
      if (selected) {
        userTouchedWorkspaceRef.current = true;
        setWorkspaceSource(selected);
        setSourceKind("workspace");
        setSelectedRulepacks((current) => filterPacksForSource(current, "workspace", selected));
        setNotice(`已加载本地规则源（${selected.packs.length} 个规则包）`);
      }
    });
  }

  function handleSourcesChange(nextSources: AssetSourceRecord[]): void {
    setSources((prevSources) => {
      if (workspaceSource) {
        const wasTracked = prevSources.some(
          (src) => src.location === workspaceSource.root || src.localCheckoutPath === workspaceSource.root,
        );
        const stillTracked = nextSources.some(
          (src) => src.location === workspaceSource.root || src.localCheckoutPath === workspaceSource.root,
        );
        if (wasTracked && !stillTracked) {
          setWorkspaceSource(undefined);
          setSourceKind("github");
        }
      }
      return nextSources;
    });
  }

  function handleChangeSourceKind(nextKind: "github" | "workspace"): void {
    setSourceKind(nextKind);
    setSelectedRulepacks((current) => filterPacksForSource(current, nextKind, workspaceSource));
    setError("");
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
      userTouchedWorkspaceRef.current = true;
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
    setError("");
    setNotice("");
  }

  function applyRecommendation(): void {
    if (!status) return;
    setSelectedRulepacks(filterPacksForSource(status.recommendedRulepacks, sourceKind, workspaceSource));
    setError("");
    setNotice("已套用检测推荐规则包");
  }

  function toggleTarget(target: PlatformChoice): void {
    setSelectedTargets((current) =>
      current.includes(target) ? current.filter((item) => item !== target) : [...current, target],
    );
    setUpdateCheck(undefined);
    setError("");
    setNotice("");
  }

  function checkForUpdate(): void {
    void run(async () => {
      if (!status) throw new Error("请先选择项目文件夹");
      const result = await api().checkUpdate(selectedTargets, effectiveSelectedRulepacks);
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
      setPreviewError("");
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
            rulepacks: effectiveSelectedRulepacks,
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

  function openRepairPreview(): void {
    const previewRepair = window.zhishu?.previewRepair;
    if (!previewRepair || !status) return;
    void run(async () => {
      setPreviewError("");
      const useCustomRequest = status.issues.some((i) => i.code === "invalid-config");
      const request = useCustomRequest
        ? {
            rulepacks: effectiveSelectedRulepacks.length > 0 ? effectiveSelectedRulepacks : ["common"],
            targets: selectedTargets.length > 0 ? selectedTargets : (["codex"] as PlatformChoice[]),
            source:
              sourceKind === "workspace" && workspaceSource
                ? { type: "workspace" as const, path: workspaceSource.root }
                : { type: "github" as const },
          }
        : undefined;
      setPreview(await previewRepair(request));
    });
  }

  function openForceUninstallPreview(): void {
    const previewForceUninstall = window.zhishu?.previewForceUninstall;
    if (!previewForceUninstall || !status) return;
    void run(async () => {
      setPreviewError("");
      setPreview(await previewForceUninstall());
    });
  }

  function applyPreview(): void {
    if (!preview) return;
    const currentKind = preview.kind;
    void run(
      async () => {
        userTouchedProjectsRef.current = true;
        let result: ProjectStatus;
        try {
          if (currentKind === "install") result = await api().applyInstall();
          else if (currentKind === "update") result = await api().applyUpdate();
          else if (currentKind === "repair" && api().applyRepair) result = await api().applyRepair!();
          else if (currentKind === "force-uninstall" && api().applyForceUninstall) {
            result = await api().applyForceUninstall!();
          } else {
            result = await api().applyUninstall();
          }
        } catch (applyErr) {
          if (currentKind === "update") setUpdateCheck(undefined);
          throw applyErr;
        }
        syncProjectViewState(result);
        setProjects(await api().listProjects());
        const verb =
          currentKind === "install"
            ? "安装完成"
            : currentKind === "update"
              ? "更新完成"
              : currentKind === "repair"
                ? "覆盖修复完成"
                : currentKind === "force-uninstall"
                  ? "强制卸载完成"
                  : "卸载完成";
        setNotice(verb);
        if (!result.valid && result.installed) {
          setError(result.issues.map((item) => item.message).join("；"));
        }
      },
      { previewModal: true },
    );
  }

  function softwareAction(): void {
    const desktop = window.zhishu;
    if (!desktop || softwareBusy) return;
    setSoftwareBusy(true);
    setSoftwareToast(undefined);
    void (async () => {
      try {
        if (softwareState?.phase === "manual") return await desktop.openSoftwareDownload();
        if (softwareState?.phase === "ready") {
          const next = await desktop.installSoftwareUpdate();
          if (next?.phase === "error") {
            setSoftwareToast({ tone: "error", text: next.message ?? "启动安装失败" });
          } else if (next?.phase === "ready" && next.installMode === "open-installer" && next.message) {
            setSoftwareToast({ tone: "info", text: next.message });
          }
          return;
        }
        if (
          softwareState?.phase === "available" ||
          (softwareState?.phase === "error" && softwareState.availableVersion && softwareState.installMode)
        ) {
          const next = await desktop.downloadSoftwareUpdate();
          if (next.phase === "error") {
            setSoftwareToast({ tone: "error", text: next.message ?? "下载软件更新失败" });
          }
          return;
        }
        const checked = await desktop.checkSoftwareUpdate();
        if (checked.phase === "error") {
          setSoftwareToast({ tone: "error", text: checked.message ?? "检查软件版本失败" });
        }
      } catch (problem) {
        setSoftwareToast({ tone: "error", text: formatErrorMessage(problem) });
      } finally {
        setSoftwareBusy(false);
      }
    })();
  }

  function cancelSoftwareDownload(): void {
    const desktop = window.zhishu;
    if (!desktop?.cancelSoftwareDownload) return;
    void desktop.cancelSoftwareDownload();
  }

  function openBrowserSoftwareDownload(): void {
    const desktop = window.zhishu;
    if (!desktop) return;
    void desktop.openSoftwareDownload().catch((problem) => {
      setSoftwareToast({ tone: "error", text: formatErrorMessage(problem) });
    });
  }

  const navLocked = busy || subPageBusy;
  const isSoftwareDownloading = softwareState?.phase === "downloading" || softwareState?.phase === "verifying";
  const hasSoftwareUpdate =
    softwareState?.phase === "available" ||
    softwareState?.phase === "manual" ||
    softwareState?.phase === "downloading" ||
    softwareState?.phase === "verifying" ||
    softwareState?.phase === "ready" ||
    softwareState?.phase === "installing" ||
    (softwareState?.phase === "error" && !!softwareState.availableVersion && !!softwareState.installMode);
  const softwareLabel =
    softwareState?.phase === "installing"
      ? "安装中…"
      : softwareState?.phase === "verifying"
        ? "校验中…"
        : softwareState?.phase === "downloading"
          ? `下载中 ${softwareState.percent ?? 0}%`
          : softwareState?.phase === "ready"
            ? softwareState.installMode === "open-installer"
              ? APP_COPY.actions.installUpdate
              : APP_COPY.actions.restartUpdate
            : softwareState?.phase === "error" && softwareState.availableVersion && softwareState.installMode
              ? APP_COPY.actions.retryUpdate
              : hasSoftwareUpdate
                ? APP_COPY.actions.downloadUpdate
                : softwareState?.phase === "checking"
                  ? "检查中…"
                  : APP_COPY.actions.checkSoftwareUpdate;

  function navigateTo(next: ActiveView): void {
    if (navLocked) return;
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
            disabled={navLocked}
            onClick={() => navigateTo("projects")}
          >
            <FolderSimple size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.projects}</span>
            <span className="sidebar-nav-count">{projects.length}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "assets" ? " active" : ""}`}
            disabled={navLocked}
            onClick={() => navigateTo("assets")}
          >
            <SquaresFour size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.assets}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "tools" ? " active" : ""}`}
            disabled={navLocked}
            onClick={() => navigateTo("tools")}
          >
            <Cpu size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.tools}</span>
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "sources" ? " active" : ""}`}
            disabled={navLocked}
            onClick={() => navigateTo("sources")}
          >
            <Database size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.sources}</span>
            {sources.some((src) => src.tier === "enterprise") && (
              <span className="sidebar-nav-count">企业</span>
            )}
          </button>

          <button
            type="button"
            className={`sidebar-nav-item${view === "evolution" ? " active" : ""}`}
            disabled={navLocked}
            onClick={() => navigateTo("evolution")}
          >
            <GitDiff size={17} aria-hidden="true" />
            <span className="sidebar-nav-label">{APP_COPY.nav.evolution}</span>
            {evolutionBadgeCount > 0 && (
              <span className="sidebar-nav-count">{evolutionBadgeCount}</span>
            )}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="version-card">
            <div className="version-card-row">
              <span className="version-tag">
                {softwareState?.currentVersion ? `v${softwareState.currentVersion}` : "v—"}
              </span>
              {softwareState?.phase === "ready" && (
                <span className="badge badge--success">已就绪</span>
              )}
              {softwareState?.phase !== "ready" && hasSoftwareUpdate && softwareState?.availableVersion && (
                <span className="badge badge--brand">v{softwareState.availableVersion}</span>
              )}
              {!hasSoftwareUpdate && softwareState?.phase === "current" && (
                <span className="badge badge--success">最新</span>
              )}
            </div>
            {isSoftwareDownloading && (
              <div
                className="version-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={softwareState?.percent ?? 0}
              >
                <div
                  className="version-progress-fill"
                  style={{ width: `${Math.max(4, Math.min(100, softwareState?.percent ?? 0))}%` }}
                />
              </div>
            )}
            {!unavailable && (
              <div className="version-action-row">
                <button
                  type="button"
                  className={`version-action${hasSoftwareUpdate ? " has-update" : ""}`}
                  onClick={softwareAction}
                  disabled={
                    softwareBusy ||
                    softwareState?.phase === "downloading" ||
                    softwareState?.phase === "verifying" ||
                    softwareState?.phase === "installing" ||
                    softwareState?.phase === "checking"
                  }
                  title={softwareToast?.text || softwareState?.message || undefined}
                >
                  <ArrowClockwise size={13} aria-hidden="true" />
                  {softwareLabel}
                </button>
                {softwareState?.phase === "downloading" && (
                  <button
                    type="button"
                    className="version-cancel"
                    onClick={cancelSoftwareDownload}
                  >
                    取消
                  </button>
                )}
              </div>
            )}
            {softwareState?.phase === "error" && softwareState.availableVersion && (
              <div className="version-error-row">
                <span className="version-error-text" title={softwareState.message || softwareToast?.text}>
                  {softwareState.message || softwareToast?.text || "下载失败"}
                </span>
                <button
                  type="button"
                  className="version-fallback-link"
                  onClick={openBrowserSoftwareDownload}
                >
                  浏览器下载
                </button>
              </div>
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
            onRefresh={refreshProjects}
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
            selectedRulepacks={effectiveSelectedRulepacks}
            selectedTargets={selectedTargets}
            updateCheck={updateCheck}
            busy={busy}
            unavailable={unavailable}
            error={error}
            notice={notice}
            onBackToProjects={() => navigateTo("projects")}
            onRefreshProject={refreshCurrentProject}
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
            onPreviewRepair={openRepairPreview}
            onPreviewForceUninstall={openForceUninstallPreview}
          />
        )}

        {view === "assets" && <AssetsPage api={window.zhishu} onBusyChange={handleSubPageBusyChange} />}

        {view === "tools" && (
          <ToolsPage
            api={window.zhishu}
            onOpenAssets={() => navigateTo("assets")}
            onBusyChange={handleSubPageBusyChange}
          />
        )}

        {view === "sources" && (
          <SourcesPage
            api={window.zhishu}
            sources={sources}
            workspaceSource={workspaceSource}
            onSourcesChange={handleSourcesChange}
            onWorkspaceSourceChange={(selected) => {
              userTouchedWorkspaceRef.current = true;
              setWorkspaceSource(selected);
              setSourceKind("workspace");
              setSelectedRulepacks((current) => filterPacksForSource(current, "workspace", selected));
            }}
            onOpenAssets={() => navigateTo("assets")}
            onBusyChange={handleSubPageBusyChange}
          />
        )}

        {view === "evolution" && (
          <EvolutionPage
            api={window.zhishu}
            sources={sources}
            workspaceSource={workspaceSource}
            onBadgeCountChange={setEvolutionBadgeCount}
            onOpenProjects={() => navigateTo("projects")}
            onBusyChange={handleSubPageBusyChange}
          />
        )}
      </main>

      {preview && (
        <PreviewDialog
          key={`${preview.kind}:${preview.root}`}
          preview={preview}
          busy={busy}
          error={previewError}
          onClose={() => {
            if (!busy) clearPreview();
          }}
          onApply={applyPreview}
        />
      )}

      {softwareToast && (
        <div
          className={`software-toast${softwareToast.tone === "info" ? " is-info" : ""}`}
          role={softwareToast.tone === "error" ? "alert" : "status"}
        >
          <span className="software-toast-text">{softwareToast.text}</span>
          <button
            type="button"
            className="software-toast-close"
            aria-label="关闭提示"
            onClick={() => setSoftwareToast(undefined)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
