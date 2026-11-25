import { useMemo } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle,
  FolderOpen,
  Sparkle,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { Dropdown } from "./Dropdown";
import {
  APP_COPY,
  PLATFORM_LIST,
  RULEPACK_CATALOG,
  RULEPACK_GROUPS,
  STACK_LABELS,
  formatPlatformList,
  resolveImplicitDependencies,
  rulePackDisplayName,
} from "./copy";
import type {
  AssetSourceRecord,
  PlatformChoice,
  ProjectStatus,
  RegisteredProject,
  RuleMode,
  UpdateCheck,
  WorkspaceSourceInfo,
} from "./types";

interface ProjectRulesPageProps {
  projects: RegisteredProject[];
  sources: AssetSourceRecord[];
  enterpriseRequiredPacks: ReadonlySet<string>;
  status?: ProjectStatus;
  mode: RuleMode;
  sourceKind: "github" | "workspace";
  workspaceSource?: WorkspaceSourceInfo;
  selectedRulepacks: string[];
  selectedTargets: PlatformChoice[];
  updateCheck?: UpdateCheck;
  busy: boolean;
  unavailable: boolean;
  error: string;
  notice: string;
  onBackToProjects: () => void;
  onSelectProject: (root: string) => void;
  onChangeMode: (mode: RuleMode) => void;
  onChangeSourceKind: (kind: "github" | "workspace") => void;
  onSelectRegisteredSource: (source: AssetSourceRecord) => void;
  onChooseWorkspaceSource: () => void;
  onToggleRulepack: (packId: string) => void;
  onApplyRecommendation: () => void;
  onToggleTarget: (target: PlatformChoice) => void;
  onRecover: () => void;
  onCheckUpdate: () => void;
  onOpenPreview: () => void;
}

function projectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

