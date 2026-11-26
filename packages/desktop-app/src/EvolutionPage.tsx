import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  GearSix,
  GlobeHemisphereEast,
  MagnifyingGlass,
  Plus,
  Scan,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { APP_COPY, RULEPACK_CATALOG } from "./copy";
import { Dropdown } from "./Dropdown";
import {
  formatErrorMessage,
  type AssetSourceRecord,
  type DesktopApi,
  type DocsWatchSourceResult,
  type EvolutionChannel,
  type EvolutionCounts,
  type EvolutionOperation,
  type EvolutionPreview,
  type EvolutionProposal,
  type EvolutionStatus,
  type EvolutionTargetKind,
  type EvolutionTargetSource,
  type EvolutionWatchProgress,
  type WatchSourceConfig,
  type WorkspaceSourceInfo,
} from "./types";

type StatusTab = "pending" | "conflict" | "processed";
type ChannelFilter = "all" | EvolutionChannel;
type KindFilter = "all" | EvolutionTargetKind;

const CHANNEL_META: Record<EvolutionChannel, { label: string; badgeClass: string }> = {
  "session-capture": { label: "对话捕获", badgeClass: "badge--brand" },
  "overrides-promotion": { label: "本地覆盖升格", badgeClass: "badge--warning" },
  "docs-watch": { label: "官方文档巡检", badgeClass: "badge--neutral" },
};

const KIND_LABEL: Record<EvolutionTargetKind, string> = {
  rule: "底层规则",
  skill: "岗位技能",
};

const OPERATION_LABEL: Record<EvolutionOperation, string> = {
  "add-item": "新增条款",
  "update-item": "修订条款",
  "deprecate-item": "废弃条款",
};

const STATUS_META: Record<EvolutionStatus, { label: string; badgeClass: string }> = {
  pending: { label: "待审", badgeClass: "badge--brand" },
  conflict: { label: "有冲突", badgeClass: "badge--danger" },
  stale: { label: "已陈旧", badgeClass: "badge--warning" },
  approved: { label: "已写入", badgeClass: "badge--success" },
  rejected: { label: "已驳回", badgeClass: "badge--neutral" },
  archived: { label: "已归档", badgeClass: "badge--neutral" },
};

const EMPTY_COUNTS: EvolutionCounts = {
  badge: 0,
  pendingTab: 0,
  conflictTab: 0,
  processedTab: 0,
  total: 0,
};

function matchesStatusTab(status: EvolutionStatus, tab: StatusTab): boolean {
  if (tab === "pending") return status === "pending" || status === "stale";
  if (tab === "conflict") return status === "conflict";
  return status === "approved" || status === "rejected" || status === "archived";
}

function formatDate(iso?: string): string {
  if (!iso) return "-";
  return iso.slice(0, 10);
}

interface FocusedDiffView {
  startLine: number;
  beforeExcerpt: string;
  afterExcerpt: string;
  hasChange: boolean;
}

function buildFocusedDiff(beforeContent: string, afterContent: string, contextLines = 3): FocusedDiffView {
  if (!beforeContent && !afterContent) {
    return { startLine: 1, beforeExcerpt: "", afterExcerpt: "", hasChange: false };
  }
  const beforeLines = beforeContent.replace(/\r\n/g, "\n").split("\n");
  const afterLines = afterContent.replace(/\r\n/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++;
  }
  const hasChange = prefix < beforeLines.length - suffix || prefix < afterLines.length - suffix;
  if (!hasChange) {
    return { startLine: 1, beforeExcerpt: beforeContent, afterExcerpt: afterContent, hasChange: false };
  }
  const start = Math.max(0, prefix - contextLines);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + contextLines);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + contextLines);
  const formatSlice = (lines: string[], from: number, to: number, changeStart: number, changeEnd: number, marker: "-" | "+"): string =>
    lines
      .slice(from, to)
      .map((line, idx) => {
        const lineNo = from + idx;
        const prefixMark = lineNo >= changeStart && lineNo < changeEnd ? marker : " ";
        return `${String(lineNo + 1).padStart(3, " ")} ${prefixMark} ${line}`;
      })
      .join("\n");

  return {
    startLine: start + 1,
    beforeExcerpt: formatSlice(beforeLines, start, beforeEnd, prefix, beforeLines.length - suffix, "-"),
    afterExcerpt: formatSlice(afterLines, start, afterEnd, prefix, afterLines.length - suffix, "+"),
    hasChange: true,
  };
}

interface EvolutionPageProps {
  api?: DesktopApi;
  sources: AssetSourceRecord[];
  workspaceSource?: WorkspaceSourceInfo;
  onBadgeCountChange: (count: number) => void;
  onOpenProjects: () => void;
}

