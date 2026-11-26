import {
  EvolutionStore,
  scanOverridesForPromotions,
  validateEvolutionTargetFile,
  watchOfficialDocs,
  type DocsWatchSourceResult,
  type EvolutionAppliedReceipt,
  type EvolutionListResult,
  type EvolutionPatchEdit,
  type EvolutionPreview,
  type EvolutionProposal,
  type EvolutionTargetSource,
  type WatchSourceConfig,
} from "../../core/src/index.ts";
import type { ProjectRegistry } from "./project-registry.ts";
import type { SourceManager } from "./source-manager.ts";

export interface EvolutionWatchProgress {
  completed: number;
  total: number;
  currentSourceName: string;
}

export interface EvolutionScanSummary {
  scannedCount: number;
  skippedProjects: { root: string; reason: string }[];
  createdCount: number;
  foldedCount: number;
  list: EvolutionListResult;
}

export interface EvolutionWatchSummary {
  checkedCount: number;
  succeededCount: number;
  failedCount: number;
  cancelled: boolean;
  createdCount: number;
  foldedCount: number;
  results: DocsWatchSourceResult[];
  watchSources: WatchSourceConfig[];
  list: EvolutionListResult;
}

export interface EvolutionOperationsDeps {
  registry: Pick<ProjectRegistry, "list">;
  sourceManager: Pick<SourceManager, "list">;
  defaultWorkspaceRoot?: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  onWatchProgress?: (progress: EvolutionWatchProgress) => void;
}

export class EvolutionOperations {
  private readonly store: EvolutionStore;
  private runningMutation = false;
  private activeWatchController: AbortController | undefined;