export function ProjectRulesPage({
  projects,
  sources,
  enterpriseRequiredPacks,
  status,
  mode,
  sourceKind,
  workspaceSource,
  selectedRulepacks,
  selectedTargets,
  updateCheck,
  busy,
  unavailable,
  error,
  notice,
  onBackToProjects,
  onSelectProject,
  onChangeMode,
  onChangeSourceKind,
  onSelectRegisteredSource,
  onChooseWorkspaceSource,
  onToggleRulepack,
  onApplyRecommendation,
  onToggleTarget,
  onRecover,
  onCheckUpdate,
  onOpenPreview,
}: ProjectRulesPageProps) {
  const effectiveSourceType = mode === "install" ? sourceKind : status?.sourceType ?? "github";
  const workspacePackIds = useMemo(
    () => (workspaceSource ? new Set(workspaceSource.packs.map((pack) => pack.id)) : undefined),
    [workspaceSource],
  );
  const implicitDeps = useMemo(
    () => resolveImplicitDependencies(selectedRulepacks, workspaceSource?.packs),
    [selectedRulepacks, workspaceSource],
  );

  const isPackAvailable = (packId: string, releasedInOfficial015: boolean): boolean => {
    if (effectiveSourceType === "workspace") {
      if (mode === "install") {
        return workspacePackIds ? workspacePackIds.has(packId) : false;
      }
      // 更新模式下的本地源项目可能指向用户自定义目录，不提前锁死，由核心校验。
      return true;
    }
    return releasedInOfficial015;
  };

  const interrupted = (status?.interruptedTransactions.length ?? 0) > 0;
  const installDisabled =
    busy ||
    !status ||
    status.installed ||
    interrupted ||
    selectedRulepacks.length === 0 ||
    selectedTargets.length === 0 ||
    (sourceKind === "workspace" && !workspaceSource);
  const updateDisabled =
    busy ||
    !status ||
    !status.installed ||
    !status.valid ||
    interrupted ||
    selectedRulepacks.length === 0 ||
    selectedTargets.length === 0;
  const uninstallDisabled = busy || !status || !status.installed || interrupted;

  const primaryDisabled =
    mode === "install"
      ? installDisabled
      : mode === "update"
        ? updateDisabled
        : uninstallDisabled;

  const primaryLabel = busy
    ? APP_COPY.actions.processing
    : mode === "install"
      ? APP_COPY.actions.previewInstall
      : mode === "update"
        ? updateCheck?.available
          ? APP_COPY.actions.previewUpdate
          : APP_COPY.actions.checkUpdate
        : APP_COPY.actions.previewUninstall;

  const handlePrimary = (): void => {
    if (mode === "update" && !updateCheck?.available) {
      onCheckUpdate();
      return;
    }
    onOpenPreview();
  };

  const renderRulepackMatrix = (disabledAll: boolean) => (
    <div className="rulepack-groups">
      {RULEPACK_GROUPS.map((group) => {
        const items = RULEPACK_CATALOG.filter((item) => item.group === group.id);
        return (
          <div key={group.id}>
            <div className="rulepack-group-title">{group.title}</div>
            <div className="rulepack-grid">
              {items.map((pack) => {
                const requiredByEnterprise = enterpriseRequiredPacks.has(pack.id);
                const selected = selectedRulepacks.includes(pack.id) || requiredByEnterprise;
                const implicit = !selected && implicitDeps.has(pack.id);
                const available = isPackAvailable(pack.id, pack.releasedInOfficial015);
                const disabled = disabledAll || !available || requiredByEnterprise;
                return (
                  <button
                    type="button"
                    key={pack.id}
                    role="checkbox"
                    aria-checked={selected || implicit}
                    className={`rulepack-item${selected ? " selected" : implicit ? " implicit" : ""}`}
                    disabled={disabled}
                    onClick={() => onToggleRulepack(pack.id)}
                    title={
                      requiredByEnterprise
                        ? "由企业源声明为必选规范，自动锁定"
                        : pack.dependencies.length
                          ? `依赖：${pack.dependencies.join(", ")}`
                          : pack.id
                    }
                  >
                    <span className="check-box" aria-hidden="true">
                      {(selected || implicit) && <Check size={11} weight="bold" />}
                    </span>
                    <span className="rulepack-item-body">
                      <span className="rulepack-item-top">
                        <span className="rulepack-item-name">{pack.name}</span>
                        {requiredByEnterprise && <span className="badge badge--enterprise">企业必选</span>}
                        {!requiredByEnterprise && implicit && <span className="badge badge--brand">自动依赖</span>}
                        {!available && effectiveSourceType === "github" && (
                          <span className="badge badge--muted">本地源可用</span>
                        )}
                        {!available && effectiveSourceType === "workspace" && (
                          <span className="badge badge--muted">未包含</span>
                        )}
                      </span>
                      <span className="rulepack-item-id">{pack.id}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderPlatformMatrix = (disabledAll: boolean) => (
    <div className="platform-grid" role="group" aria-label="适用 AI 工具">
      {PLATFORM_LIST.map((platform) => {
        const selected = selectedTargets.includes(platform.id);
        return (
          <button
            type="button"
            key={platform.id}
            role="checkbox"
            aria-checked={selected}
            className={`platform-chip${selected ? " selected" : ""}`}
            disabled={disabledAll}
            onClick={() => onToggleTarget(platform.id)}
          >
            <span className="check-box" aria-hidden="true">
              {selected && <Check size={11} weight="bold" />}
            </span>
            <span className="platform-chip-text">
              <span className="platform-chip-name">{platform.name}</span>
              <span className="platform-chip-tag">{platform.tag}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="workspace-scroll">
        <header className="page-header">
          <div className="page-header-left">
            <button
              type="button"
              className="ghost-button"
              onClick={onBackToProjects}
              disabled={busy}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              {APP_COPY.actions.backToProjects}
            </button>
            <h1>{APP_COPY.nav.rules}</h1>
          </div>
          <nav className="segmented" aria-label="规则操作模式">
            <button
              type="button"
              className={mode === "install" ? "active" : ""}
              disabled={busy}
              onClick={() => onChangeMode("install")}
            >
              {APP_COPY.modes.install}
            </button>
            <button
              type="button"
              className={mode === "update" ? "active" : ""}
              disabled={busy}
              onClick={() => onChangeMode("update")}
            >
              {APP_COPY.modes.update}
            </button>
            <button
              type="button"
              className={mode === "uninstall" ? "active" : ""}
              disabled={busy}
              onClick={() => onChangeMode("uninstall")}
            >
              {APP_COPY.modes.uninstall}
            </button>
          </nav>
        </header>

        <div className="rules-toolbar">
          <div className="rules-project-picker">
            <Dropdown
              label="当前项目"
              className="project-dropdown"
              value={status?.root}
              onChange={onSelectProject}
              disabled={busy || unavailable}
              placeholder={projects.length ? APP_COPY.empty.selectProject : APP_COPY.empty.noProjectOption}
              emptyLabel={APP_COPY.empty.projects}
              options={projects.map((item) => ({
                value: item.root,
                label: projectName(item.root),
                description: item.error ? `${item.root} · ${APP_COPY.status.unavailable}` : item.root,
                disabled: !!item.error,
              }))}
            />
          </div>
        </div>

        {status && (
          <div className="status-strip">
            <div className="status-strip-group">
              <span
                className={`badge ${
                  interrupted
                    ? "badge--warning"
                    : !status.installed
                      ? "badge--muted"
                      : status.valid
                        ? "badge--success"
                        : "badge--danger"
                }`}
              >
                {interrupted
                  ? APP_COPY.status.interrupted
                  : !status.installed
                    ? APP_COPY.status.uninstalled
                    : status.valid
                      ? APP_COPY.status.healthy
                      : APP_COPY.status.invalid}
              </span>
              {status.installed && (
                <>
                  <span className={`badge ${status.sourceType === "workspace" ? "badge--enterprise" : "badge--brand"}`}>
                    {status.sourceType === "workspace" ? APP_COPY.sources.workspace : APP_COPY.sources.github}
                  </span>
                  {status.version && <span className="badge badge--muted">{status.version}</span>}
                  <span className="mono-inline">{formatPlatformList(status.targets)}</span>
                </>
              )}
              {!status.installed &&
                status.detection.stacks.map((stack) => (
                  <span
                    className="badge badge--brand"
                    key={stack.id}
                    title={stack.evidence.map((ev) => `${ev.path}：${ev.reason}`).join("；")}
                  >
                    已识别 {STACK_LABELS[stack.id] ?? stack.id}
                  </span>
                ))}
            </div>
            <div className="status-strip-group">
              <span className="mono-inline">{status.overridesPath ?? ".agent-rules/overrides.md"}</span>
              <span className={`badge ${status.overridesExists ? "badge--success" : "badge--muted"}`}>
                {status.overridesExists ? "本地覆盖已保留" : "安装时自动创建"}
              </span>
            </div>
          </div>
        )}

        {interrupted && status && (
          <div className="alert-banner" role="alert">
            <div className="alert-banner-body">
              <WarningCircle size={18} style={{ flex: "none" }} />
              <span>
                检测到 {status.interruptedTransactions.length} 个中断未完成事务（
                {status.interruptedTransactions.map((item) => projectName(item)).join("、")}）
              </span>
            </div>
            <button type="button" className="secondary-button" onClick={onRecover} disabled={busy}>
              <Wrench size={14} aria-hidden="true" />
              {APP_COPY.actions.recoverInterrupted}
            </button>
          </div>
        )}

        {mode === "install" && (
          <>
            <section className="surface-card">
              <div className="card-header">
                <h2>规则来源</h2>
                <div className="segmented" role="radiogroup" aria-label="规则来源">
                  <button
                    type="button"
                    className={sourceKind === "github" ? "active" : ""}
                    disabled={busy || !!status?.installed}
                    onClick={() => onChangeSourceKind("github")}
                  >
                    {APP_COPY.sources.github}
                  </button>
                  <button
                    type="button"
                    className={sourceKind === "workspace" ? "active" : ""}
                    disabled={busy || !!status?.installed}
                    onClick={() => onChangeSourceKind("workspace")}
                  >
                    {APP_COPY.sources.workspace}
                  </button>
                </div>
              </div>
              <div className="source-row">
                {sources.filter((src) => src.access === "local" || (src.access === "git" && !!src.localCheckoutPath)).length > 0 && (
                  <div className="dropdown-field">
                    <span>已注册源</span>
                    <Dropdown
                      label="切换已注册来源"
                      value={
                        sourceKind === "github"
                          ? "zhishu-official"
                          : sources.find(
                              (s) =>
                                (s.access === "local" && s.location === workspaceSource?.root) ||
                                (s.access === "git" && s.localCheckoutPath === workspaceSource?.root),
                            )?.id
                      }
                      disabled={busy || !!status?.installed}
                      placeholder="选择已注册来源"
                      onChange={(id) => {
                        const chosen = sources.find((item) => item.id === id);
                        if (chosen) onSelectRegisteredSource(chosen);
                      }}
                      options={sources
                        .filter((s) => s.access === "github-release" || s.access === "local" || !!s.localCheckoutPath)
                        .map((s) => ({
                          value: s.id,
                          label: `${s.name}（${s.tier === "enterprise" ? "企业" : s.tier === "personal" ? "个人" : "官方"}）`,
                          description: s.location,
                        }))}
                    />
                  </div>
                )}
                {sourceKind === "github" ? (
                  <>
                    <span className="badge badge--brand">GitHub Release</span>
                    <span className="mono-inline">yadan177/ZhiShu</span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={onChooseWorkspaceSource}
                      disabled={busy || !!status?.installed}
                    >
                      <FolderOpen size={15} aria-hidden="true" />
                      {APP_COPY.actions.chooseWorkspaceSource}
                    </button>
                    {workspaceSource ? (
                      <>
                        <span className="badge badge--success">{workspaceSource.packs.length} 个可用规则包</span>
                        <span className="mono-inline" title={workspaceSource.root}>
                          {workspaceSource.root}
                        </span>
                      </>
                    ) : (
                      <span className="badge badge--warning">尚未选择本地规则源目录</span>
                    )}
                  </>
                )}
                {enterpriseRequiredPacks.size > 0 && (
                  <span className="badge badge--enterprise">叠加企业必选 · {enterpriseRequiredPacks.size} 项</span>
                )}
              </div>
            </section>

            <section className="surface-card">
              <div className="card-header">
                <h2>规则包组合</h2>
                {status && !status.installed && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onApplyRecommendation}
                    disabled={busy}
                  >
                    <Sparkle size={14} aria-hidden="true" />
                    {APP_COPY.actions.applyRecommendation}
                  </button>
                )}
              </div>
              {renderRulepackMatrix(busy || !status || status.installed || interrupted)}
            </section>

            <section className="surface-card">
              <div className="card-header">
                <h2>适用 AI 工具</h2>
                <span className="badge badge--muted">共用 AGENTS.md</span>
              </div>
              {renderPlatformMatrix(busy || !status || status.installed || interrupted)}
            </section>
          </>
        )}

        {mode === "update" && (
          <>
            <section className="surface-card">
              <div className="card-header">
                <h2>已安装状态</h2>
                {updateCheck && (
                  <span className={`badge ${updateCheck.available ? "badge--brand" : "badge--success"}`}>
                    {updateCheck.rulepacksChanged
                      ? "规则包配置已变更"
                      : updateCheck.targetsChanged
                        ? "适用工具已变更"
                        : updateCheck.available
                          ? `${updateCheck.currentVersion} → ${updateCheck.latestVersion}`
                          : `${updateCheck.currentVersion} · 已是最新`}
                  </span>
                )}
              </div>
              {status?.installed ? (
                <div className="source-row">
                  <span className="mono-inline">{status.sourceLabel ?? "-"}</span>
                  <span>·</span>
                  <span>已配置 {status.rulepacks.length} 个规则包</span>
                </div>
              ) : (
                <span className="mono-inline">{status ? "当前项目尚未安装规则" : APP_COPY.empty.selectProject}</span>
              )}
              {status?.issues.map((issue) => (
                <p className="inline-issue" key={`${issue.code}:${issue.message}`}>
                  [{issue.code}] {issue.message}
                </p>
              ))}
            </section>

            {status?.installed && (
              <>
                <section className="surface-card">
                  <div className="card-header">
                    <h2>规则包组合（可调整）</h2>
                  </div>
                  {renderRulepackMatrix(busy || !status.valid || interrupted)}
                </section>
                <section className="surface-card">
                  <div className="card-header">
                    <h2>适用 AI 工具（可调整）</h2>
                  </div>
                  {renderPlatformMatrix(busy || !status.valid || interrupted)}
                </section>
              </>
            )}
          </>
        )}

        {mode === "uninstall" && (
          <section className="surface-card">
            <div className="card-header">
              <h2>已安装规则</h2>
            </div>
            {status?.installed ? (
              <div className="project-card-main">
                <div className="project-meta-row">
                  <strong>{formatPlatformList(status.targets)}</strong>
                  <span>·</span>
                  <span>{status.version ?? "版本未知"}</span>
                  {status.sourceLabel && (
                    <>
                      <span>·</span>
                      <span className="mono-inline">{status.sourceLabel}</span>
                    </>
                  )}
                </div>
                <div className="project-meta-row">
                  {status.rulepacks.map((packId) => (
                    <span className="badge badge--muted" key={packId}>
                      {rulePackDisplayName(packId)}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <span className="mono-inline">{status ? "当前项目尚未安装规则" : APP_COPY.empty.selectProject}</span>
            )}
            {status?.issues.map((issue) => (
              <p className="inline-issue" key={`${issue.code}:${issue.message}`}>
                [{issue.code}] {issue.message}
              </p>
            ))}
          </section>
        )}

        {error && (
          <div className="feedback-error" role="alert">
            <WarningCircle size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="feedback-notice" role="status">
            <CheckCircle size={17} style={{ flex: "none" }} />
            <span>{notice}</span>
          </div>
        )}
        {unavailable && (
          <div className="feedback-error" role="alert">
            请在桌面应用中打开此页面。
          </div>
        )}
      </div>

      <footer className="workspace-footer">
        <div className="workspace-footer-summary">
          {mode !== "uninstall" ? (
            <>
              <span>已选 {selectedRulepacks.length} 个规则包</span>
              {implicitDeps.size > 0 && <span className="badge badge--brand">+{implicitDeps.size} 自动依赖</span>}
              <span>·</span>
              <span>{selectedTargets.length} 个平台</span>
            </>
          ) : (
            <span>保留 {status?.overridesPath ?? ".agent-rules/overrides.md"} 及项目本地文件</span>
          )}
        </div>
        <div className="workspace-footer-actions">
          <button
            type="button"
            className={mode === "uninstall" ? "danger-button" : "primary-button"}
            onClick={handlePrimary}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
        </div>
      </footer>
    </>
  );
}
