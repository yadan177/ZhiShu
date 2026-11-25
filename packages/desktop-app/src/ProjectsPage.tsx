import { useMemo, useState } from "react";
import { CheckCircle, FolderSimple, MagnifyingGlass, WarningCircle, Wrench } from "@phosphor-icons/react";
import { APP_COPY, STACK_LABELS, formatPlatformList } from "./copy";
import type { RegisteredProject } from "./types";

interface ProjectsPageProps {
  projects: RegisteredProject[];
  currentRoot?: string;
  busy: boolean;
  unavailable: boolean;
  error: string;
  notice: string;
  onAddProject: () => void;
  onSelectProject: (root: string) => void;
  onRecoverProject: (root: string) => void;
  onForgetProject: (root: string) => void;
}

function projectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

function statusBadge(item: RegisteredProject): { label: string; tone: string } {
  if (item.error || !item.status) {
    return { label: APP_COPY.status.unavailable, tone: "badge--danger" };
  }
  if (item.status.interruptedTransactions.length > 0) {
    return { label: APP_COPY.status.interrupted, tone: "badge--warning" };
  }
  if (!item.status.installed) {
    return { label: APP_COPY.status.uninstalled, tone: "badge--muted" };
  }
  if (!item.status.valid) {
    return { label: APP_COPY.status.invalid, tone: "badge--danger" };
  }
  return { label: APP_COPY.status.healthy, tone: "badge--success" };
}

export function ProjectsPage({
  projects,
  currentRoot,
  busy,
  unavailable,
  error,
  notice,
  onAddProject,
  onSelectProject,
  onRecoverProject,
  onForgetProject,
}: ProjectsPageProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return projects;
    return projects.filter((item) => {
      const name = projectName(item.root).toLocaleLowerCase();
      return name.includes(keyword) || item.root.toLocaleLowerCase().includes(keyword);
    });
  }, [projects, query]);

  return (
    <div className="workspace-scroll">
      <header className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.projects}</h1>
          <span className="badge badge--muted">{projects.length}</span>
        </div>
        <div className="page-header-actions">
          <div className="search-input-wrap">
            <MagnifyingGlass size={15} className="search-input-icon" aria-hidden="true" />
            <input
              type="search"
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称或路径"
              aria-label="搜索项目"
            />
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={onAddProject}
            disabled={busy || unavailable}
          >
            <FolderSimple size={16} aria-hidden="true" />
            {APP_COPY.actions.addProject}
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span>{projects.length === 0 ? APP_COPY.empty.projects : APP_COPY.empty.searchProjects}</span>
          {projects.length === 0 && (
            <button
              type="button"
              className="secondary-button"
              onClick={onAddProject}
              disabled={busy || unavailable}
            >
              <FolderSimple size={15} aria-hidden="true" />
              {APP_COPY.actions.addProject}
            </button>
          )}
        </div>
      ) : (
        <section className="project-list" aria-label={APP_COPY.nav.projects}>
          {filtered.map((item) => {
            const badge = statusBadge(item);
            const status = item.status;
            const interrupted = (status?.interruptedTransactions.length ?? 0) > 0;
            return (
              <article
                className={`project-card${currentRoot === item.root ? " current" : ""}`}
                key={item.root}
              >
                <div className="project-card-main">
                  <div className="project-card-title-row">
                    <button
                      type="button"
                      className="project-name-btn"
                      onClick={() => onSelectProject(item.root)}
                      disabled={busy || !!item.error}
                      title={item.root}
                    >
                      {projectName(item.root)}
                    </button>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    {status?.installed && status.sourceType && (
                      <span className={`badge ${status.sourceType === "workspace" ? "badge--enterprise" : "badge--brand"}`}>
                        {status.sourceType === "workspace" ? APP_COPY.sources.workspace : APP_COPY.sources.github}
                      </span>
                    )}
                    {status?.installed && status.version && (
                      <span className="badge badge--muted">{status.version}</span>
                    )}
                  </div>

                  <div className="project-path" title={item.root}>
                    {item.root}
                  </div>

                  <div className="project-meta-row">
                    {item.error ? (
                      <span className="inline-issue">{item.error}</span>
                    ) : status?.installed ? (
                      <>
                        <span>{formatPlatformList(status.targets)}</span>
                        <span>·</span>
                        <span>{status.rulepacks.length} 个规则包</span>
                      </>
                    ) : status && status.detection.stacks.length > 0 ? (
                      status.detection.stacks.map((stack) => (
                        <span className="badge badge--brand" key={stack.id}>
                          已识别 {STACK_LABELS[stack.id] ?? stack.id}
                        </span>
                      ))
                    ) : (
                      <span>未检测到语言标记</span>
                    )}
                  </div>
                </div>

                <div className="project-card-actions">
                  {interrupted && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onRecoverProject(item.root)}
                      disabled={busy}
                    >
                      <Wrench size={14} aria-hidden="true" />
                      {APP_COPY.actions.recoverInterrupted}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onSelectProject(item.root)}
                    disabled={busy || !!item.error}
                  >
                    {APP_COPY.actions.manageRules}
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => onForgetProject(item.root)}
                    disabled={busy}
                  >
                    {APP_COPY.actions.removeFromList}
                  </button>
                </div>
              </article>
            );
          })}
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
    </div>
  );
}