export function EvolutionPage({
  api,
  sources,
  workspaceSource,
  onBadgeCountChange,
  onOpenProjects,
}: EvolutionPageProps) {
  const [proposals, setProposals] = useState<EvolutionProposal[]>([]);
  const [counts, setCounts] = useState<EvolutionCounts>(EMPTY_COUNTS);
  const [watchSources, setWatchSources] = useState<WatchSourceConfig[]>([]);

  const [tab, setTab] = useState<StatusTab>("pending");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");

  const [activeId, setActiveId] = useState<string>();
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [draftAnchor, setDraftAnchor] = useState("");
  const [draftBefore, setDraftBefore] = useState("");
  const [draftAfter, setDraftAfter] = useState("");
  const [rejectingId, setRejectingId] = useState<string>();
  const [rejectReason, setRejectReason] = useState("");

  const [preview, setPreview] = useState<EvolutionPreview>();
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [draftWatchSources, setDraftWatchSources] = useState<WatchSourceConfig[]>([]);
  const [newWatchName, setNewWatchName] = useState("");
  const [newWatchUrl, setNewWatchUrl] = useState("");
  const [newWatchPack, setNewWatchPack] = useState("ui-design");
  const [newWatchPath, setNewWatchPath] = useState("rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
  const [newWatchAnchor, setNewWatchAnchor] = useState("");
  const [newWatchKeywords, setNewWatchKeywords] = useState("");
  const [watchFormError, setWatchFormError] = useState("");

  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchProgress, setWatchProgress] = useState<EvolutionWatchProgress>();
  const [failedWatchResults, setFailedWatchResults] = useState<DocsWatchSourceResult[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [justAppliedPath, setJustAppliedPath] = useState<string>();

  const targetSources = useMemo<EvolutionTargetSource[]>(() => {
    const items: EvolutionTargetSource[] = [];
    const seenRoots = new Set<string>();

    if (workspaceSource?.root) {
      items.push({
        id: "__workspace__",
        name: "当前本地规则仓库",
        root: workspaceSource.root,
        readonly: false,
      });
      seenRoots.add(workspaceSource.root);
    }

    for (const src of sources) {
      if (src.access === "github-release" || src.readonly) {
        items.push({
          id: src.id,
          name: `${src.name}（只读）`,
          readonly: true,
        });
        continue;
      }
      const root = src.access === "local" ? src.location : src.localCheckoutPath;
      if (root && seenRoots.has(root)) continue;
      if (root) seenRoots.add(root);
      items.push({
        id: src.id,
        name: root ? src.name : `${src.name}（未同步）`,
        root,
        readonly: !root,
      });
    }

    return items;
  }, [sources, workspaceSource]);

  const defaultWritableSourceId = useMemo(
    () => targetSources.find((src) => !src.readonly && src.root)?.id ?? targetSources[0]?.id ?? "",
    [targetSources],
  );

  const selectedTargetSource = useMemo(
    () => targetSources.find((src) => src.id === selectedSourceId) ?? targetSources[0],
    [targetSources, selectedSourceId],
  );

  useEffect(() => {
    if (!selectedSourceId && defaultWritableSourceId) {
      setSelectedSourceId(defaultWritableSourceId);
    }
  }, [defaultWritableSourceId, selectedSourceId]);

  const activeProposal = useMemo(
    () => proposals.find((item) => item.id === activeId),
    [proposals, activeId],
  );

  function syncList(next: { proposals: EvolutionProposal[]; counts: EvolutionCounts }): void {
    setProposals(next.proposals);
    setCounts(next.counts);
    onBadgeCountChange(next.counts.badge);
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    const unsubscribe = api.onEvolutionWatchProgress((progress) => {
      if (!cancelled) setWatchProgress(progress);
    });
    void Promise.all([api.listEvolutionProposals(), api.getEvolutionWatchSources()])
      .then(([listed, watchList]) => {
        if (cancelled) return;
        syncList(listed);
        setWatchSources(watchList);
      })
      .catch((problem) => {
        if (!cancelled) setError(formatErrorMessage(problem));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  function openReviewDrawer(proposal: EvolutionProposal): void {
    setActiveId(proposal.id);
    setDraftAnchor(proposal.anchorHeading);
    setDraftBefore(proposal.beforeSnippet ?? "");
    setDraftAfter(proposal.afterSnippet ?? "");
    setRejectingId(undefined);
    setRejectReason("");
    setError("");
  }

  function closeReviewDrawer(): void {
    if (busy) return;
    setActiveId(undefined);
    setRejectingId(undefined);
    setRejectReason("");
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setJustAppliedPath(undefined);
    try {
      await action();
    } catch (problem) {
      setError(formatErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  function handleScanOverrides(): void {
    if (!api) return;
    void runAction(async () => {
      setNotice("");
      setFailedWatchResults([]);
      const summary = await api.scanEvolutionOverrides(workspaceSource?.root);
      syncList(summary.list);
      const skipNote = summary.skippedProjects.length > 0 ? `，跳过 ${summary.skippedProjects.length} 个不可访问项目` : "";
      if (summary.scannedCount === 0 && summary.skippedProjects.length > 0) {
        setError(`已登记项目均无法读取 .agent-rules/overrides.md（跳过 ${summary.skippedProjects.length} 个）`);
        return;
      }
      setNotice(
        summary.createdCount > 0
          ? `已扫描 ${summary.scannedCount} 个项目${skipNote}，新增 ${summary.createdCount} 条升格提案`
          : `已扫描 ${summary.scannedCount} 个项目${skipNote}，未发现新的跨项目共性覆盖`,
      );
      if (summary.createdCount > 0) setTab("pending");
    });
  }

  function handleWatchDocs(retrySourceIds?: string[]): void {
    if (!api || watching) return;
    setWatching(true);
    setError("");
    setNotice("");
    setJustAppliedPath(undefined);
    setWatchProgress({ completed: 0, total: retrySourceIds?.length ?? watchSources.filter((s) => s.enabled).length, currentSourceName: "" });
    void api
      .watchEvolutionDocs({
        sourceIds: retrySourceIds,
        workspaceRoot: workspaceSource?.root,
      })
      .then((summary) => {
        syncList(summary.list);
        setWatchSources(summary.watchSources);
        const failed = summary.results.filter((item) => item.status === "error");
        setFailedWatchResults(failed);
        if (summary.cancelled) {
          setNotice(`已取消巡检（已完成 ${summary.succeededCount} 源，新增 ${summary.createdCount} 条提案）`);
        } else if (summary.createdCount > 0) {
          setNotice(
            `官方文档巡检完成：成功 ${summary.succeededCount} 源，新增 ${summary.createdCount} 条修订提案` +
              (failed.length > 0 ? `，${failed.length} 源失败` : ""),
          );
          setTab("pending");
        } else {
          setNotice(
            failed.length > 0
              ? `巡检完成：成功 ${summary.succeededCount} 源无滞后差异，${failed.length} 源失败`
              : `全部 ${summary.succeededCount} 个巡检源均无滞后差异`,
          );
        }
      })
      .catch((problem) => {
        setError(formatErrorMessage(problem));
      })
      .finally(() => {
        setWatching(false);
        setWatchProgress(undefined);
      });
  }

  function handleCancelWatch(): void {
    if (!api || !watching) return;
    void api.cancelEvolutionWatch().catch((problem) => setError(formatErrorMessage(problem)));
  }

  function handleImportProposal(): void {
    if (!api) return;
    void runAction(async () => {
      setNotice("");
      const imported = await api.importEvolutionProposal(workspaceSource?.root);
      if (!imported) return;
      syncList(imported.list);
      if (imported.outcome === "created" && imported.proposal) {
        setNotice(`已导入提案「${imported.proposal.title}」`);
        setTab("pending");
      } else if (imported.outcome === "duplicate") {
        setNotice("收件箱已存在相同指纹的待审提案，已自动折叠");
      } else {
        setNotice("该提案指纹曾被驳回，未重复入箱");
      }
    });
  }

  function handleRecheck(proposal: EvolutionProposal): void {
    if (!api || !selectedTargetSource) return;
    void runAction(async () => {
      setNotice("");
      const result = await api.recheckEvolutionProposal(proposal.id, selectedTargetSource);
      syncList(result.list);
      if (result.conflicts.length === 0) {
        setNotice("基线指纹与锚点核验通过，提案已恢复为待审状态");
      } else {
        setError(`仍存在 ${result.conflicts.length} 项冲突：${result.conflicts[0]}`);
      }
    });
  }

  function handlePreview(proposal: EvolutionProposal): void {
    if (!api || !selectedTargetSource) return;
    void runAction(async () => {
      setNotice("");
      const nextPreview = await api.previewEvolutionProposal(proposal.id, selectedTargetSource, {
        anchorHeading: draftAnchor,
        beforeSnippet: proposal.operation === "add-item" ? undefined : draftBefore,
        afterSnippet: draftAfter,
      });
      setShowFullDiff(false);
      setPreview(nextPreview);
    });
  }

  function handleApplyPreview(): void {
    if (!api || !preview) return;
    void runAction(async () => {
      const applied = await api.applyEvolutionProposal(preview.token);
      syncList(applied.list);
      setPreview(undefined);
      setActiveId(undefined);
      setJustAppliedPath(applied.receipt.targetFilePath);
      setNotice(`已原子写入并通过自动化校验：${applied.receipt.targetFilePath}`);
    });
  }

  function handleReject(proposalId: string, reason?: string): void {
    if (!api) return;
    void runAction(async () => {
      const result = await api.rejectEvolutionProposal(proposalId, reason);
      syncList(result.list);
      setRejectingId(undefined);
      setRejectReason("");
      if (activeId === proposalId) setActiveId(undefined);
      setNotice(`已驳回提案并记录去重指纹`);
    });
  }

  function handleExportPatch(proposal: EvolutionProposal): void {
    if (!api) return;
    void runAction(async () => {
      const exported = await api.exportEvolutionPatch(
        proposal.id,
        selectedTargetSource?.root ?? workspaceSource?.root,
      );
      if (!exported) return;
      setNotice(`已导出增量补丁：${exported.path}`);
    });
  }

  function openWatchSourcesModal(): void {
    setDraftWatchSources(watchSources.map((item) => ({ ...item, keywords: [...item.keywords] })));
    setNewWatchName("");
    setNewWatchUrl("");
    setNewWatchPack("ui-design");
    setNewWatchPath("rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
    setNewWatchAnchor("");
    setNewWatchKeywords("");
    setWatchFormError("");
    setShowWatchModal(true);
  }

  function handleAddWatchSource(): void {
    const name = newWatchName.trim();
    const url = newWatchUrl.trim();
    const targetPath = newWatchPath.trim();
    if (!name) {
      setWatchFormError("请填写巡检源名称");
      return;
    }
    if (!url.startsWith("https://")) {
      setWatchFormError("官方文档 URL 必须使用 https:// 协议");
      return;
    }
    if (!targetPath.startsWith("rulepacks/") && !targetPath.startsWith("plugins/")) {
      setWatchFormError("目标文件相对路径必须位于 rulepacks/ 或 plugins/ 下且以 .md 结尾");
      return;
    }
    if (!targetPath.endsWith(".md")) {
      setWatchFormError("目标文件必须为 .md 文档");
      return;
    }
    const baseId =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || `watch-${Date.now().toString(36)}`;
    const uniqueId = draftWatchSources.some((s) => s.id === baseId) ? `${baseId}-${Date.now().toString(36).slice(-4)}` : baseId;
    const keywords = newWatchKeywords
      .split(/[,，\s]+/)
      .map((kw) => kw.trim())
      .filter(Boolean);

    setDraftWatchSources((current) => [
      ...current,
      {
        schemaVersion: 1,
        id: uniqueId,
        name,
        url,
        targetRulepack: newWatchPack,
        targetPath,
        ...(newWatchAnchor.trim() ? { anchorHeading: newWatchAnchor.trim() } : {}),
        keywords,
        enabled: true,
      },
    ]);
    setNewWatchName("");
    setNewWatchUrl("");
    setNewWatchAnchor("");
    setNewWatchKeywords("");
    setWatchFormError("");
  }

  function handleSaveWatchSources(): void {
    if (!api) return;
    setWatchFormError("");
    void runAction(async () => {
      try {
        const saved = await api.saveEvolutionWatchSources(draftWatchSources);
        setWatchSources(saved);
        setShowWatchModal(false);
        setNotice(`已保存 ${saved.length} 个官方文档巡检源`);
      } catch (problem) {
        setWatchFormError(formatErrorMessage(problem));
        throw problem;
      }
    });
  }

  const filteredProposals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return proposals.filter((item) => {
      if (!matchesStatusTab(item.status, tab)) return false;
      if (channelFilter !== "all" && item.channel !== channelFilter) return false;
      if (kindFilter !== "all" && item.targetKind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.targetPath.toLowerCase().includes(q) ||
        item.anchorHeading.toLowerCase().includes(q) ||
        (item.targetRulepack?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [proposals, tab, channelFilter, kindFilter, query]);

  const hasActiveFilters = channelFilter !== "all" || kindFilter !== "all" || query.trim() !== "";
  const isActionLocked = busy || watching;

  return (
    <div className="workspace-scroll">
      <div className="page-header">
        <div className="page-header-left">
          <h1>{APP_COPY.nav.evolution}</h1>
          {counts.badge > 0 && <span className="badge badge--brand">{counts.badge} 待处理</span>}
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isActionLocked || !api}
            onClick={handleImportProposal}
          >
            <FileArrowUp size={15} aria-hidden="true" />
            {APP_COPY.actions.importProposal}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isActionLocked || !api}
            onClick={openWatchSourcesModal}
          >
            <GearSix size={15} aria-hidden="true" />
            {APP_COPY.actions.manageWatchSources}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isActionLocked || !api}
            onClick={handleScanOverrides}
          >
            <Scan size={15} aria-hidden="true" />
            {APP_COPY.actions.scanOverrides}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={isActionLocked || !api}
            onClick={() => handleWatchDocs()}
          >
            <GlobeHemisphereEast size={15} aria-hidden="true" />
            {watching ? APP_COPY.actions.processing : APP_COPY.actions.watchDocs}
          </button>
        </div>
      </div>

      {watching && watchProgress && (
        <div className="evo-progress-bar" role="status" aria-live="polite">
          <div className="evo-progress-main">
            <span className="evo-progress-text">
              正在巡检官方文档：{watchProgress.currentSourceName || "准备中…"}（{watchProgress.completed}/{watchProgress.total}）
            </span>
            <div className="evo-progress-track">
              <div
                className="evo-progress-fill"
                style={{
                  width: `${watchProgress.total > 0 ? Math.round((watchProgress.completed / watchProgress.total) * 100) : 10}%`,
                }}
              />
            </div>
          </div>
          <button type="button" className="secondary-button" onClick={handleCancelWatch}>
            {APP_COPY.actions.cancelWatch}
          </button>
        </div>
      )}

      {error && (
        <div className="feedback-error" role="alert">
          <WarningCircle size={16} style={{ flex: "none", marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="feedback-notice" role="status">
          <CheckCircle size={16} style={{ flex: "none" }} />
          <span style={{ flex: 1 }}>{notice}</span>
          {justAppliedPath && (
            <button type="button" className="secondary-button" onClick={onOpenProjects}>
              {APP_COPY.actions.goToProjects}
            </button>
          )}
        </div>
      )}

      {failedWatchResults.length > 0 && (
        <div className="evo-partial-failure" role="alert">
          <div className="evo-partial-failure-head">
            <div className="evo-partial-failure-title">
              <WarningCircle size={16} />
              <span>{failedWatchResults.length} 个官方文档巡检源失败（其余结果已保留）</span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={isActionLocked}
              onClick={() => handleWatchDocs(failedWatchResults.map((item) => item.sourceId))}
            >
              <ArrowClockwise size={14} aria-hidden="true" />
              {APP_COPY.actions.retryFailedSources}
            </button>
          </div>
          <ul className="evo-failure-list">
            {failedWatchResults.map((item) => (
              <li key={item.sourceId}>
                <strong>{item.sourceName}</strong>：{item.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="evo-toolbar">
        <div className="pill-group" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`pill-btn${tab === "pending" ? " active" : ""}`}
            onClick={() => setTab("pending")}
          >
            待审 {counts.pendingTab}
          </button>
          <button
            type="button"
            className={`pill-btn${tab === "conflict" ? " active" : ""}`}
            onClick={() => setTab("conflict")}
          >
            有冲突 {counts.conflictTab}
          </button>
          <button
            type="button"
            className={`pill-btn${tab === "processed" ? " active" : ""}`}
            onClick={() => setTab("processed")}
          >
            已处理 {counts.processedTab}
          </button>
        </div>

        <div className="evo-filters">
          <div className="evo-search-wrap">
            <MagnifyingGlass size={15} className="evo-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="form-input evo-search-input"
              placeholder="搜索标题、路径或规则包"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索进化提案"
            />
          </div>
          <Dropdown<ChannelFilter>
            label="按通道筛选"
            value={channelFilter}
            onChange={setChannelFilter}
            className="evo-filter-dropdown"
            options={[
              { value: "all", label: "全部通道" },
              { value: "session-capture", label: "对话捕获" },
              { value: "overrides-promotion", label: "本地覆盖升格" },
              { value: "docs-watch", label: "官方文档巡检" },
            ]}
          />
          <Dropdown<KindFilter>
            label="按资产类型筛选"
            value={kindFilter}
            onChange={setKindFilter}
            className="evo-filter-dropdown"
            options={[
              { value: "all", label: "全部类型" },
              { value: "rule", label: "底层规则" },
              { value: "skill", label: "岗位技能" },
            ]}
          />
        </div>
      </div>

      {proposals.length === 0 ? (
        <div className="empty-state evo-empty">
          <p className="evo-empty-title">暂无待审进化提案</p>
          <div className="evo-empty-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={isActionLocked || !api}
              onClick={handleScanOverrides}
            >
              {APP_COPY.actions.scanOverrides}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={isActionLocked || !api}
              onClick={() => handleWatchDocs()}
            >
              {APP_COPY.actions.watchDocs}
            </button>
          </div>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="empty-state evo-empty">
          <p className="evo-empty-title">当前筛选条件下无匹配提案</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setChannelFilter("all");
                setKindFilter("all");
                setQuery("");
              }}
            >
              {APP_COPY.actions.resetFilters}
            </button>
          )}
        </div>
      ) : (
        <div className="evo-list">
          {filteredProposals.map((proposal) => {
            const channelMeta = CHANNEL_META[proposal.channel];
            const statusMeta = STATUS_META[proposal.status];
            const isOpen =
              proposal.status === "pending" || proposal.status === "conflict" || proposal.status === "stale";
            return (
              <article
                key={proposal.id}
                className={`evo-card${activeId === proposal.id ? " active" : ""}${proposal.status === "conflict" ? " has-conflict" : ""}`}
                onClick={() => openReviewDrawer(proposal)}
              >
                <div className="evo-card-main">
                  <div className="evo-card-badges">
                    <span className={`badge ${statusMeta.badgeClass}`}>{statusMeta.label}</span>
                    <span className={`badge ${channelMeta.badgeClass}`}>{channelMeta.label}</span>
                    <span className="badge badge--neutral">{KIND_LABEL[proposal.targetKind]}</span>
                    <span className="badge badge--neutral">{OPERATION_LABEL[proposal.operation]}</span>
                    {proposal.targetRulepack && (
                      <span className="badge badge--neutral">{proposal.targetRulepack}</span>
                    )}
                  </div>
                  <h3 className="evo-card-title">{proposal.title}</h3>
                  <div className="evo-card-meta">
                    <span>{proposal.targetPath}</span>
                    <span>·</span>
                    <span>{proposal.anchorHeading}</span>
                    <span>·</span>
                    <span>{formatDate(proposal.updatedAt)}</span>
                  </div>
                  {proposal.status === "conflict" && proposal.conflictMessages?.[0] && (
                    <p className="inline-issue">{proposal.conflictMessages[0]}</p>
                  )}
                  {proposal.status === "approved" && proposal.appliedReceipt && (
                    <div className="evo-card-receipt">
                      已写入 {proposal.appliedReceipt.sourceName} · {formatDate(proposal.appliedReceipt.appliedAt)}
                    </div>
                  )}
                  {proposal.status === "rejected" && proposal.rejectionReason && (
                    <div className="evo-card-receipt">驳回原因：{proposal.rejectionReason}</div>
                  )}
                </div>

                <div
                  className="evo-card-actions"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isActionLocked}
                    onClick={() => openReviewDrawer(proposal)}
                  >
                    {APP_COPY.actions.reviewProposal}
                  </button>
                  {isOpen && (
                    <button
                      type="button"
                      className="danger-outline-button"
                      disabled={isActionLocked}
                      onClick={() => {
                        openReviewDrawer(proposal);
                        setRejectingId(proposal.id);
                      }}
                    >
                      {APP_COPY.actions.rejectShort}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeProposal && (
        <div
          className="drawer-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeReviewDrawer();
          }}
        >
          <aside className="drawer evo-drawer" role="dialog" aria-modal="true" aria-label="提案审阅抽屉">
            <header className="drawer-header">
              <div className="evo-drawer-head-info">
                <div className="evo-card-badges">
                  <span className={`badge ${STATUS_META[activeProposal.status].badgeClass}`}>
                    {STATUS_META[activeProposal.status].label}
                  </span>
                  <span className={`badge ${CHANNEL_META[activeProposal.channel].badgeClass}`}>
                    {CHANNEL_META[activeProposal.channel].label}
                  </span>
                  <span className="badge badge--neutral">{OPERATION_LABEL[activeProposal.operation]}</span>
                </div>
                <h2>{activeProposal.title}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={closeReviewDrawer}
                disabled={busy}
                aria-label="关闭审阅抽屉"
              >
                <X size={18} />
              </button>
            </header>

            <div className="drawer-body">
              {(activeProposal.status === "conflict" || activeProposal.status === "stale") && (
                <div className="issue-box" style={{ marginTop: 0 }}>
                  <WarningCircle size={16} style={{ flex: "none", marginTop: 1 }} />
                  <div>
                    {activeProposal.status === "stale" ? (
                      <p>提案挂起已超过 30 天，请先点击下方「重新检测」核验最新基线指纹。</p>
                    ) : (
                      (activeProposal.conflictMessages ?? ["目标文件存在冲突，请重新检测。"]).map((msg) => (
                        <p key={msg}>{msg}</p>
                      ))
                    )}
                  </div>
                </div>
              )}

              <section className="drawer-section">
                <span className="form-label-row">目标资产</span>
                <div className="target-config-strip">
                  <strong>{activeProposal.targetPath}</strong>
                </div>
              </section>

              <section className="drawer-section">
                <span className="form-label-row">证据来源（{activeProposal.evidence.length}）</span>
                <div className="evo-evidence-list">
                  {activeProposal.evidence.map((ev, index) => (
                    <div key={`${ev.sourceLabel}-${index}`} className="evo-evidence-card">
                      <div className="evo-evidence-head">
                        <strong>{ev.sourceLabel}</strong>
                        {ev.verifiedAt && <span>{ev.verifiedAt}</span>}
                      </div>
                      <p className="evo-evidence-summary">{ev.summary}</p>
                      {ev.projectNames && ev.projectNames.length > 0 && (
                        <div className="evo-card-badges">
                          {ev.projectNames.map((name) => (
                            <span key={name} className="badge badge--neutral">
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                      {ev.url && <div className="evo-evidence-url">{ev.url}</div>}
                    </div>
                  ))}
                </div>
              </section>

              {(activeProposal.status === "pending" ||
                activeProposal.status === "conflict" ||
                activeProposal.status === "stale") && (
                <>
                  <section className="drawer-section">
                    <span className="form-label-row">目标可写规则源</span>
                    <Dropdown<string>
                      label="选择目标规则源"
                      value={selectedTargetSource?.id}
                      onChange={setSelectedSourceId}
                      className="project-dropdown"
                      options={targetSources.map((src) => ({
                        value: src.id,
                        label: src.name,
                        description: src.readonly ? "内置只读源 · 仅可导出补丁" : src.root,
                      }))}
                    />
                    {selectedTargetSource?.readonly && (
                      <div className="evo-readonly-hint">
                        当前所选来源为只读，无法直接写入；可切换可写本地源或点击「导出补丁」。
                      </div>
                    )}
                  </section>

                  <section className="drawer-section">
                    <label className="form-field">
                      <span className="form-label-row">锚点章节标题</span>
                      <input
                        type="text"
                        className="form-input"
                        value={draftAnchor}
                        onChange={(event) => setDraftAnchor(event.target.value)}
                      />
                    </label>
                    {activeProposal.operation !== "add-item" && (
                      <label className="form-field">
                        <span className="form-label-row">变更前片段（精确匹配）</span>
                        <textarea
                          className="evo-code-textarea"
                          rows={3}
                          value={draftBefore}
                          onChange={(event) => setDraftBefore(event.target.value)}
                        />
                      </label>
                    )}
                    <label className="form-field">
                      <span className="form-label-row">
                        {activeProposal.operation === "deprecate-item" ? "替代/废弃标注（留空则移除该条目）" : "变更后增量条款"}
                      </span>
                      <textarea
                        className="evo-code-textarea"
                        rows={4}
                        value={draftAfter}
                        onChange={(event) => setDraftAfter(event.target.value)}
                      />
                    </label>
                  </section>

                  {rejectingId === activeProposal.id && (
                    <section className="evo-reject-box">
                      <label className="form-field">
                        <span className="form-label-row">驳回原因（可选）</span>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="例如：属于项目特例，不升格至共享规范"
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                        />
                      </label>
                      <div className="evo-reject-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setRejectingId(undefined);
                            setRejectReason("");
                          }}
                        >
                          {APP_COPY.actions.cancel}
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={busy}
                          onClick={() => handleReject(activeProposal.id, rejectReason)}
                        >
                          {APP_COPY.actions.rejectProposal}
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}

              {activeProposal.appliedReceipt && (
                <section className="drawer-section">
                  <span className="form-label-row">写入审计回执</span>
                  <div className="security-notice">
                    <ShieldCheck size={16} />
                    <span>
                      已于 {formatDate(activeProposal.appliedReceipt.appliedAt)} 原子写入 {activeProposal.appliedReceipt.sourceName} 并通过门禁校验
                    </span>
                  </div>
                </section>
              )}
            </div>

            <footer className="drawer-footer evo-drawer-footer">
              <div className="evo-drawer-footer-left">
                {(activeProposal.status === "pending" ||
                  activeProposal.status === "conflict" ||
                  activeProposal.status === "stale") && (
                  <button
                    type="button"
                    className="danger-outline-button"
                    disabled={busy}
                    onClick={() => setRejectingId(activeProposal.id)}
                  >
                    {APP_COPY.actions.rejectProposal}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !api}
                  onClick={() => handleExportPatch(activeProposal)}
                >
                  <DownloadSimple size={14} aria-hidden="true" />
                  {APP_COPY.actions.exportPatch}
                </button>
              </div>
              <div className="evo-drawer-footer-right">
                {(activeProposal.status === "conflict" || activeProposal.status === "stale") && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !selectedTargetSource}
                    onClick={() => handleRecheck(activeProposal)}
                  >
                    <ArrowClockwise size={14} aria-hidden="true" />
                    {APP_COPY.actions.recheckProposal}
                  </button>
                )}
                {(activeProposal.status === "pending" ||
                  activeProposal.status === "conflict" ||
                  activeProposal.status === "stale") && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !selectedTargetSource}
                    onClick={() => handlePreview(activeProposal)}
                  >
                    {APP_COPY.actions.previewDelta}
                  </button>
                )}
              </div>
            </footer>
          </aside>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="进化变更预览">
            <header className="modal-header">
              <h2>进化变更预览</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => !busy && setPreview(undefined)}
                disabled={busy}
                aria-label="关闭变更预览"
              >
                <X size={18} />
              </button>
            </header>

            <div className="modal-body">
              <div className="preview-meta">
                <strong>{preview.targetFilePath}</strong>
                <span>
                  {preview.targetSource.name} · {OPERATION_LABEL[preview.operation]} · {preview.anchorHeading} ·{" "}
                  {preview.lineCountBefore} → {preview.lineCountAfter} 行（预算 ≤ {preview.lineBudget} 行）
                </span>
              </div>

              {(preview.overBudget || preview.similarItems.length > 0) && (
                <div className="evo-budget-warn">
                  <WarningCircle size={15} style={{ flex: "none", marginTop: 1 }} />
                  <div>
                    {preview.overBudget && (
                      <p>
                        写入后文档共 {preview.lineCountAfter} 行，超过建议精简预算（{preview.lineBudget} 行），建议优先合并或修订旧条目。
                      </p>
                    )}
                    {preview.similarItems.map((sim) => (
                      <p key={`${sim.lineNumber}-${sim.text}`}>
                        相似条款提醒（L{sim.lineNumber} · {Math.round(sim.similarity * 100)}%）：{sim.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {preview.conflicts.length > 0 && (
                <div className="issue-box" role="alert">
                  <WarningCircle size={18} style={{ flex: "none", marginTop: 1 }} />
                  <div>
                    {preview.conflicts.map((conflict) => (
                      <p key={conflict}>{conflict}</p>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const focused = buildFocusedDiff(preview.beforeContent, preview.afterContent, 3);
                const leftText = showFullDiff
                  ? preview.beforeContent || "（无可读取原内容）"
                  : focused.beforeExcerpt || "（无可读取原内容）";
                const rightText = showFullDiff
                  ? preview.afterContent || "（未生成可写内容）"
                  : focused.afterExcerpt || "（未生成可写内容）";
                return (
                  <div className="preview-section">
                    <div className="evo-diff-head">
                      <h3>
                        原子增量对比 · {preview.targetPath}
                        {focused.hasChange && !showFullDiff ? `（定位至 L${focused.startLine}）` : ""}
                      </h3>
                      {focused.hasChange && (
                        <button
                          type="button"
                          className="ghost-button evo-diff-toggle"
                          onClick={() => setShowFullDiff((prev) => !prev)}
                        >
                          {showFullDiff ? "聚焦增量" : "查看全文"}
                        </button>
                      )}
                    </div>
                    <div className="content-comparison">
                      <div>
                        <span>变更前</span>
                        <pre>{leftText}</pre>
                      </div>
                      <div>
                        <span>变更后</span>
                        <pre>{rightText}</pre>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="preview-section">
                <h3>写入后自动门禁</h3>
                <ul className="retained-list">
                  {preview.validationChecks.map((check) => (
                    <li key={check}>
                      <Check size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                      {check}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                {APP_COPY.actions.cancel}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || preview.conflicts.length > 0}
                onClick={handleApplyPreview}
              >
                {busy ? APP_COPY.actions.processing : APP_COPY.actions.confirmWrite}
              </button>
            </footer>
          </section>
        </div>
      )}

      {showWatchModal && (
        <div className="modal-backdrop">
          <section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="管理官方文档巡检源">
            <header className="modal-header">
              <h2>管理官方文档巡检源</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => !busy && setShowWatchModal(false)}
                disabled={busy}
                aria-label="关闭巡检源配置"
              >
                <X size={18} />
              </button>
            </header>

            <div className="modal-body">
              <div className="evo-watch-list">
                {draftWatchSources.map((src, index) => (
                  <div key={src.id} className="evo-watch-row">
                    <button
                      type="button"
                      className={`check-box${src.enabled ? " checked" : ""}`}
                      aria-label={`启停 ${src.name}`}
                      onClick={() =>
                        setDraftWatchSources((current) =>
                          current.map((item, idx) =>
                            idx === index ? { ...item, enabled: !item.enabled } : item,
                          ),
                        )
                      }
                    >
                      {src.enabled && <Check size={11} weight="bold" />}
                    </button>
                    <div className="evo-watch-row-main">
                      <div className="evo-card-badges">
                        <strong>{src.name}</strong>
                        <span className="badge badge--neutral">{src.targetRulepack}</span>
                        {src.lastStatus === "ok" && <span className="badge badge--success">正常</span>}
                        {src.lastStatus === "error" && <span className="badge badge--danger">上次失败</span>}
                      </div>
                      <span className="evo-watch-url">{src.url}</span>
                      <span className="evo-watch-target">{src.targetPath}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`删除 ${src.name}`}
                      onClick={() =>
                        setDraftWatchSources((current) => current.filter((_, idx) => idx !== index))
                      }
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="evo-watch-add">
                <h3>新增巡检源</h3>
                <div className="evo-watch-grid">
                  <label className="form-field">
                    <span className="form-label-row">名称</span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="例如：Unity OpenXR 文档"
                      value={newWatchName}
                      onChange={(event) => setNewWatchName(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span className="form-label-row">关联规则包</span>
                    <Dropdown<string>
                      label="选择关联规则包"
                      value={newWatchPack}
                      onChange={setNewWatchPack}
                      className="project-dropdown"
                      options={RULEPACK_CATALOG.map((pack) => ({
                        value: pack.id,
                        label: pack.name,
                        description: pack.id,
                      }))}
                    />
                  </label>
                  <label className="form-field evo-watch-span2">
                    <span className="form-label-row">官方文档 HTTPS URL</span>
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://..."
                      value={newWatchUrl}
                      onChange={(event) => setNewWatchUrl(event.target.value)}
                    />
                  </label>
                  <label className="form-field evo-watch-span2">
                    <span className="form-label-row">目标规则文件相对路径</span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="rulepacks/..."
                      value={newWatchPath}
                      onChange={(event) => setNewWatchPath(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span className="form-label-row">锚点章节（可选）</span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="## 章节标题"
                      value={newWatchAnchor}
                      onChange={(event) => setNewWatchAnchor(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    <span className="form-label-row">关键词（空格或逗号分隔）</span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="OpenXR, SDK, 60pt"
                      value={newWatchKeywords}
                      onChange={(event) => setNewWatchKeywords(event.target.value)}
                    />
                  </label>
                </div>
                {watchFormError && <p className="inline-issue">{watchFormError}</p>}
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="secondary-button" onClick={handleAddWatchSource}>
                    <Plus size={14} aria-hidden="true" />
                    {APP_COPY.actions.addWatchSource}
                  </button>
                </div>
              </div>
            </div>

            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setShowWatchModal(false)}
              >
                {APP_COPY.actions.cancel}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={handleSaveWatchSources}
              >
                {busy ? APP_COPY.actions.processing : APP_COPY.actions.saveConfig}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