  constructor(
    stateRoot: string,
    private readonly deps: EvolutionOperationsDeps,
  ) {
    this.store = new EvolutionStore(stateRoot);
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.runningMutation) {
      throw new Error("规则进化文件操作正在进行，请稍候");
    }
    this.runningMutation = true;
    try {
      return await action();
    } finally {
      this.runningMutation = false;
    }
  }

  private async resolvePreferredWritableRoot(explicitRoot?: string): Promise<string | undefined> {
    if (explicitRoot) return explicitRoot;
    try {
      const sources = await this.deps.sourceManager.list();
      for (const source of sources) {
        if (source.readonly) continue;
        if (source.access === "local" && source.location) return source.location;
        if (source.access === "git" && source.localCheckoutPath) return source.localCheckoutPath;
      }
    } catch {
      // 忽略来源读取异常，继续尝试默认开发工作区
    }
    return this.deps.defaultWorkspaceRoot ? this.deps.defaultWorkspaceRoot() : undefined;
  }

  async list(): Promise<EvolutionListResult> {
    return this.store.list();
  }

  async getWatchSources(): Promise<WatchSourceConfig[]> {
    return this.store.getWatchSources();
  }

  async saveWatchSources(sources: WatchSourceConfig[]): Promise<WatchSourceConfig[]> {
    return this.serialized(() => this.store.saveWatchSources(sources));
  }

  /** 通道 2：只读扫描「我的项目」全部已登记项目的 .agent-rules/overrides.md 并聚类升格。 */
  async scanOverrides(workspaceRoot?: string): Promise<EvolutionScanSummary> {
    return this.serialized(async () => {
      const projects = await this.deps.registry.list();
      if (projects.length === 0) {
        return {
          scannedCount: 0,
          skippedProjects: [],
          createdCount: 0,
          foldedCount: 0,
          list: await this.store.list(),
        };
      }
      const targetSourceRoot = await this.resolvePreferredWritableRoot(workspaceRoot);
      const scan = await scanOverridesForPromotions(
        projects.map((item) => item.root),
        { targetSourceRoot },
      );
      let createdCount = 0;
      let foldedCount = 0;
      for (const candidate of scan.candidates) {
        const res = await this.store.capture(candidate, { targetSourceRoot });
        if (res.outcome === "created") createdCount++;
        else foldedCount++;
      }
      return {
        scannedCount: scan.scannedCount,
        skippedProjects: scan.skippedProjects,
        createdCount,
        foldedCount,
        list: await this.store.list(),
      };
    });
  }

  /** 通道 3：巡检官方文档（支持按源重试、实时进度回调与中途取消）。 */
  async watchDocs(options: { sourceIds?: string[]; workspaceRoot?: string } = {}): Promise<EvolutionWatchSummary> {
    if (this.activeWatchController) {
      throw new Error("官方文档巡检正在进行中，请等待完成或先取消");
    }
    const controller = new AbortController();
    this.activeWatchController = controller;
    try {
      const allSources = await this.store.getWatchSources();
      const targetIds = options.sourceIds ? new Set(options.sourceIds) : undefined;
      const runSources = targetIds
        ? allSources
            .filter((item) => targetIds.has(item.id))
            .map((item) => ({ ...item, enabled: true }))
        : allSources;
      const targetSourceRoot = await this.resolvePreferredWritableRoot(options.workspaceRoot);

      const watchResult = await watchOfficialDocs(runSources, targetSourceRoot, {
        fetcher: this.deps.fetcher,
        signal: controller.signal,
        onProgress: this.deps.onWatchProgress,
      });

      let createdCount = 0;
      let foldedCount = 0;
      for (const candidate of watchResult.candidates) {
        const res = await this.store.capture(candidate, { targetSourceRoot });
        if (res.outcome === "created") createdCount++;
        else foldedCount++;
      }

      const nowIso = new Date().toISOString();
      const resultMap = new Map(watchResult.results.map((item) => [item.sourceId, item]));
      const updatedSources = allSources.map((source) => {
        const outcome = resultMap.get(source.id);
        if (!outcome || outcome.status === "cancelled") return source;
        return {
          ...source,
          lastCheckedAt: nowIso,
          lastStatus: outcome.status,
          lastMessage: outcome.message,
        };
      });
      await this.store.saveWatchSources(updatedSources);

      return {
        checkedCount: watchResult.checkedCount,
        succeededCount: watchResult.succeededCount,
        failedCount: watchResult.failedCount,
        cancelled: watchResult.cancelled,
        createdCount,
        foldedCount,
        results: watchResult.results,
        watchSources: updatedSources,
        list: await this.store.list(),
      };
    } finally {
      if (this.activeWatchController === controller) {
        this.activeWatchController = undefined;
      }
    }
  }

  cancelWatch(): { cancelled: boolean } {
    if (!this.activeWatchController) return { cancelled: false };
    this.activeWatchController.abort(new Error("用户取消巡检"));
    return { cancelled: true };
  }

  async importProposalFile(
    filePath: string,
    workspaceRoot?: string,
  ): Promise<{ outcome: "created" | "duplicate" | "previously-rejected"; proposal?: EvolutionProposal; list: EvolutionListResult }> {
    return this.serialized(async () => {
      const targetSourceRoot = await this.resolvePreferredWritableRoot(workspaceRoot);
      const result = await this.store.importProposalFile(filePath, { targetSourceRoot });
      return {
        outcome: result.outcome,
        proposal: result.proposal,
        list: await this.store.list(),
      };
    });
  }

  async recheck(
    proposalId: string,
    targetSource: EvolutionTargetSource,
  ): Promise<{ proposal: EvolutionProposal; conflicts: string[]; list: EvolutionListResult }> {
    return this.serialized(async () => {
      const result = await this.store.recheck(proposalId, targetSource);
      return {
        proposal: result.proposal,
        conflicts: result.conflicts,
        list: await this.store.list(),
      };
    });
  }

  async preview(
    proposalId: string,
    targetSource: EvolutionTargetSource,
    editedPatch?: EvolutionPatchEdit,
  ): Promise<EvolutionPreview> {
    return this.store.preview(proposalId, targetSource, editedPatch);
  }

  async apply(
    token: string,
  ): Promise<{ proposal: EvolutionProposal; receipt: EvolutionAppliedReceipt; list: EvolutionListResult }> {
    return this.serialized(async () => {
      const applied = await this.store.apply(token, validateEvolutionTargetFile);
      return {
        proposal: applied.proposal,
        receipt: applied.receipt,
        list: await this.store.list(),
      };
    });
  }

  async reject(
    proposalId: string,
    reason?: string,
  ): Promise<{ proposal: EvolutionProposal; list: EvolutionListResult }> {
    return this.serialized(async () => {
      const proposal = await this.store.reject(proposalId, reason);
      return {
        proposal,
        list: await this.store.list(),
      };
    });
  }

  async exportPatch(
    proposalId: string,
    destinationPath: string,
    targetSourceRoot?: string,
  ): Promise<{ path: string; sha256: string }> {
    return this.serialized(() => this.store.exportPatch(proposalId, destinationPath, targetSourceRoot));
  }
}
