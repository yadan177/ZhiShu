import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";

import { AGENTS_MD_TARGETS, codexAdapter } from "../../../adapters/codex/src/index.ts";
import {
  applyForceUninstall,
  applyProject,
  applyUninstall,
  assertReleaseAssetUnchanged,
  assertReleaseNotOlder,
  detectProject,
  downloadRulepacks,
  findLatestRelease,
  initializeGithubProject,
  initializeProject,
  listAvailableRulePacks,
  listInterruptedTransactions,
  listRetainedRulePaths,
  loadProjectConfig,
  loadProjectLock,
  planForceUninstall,
  planProject,
  planUninstall,
  recommendRulepacksForDetection,
  recoverInterruptedProject,
  validateProject,
} from "../../../packages/core/src/index.ts";
import type {
  DetectionResult,
  ProjectChange,
  ProjectConfig,
  ProjectPlan,
  ReleaseInfo,
  RulePackManifest,
  SourceSnapshot,
  UninstallPlan,
  ValidationIssue,
} from "../../../packages/core/src/index.ts";

export const REPOSITORY = "yadan177/ZhiShu";
export const STACK_PACKS = {
  unity: ["common", "unity", "project-docs/unity"],
  "js-ts": ["common", "javascript", "typescript", "project-docs/js-ts"],
  java: ["common", "java", "project-docs/java"],
  go: ["common", "go", "project-docs/go"],
  python: ["common", "python", "project-docs/python"],
} as const;
export type StackChoice = keyof typeof STACK_PACKS;
export type PlatformChoice = (typeof AGENTS_MD_TARGETS)[number];

export type RuleSourceChoice =
  | { type: "github"; repository?: string }
  | { type: "workspace"; path: string };

export interface InstallRequest {
  rulepacks: string[];
  targets: PlatformChoice[];
  source?: RuleSourceChoice;
}

export interface WorkspaceSourceInfo {
  root: string;
  packs: RulePackManifest[];
}

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9/-]*$/;

type LoadedSource = { snapshot: SourceSnapshot; cleanup: () => Promise<void> };
type SourceLoader = (release?: ReleaseInfo) => Promise<LoadedSource>;
type ReleaseLoader = (repository: string) => Promise<ReleaseInfo>;

export async function loadLatestSource(release?: ReleaseInfo, fetcher: typeof fetch = fetch): Promise<LoadedSource> {
  release ??= await findLatestRelease(REPOSITORY, fetcher);
  const downloaded = await downloadRulepacks(release, fetcher);
  return {
    snapshot: {
      root: downloaded.sourceRoot,
      version: downloaded.version,
      digest: release.digest,
      commit: downloaded.sourceCommit,
    },
    cleanup: downloaded.cleanup,
  };
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function checkedRoot(root: string): Promise<string> {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("请选择项目文件夹");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("项目路径必须是普通文件夹");
  return realpath(root);
}

function checkedTargets(targets: PlatformChoice[]): PlatformChoice[] {
  if (!Array.isArray(targets) || targets.length === 0 || new Set(targets).size !== targets.length ||
    targets.some((target) => !AGENTS_MD_TARGETS.includes(target))) {
    throw new Error("请选择至少一个受支持的平台");
  }
  return AGENTS_MD_TARGETS.filter((target) => targets.includes(target));
}

function checkedRulepacks(rulepacks: string[]): string[] {
  if (!Array.isArray(rulepacks) || rulepacks.length === 0 ||
    new Set(rulepacks).size !== rulepacks.length ||
    rulepacks.some((id) => typeof id !== "string" || !PACK_ID_PATTERN.test(id) || id.includes("//") || id.endsWith("/"))) {
    throw new Error("请选择至少一个有效的规则包");
  }
  return [...rulepacks];
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function githubConfigFor(rulepacks: string[], targets: PlatformChoice[], repository = REPOSITORY): ProjectConfig {
  return {
    schemaVersion: 1,
    source: { type: "github", repository },
    rulepacks: checkedRulepacks(rulepacks),
    targets: checkedTargets(targets),
    project: { overrides: ".agent-rules/overrides.md" },
    updates: { channel: "stable", strategy: "manual" },
  };
}

function workspaceConfigFor(projectRoot: string, workspaceRoot: string, rulepacks: string[], targets: PlatformChoice[]): ProjectConfig {
  const relativeSource = path.relative(path.resolve(projectRoot), path.resolve(workspaceRoot)) || ".";
  return {
    schemaVersion: 1,
    source: { type: "workspace", path: toPortablePath(relativeSource) },
    rulepacks: checkedRulepacks(rulepacks),
    targets: checkedTargets(targets),
    project: { overrides: ".agent-rules/overrides.md" },
    updates: { channel: "stable", strategy: "manual" },
  };
}

export async function inspectWorkspaceSource(sourceRoot: string): Promise<WorkspaceSourceInfo> {
  const resolved = await checkedRoot(sourceRoot);
  const packs = await listAvailableRulePacks(resolved);
  if (packs.length === 0) throw new Error("所选目录中未发现可用的规则包");
  return { root: resolved, packs };
}

export interface ProjectStatus {
  root: string;
  installed: boolean;
  valid: boolean;
  rulepacks: string[];
  targets: string[];
  version?: string;
  sourceType?: "github" | "workspace";
  sourceLabel?: string;
  overridesPath?: string;
  overridesExists?: boolean;
  interruptedTransactions: string[];
  detection: DetectionResult;
  recommendedRulepacks: string[];
  issues: ValidationIssue[];
}

export async function inspectProjectRoot(root: string): Promise<ProjectStatus> {
  const resolved = await checkedRoot(root);
  const [detection, interruptedTransactions] = await Promise.all([
    detectProject(resolved),
    listInterruptedTransactions(resolved),
  ]);
  const recommendedRulepacks = recommendRulepacksForDetection(detection);
  if (!(await isPresent(path.join(resolved, "agent-rules.yaml")))) {
    const defaultOverrides = ".agent-rules/overrides.md";
    const orphanLock = await isPresent(path.join(resolved, ".agent-rules.lock.json"));
    const orphanIssues: ValidationIssue[] = orphanLock
      ? [{ code: "orphan-lock", message: "检测到孤立的规则锁文件 .agent-rules.lock.json（缺少 agent-rules.yaml），请先强制清理后再安装" }]
      : [];
    return {
      root: resolved,
      installed: false,
      valid: false,
      rulepacks: [],
      targets: [],
      overridesPath: defaultOverrides,
      overridesExists: await isPresent(path.join(resolved, defaultOverrides)),
      interruptedTransactions,
      detection,
      recommendedRulepacks,
      issues: orphanIssues,
    };
  }
  const validation = await validateProject(resolved, codexAdapter);
  let rulepacks: string[] = [];
  let targets: string[] = [];
  let version: string | undefined;
  let sourceType: "github" | "workspace" | undefined;
  let sourceLabel: string | undefined;
  let overridesPath = ".agent-rules/overrides.md";
  const hasConfigSymlinkOrError = validation.issues.some(
    (issue) => issue.code === "invalid-config" || (issue.code === "symlink-path" && issue.message.includes("agent-rules.yaml")),
  );
  if (!hasConfigSymlinkOrError) {
    try {
      const configStat = await lstat(path.join(resolved, "agent-rules.yaml"));
      if (configStat.isFile() && !configStat.isSymbolicLink()) {
        const config = await loadProjectConfig(resolved);
        rulepacks = config.rulepacks;
        targets = config.targets;
        sourceType = config.source.type;
        sourceLabel = config.source.type === "github" ? config.source.repository : config.source.path;
        overridesPath = config.project.overrides;
      }
    } catch (error) {
      validation.issues.push({ code: "invalid-config", message: String(error) });
    }
  }
  const hasLockSymlinkOrError = validation.issues.some(
    (issue) => issue.code === "invalid-lock" || (issue.code === "symlink-path" && issue.message.includes(".agent-rules.lock.json")),
  );
  if (!hasLockSymlinkOrError) {
    try {
      const lockStat = await lstat(path.join(resolved, ".agent-rules.lock.json"));
      if (lockStat.isFile() && !lockStat.isSymbolicLink()) {
        const lock = await loadProjectLock(resolved);
        version = lock.sourceVersion ?? lock.rulepacks.common ?? Object.values(lock.rulepacks)[0];
      }
    } catch {
      // 锁文件损坏的详细错误已由上方的 validateProject 收集上报。
    }
  }
  const overridesExists = await isPresent(path.join(resolved, overridesPath));
  return {
    root: resolved,
    installed: true,
    valid: validation.valid && !validation.issues.length,
    rulepacks,
    targets,
    version,
    sourceType,
    sourceLabel,
    overridesPath,
    overridesExists,
    interruptedTransactions,
    detection,
    recommendedRulepacks,
    issues: validation.issues,
  };
}

export interface UpdateCheck {
  root: string;
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  targetsChanged: boolean;
  rulepacksChanged?: boolean;
}

export interface Preview {
  kind: "install" | "update" | "uninstall" | "repair" | "force-uninstall";
  root: string;
  changes: ProjectChange[];
  retainedPaths: string[];
  conflicts: ValidationIssue[];
  version?: string;
  targets: string[];
  rulepacks?: string[];
  sourceType?: "github" | "workspace";
}

type CheckedUpdate =
  | { kind: "github"; root: string; repository: string; release: ReleaseInfo; targets: PlatformChoice[]; rulepacks: string[] }
  | { kind: "workspace"; root: string; workspacePath: string; targets: PlatformChoice[]; rulepacks: string[] };

type Pending =
  | { kind: "install"; sourceType: "github"; root: string; repository: string; rulepacks: string[]; targets: PlatformChoice[]; plan: ProjectPlan; source: LoadedSource }
  | { kind: "install"; sourceType: "workspace"; root: string; workspaceRoot: string; rulepacks: string[]; targets: PlatformChoice[]; plan: ProjectPlan }
  | { kind: "update"; sourceType: "github"; root: string; repository: string; plan: ProjectPlan; config: ProjectConfig; configContent: string; nextConfigContent?: string; source: LoadedSource; release: ReleaseInfo }
  | { kind: "update"; sourceType: "workspace"; root: string; workspacePath: string; plan: ProjectPlan; config: ProjectConfig; configContent: string; nextConfigContent?: string }
  | { kind: "repair"; sourceType: "github"; root: string; repository: string; plan: ProjectPlan; config: ProjectConfig; nextConfigContent: string; source: LoadedSource; release: ReleaseInfo }
  | { kind: "repair"; sourceType: "workspace"; root: string; workspacePath: string; plan: ProjectPlan; config: ProjectConfig; nextConfigContent: string }
  | { kind: "uninstall"; root: string; plan: UninstallPlan }
  | { kind: "force-uninstall"; root: string; plan: UninstallPlan };

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

export class DesktopOperations {
  private pending: Pending | undefined;
  private checked: CheckedUpdate | undefined;
  private busy = false;

  constructor(private readonly sourceLoader: SourceLoader = loadLatestSource, private readonly releaseLoader: ReleaseLoader = findLatestRelease) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("已有操作正在进行，请稍候");
    this.busy = true;
    try { return await operation(); }
    finally { this.busy = false; }
  }

  private async discardPending(): Promise<void> {
    const current = this.pending;
    this.pending = undefined;
    if (
      current &&
      (current.kind === "install" || current.kind === "update" || current.kind === "repair") &&
      current.sourceType === "github"
    ) {
      await current.source.cleanup().catch(() => {});
    }
  }

  async clearPreview(): Promise<void> {
    if (!this.pending) return;
    if (this.busy) {
      await this.discardPending();
      return;
    }
    return this.exclusive(() => this.discardPending());
  }

  async inspect(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      await this.discardPending();
      this.checked = undefined;
      return inspectProjectRoot(root);
    });
  }

  async recover(root: string): Promise<{ status: ProjectStatus; recoveredPath?: string }> {
    return this.exclusive(async () => {
      await this.discardPending();
      this.checked = undefined;
      const resolved = await checkedRoot(root);
      const recoveredPath = await recoverInterruptedProject(resolved, codexAdapter);
      return { status: await inspectProjectRoot(resolved), recoveredPath };
    });
  }

  async previewInstall(
    root: string,
    stackOrRequest: StackChoice | InstallRequest,
    targets: PlatformChoice[] = ["codex"],
  ): Promise<Preview> {
    return this.exclusive(async () => {
      await this.discardPending();
      const resolved = await checkedRoot(root);
      if (await isPresent(path.join(resolved, "agent-rules.yaml"))) throw new Error("项目已经安装规则；请先卸载或使用更新模式");
      if (await isPresent(path.join(resolved, ".agent-rules.lock.json"))) throw new Error("项目存在孤立的规则锁文件；请先检查或恢复原配置，不会覆盖它");

      let requestedRulepacks: string[];
      let requestedTargets: PlatformChoice[];
      let requestedSource: RuleSourceChoice;
      if (typeof stackOrRequest === "string") {
        if (!Object.hasOwn(STACK_PACKS, stackOrRequest)) throw new Error("技术栈选项无效");
        requestedRulepacks = [...STACK_PACKS[stackOrRequest]];
        requestedTargets = checkedTargets(targets);
        requestedSource = { type: "github", repository: REPOSITORY };
      } else {
        requestedRulepacks = checkedRulepacks(stackOrRequest.rulepacks);
        requestedTargets = checkedTargets(stackOrRequest.targets);
        requestedSource = stackOrRequest.source ?? { type: "github", repository: REPOSITORY };
      }

      if (requestedSource.type === "workspace") {
        const workspaceInfo = await inspectWorkspaceSource(requestedSource.path);
        const config = workspaceConfigFor(resolved, workspaceInfo.root, requestedRulepacks, requestedTargets);
        const plan = await planProject(resolved, config, codexAdapter);
        const changes: ProjectChange[] = [
          { path: "agent-rules.yaml", action: "add", after: stringify(config) },
          ...plan.changes,
        ];
        if (!plan.conflicts.length) {
          this.pending = {
            kind: "install",
            sourceType: "workspace",
            root: resolved,
            workspaceRoot: workspaceInfo.root,
            rulepacks: requestedRulepacks,
            targets: requestedTargets,
            plan,
          };
        }
        return {
          kind: "install",
          root: resolved,
          changes,
          retainedPaths: [],
          conflicts: plan.conflicts,
          version: "本地源",
          targets: config.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "workspace",
        };
      }

      const repository = requestedSource.repository ?? REPOSITORY;
      const config = githubConfigFor(requestedRulepacks, requestedTargets, repository);
      const release = repository !== REPOSITORY ? await this.releaseLoader(repository) : undefined;
      const source = await this.sourceLoader(release);
      try {
        const plan = await planProject(resolved, config, codexAdapter, source.snapshot);
        const changes: ProjectChange[] = [
          { path: "agent-rules.yaml", action: "add", after: stringify(config) },
          ...plan.changes,
        ];
        if (plan.conflicts.length) {
          await source.cleanup();
        } else {
          this.pending = {
            kind: "install",
            sourceType: "github",
            root: resolved,
            repository,
            rulepacks: requestedRulepacks,
            targets: requestedTargets,
            plan,
            source,
          };
        }
        return {
          kind: "install",
          root: resolved,
          changes,
          retainedPaths: [],
          conflicts: plan.conflicts,
          version: source.snapshot.version,
          targets: config.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "github",
        };
      } catch (error) {
        await source.cleanup();
        throw error;
      }
    });
  }

  async applyInstall(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      const resolved = await checkedRoot(root);
      const pending = this.pending;
      if (!pending || pending.kind !== "install" || pending.root !== resolved) throw new Error("安装预览已失效，请重新预览");
      this.pending = undefined;
      if (pending.sourceType === "workspace") {
        await initializeProject(resolved, codexAdapter, pending.workspaceRoot, pending.targets, pending.rulepacks, pending.plan);
        return inspectProjectRoot(resolved);
      }
      try {
        await initializeGithubProject(resolved, codexAdapter, pending.source.snapshot, pending.repository, pending.rulepacks, pending.plan, pending.targets);
        return inspectProjectRoot(resolved);
      } finally {
        await pending.source.cleanup();
      }
    });
  }

  private async updateProject(root: string): Promise<{ config: ProjectConfig; currentVersion: string }> {
    if (!(await isPresent(path.join(root, "agent-rules.yaml")))) throw new Error("该项目尚未安装规则");
    const validation = await validateProject(root, codexAdapter);
    if (!validation.valid) throw new Error(`项目规则校验未通过：${validation.issues.map((issue) => issue.message).join("；")}`);
    const config = await loadProjectConfig(root);
    if (config.updates.channel !== "stable") {
      throw new Error("桌面版更新目前仅支持 stable 通道规则源");
    }
    const lock = await loadProjectLock(root);
    if (config.source.type === "github") {
      if (!config.source.repository) throw new Error("项目配置缺少 GitHub 规则源仓库");
      if (!lock.sourceVersion) throw new Error("项目锁文件缺少当前规则版本");
      return { config, currentVersion: lock.sourceVersion };
    }
    if (!config.source.path) throw new Error("项目配置缺少本地规则源路径");
    return { config, currentVersion: lock.rulepacks.common ?? Object.values(lock.rulepacks)[0] ?? "本地源" };
  }

  async checkUpdate(root: string, targets?: PlatformChoice[], rulepacks?: string[]): Promise<UpdateCheck> {
    return this.exclusive(async () => {
      await this.discardPending();
      this.checked = undefined;
      const resolved = await checkedRoot(root);
      const { config, currentVersion } = await this.updateProject(resolved);
      const requestedTargets = checkedTargets(targets ?? config.targets as PlatformChoice[]);
      const requestedRulepacks = rulepacks !== undefined ? checkedRulepacks(rulepacks) : config.rulepacks;
      const targetsChanged = !sameStringSet(requestedTargets, config.targets);
      const rulepacksChanged = !sameStringSet(requestedRulepacks, config.rulepacks);

      if (config.source.type === "workspace") {
        const workspacePath = config.source.path ?? ".";
        const nextConfig: ProjectConfig = (targetsChanged || rulepacksChanged)
          ? { ...config, targets: requestedTargets, rulepacks: requestedRulepacks }
          : config;
        const plan = await planProject(resolved, nextConfig, codexAdapter);
        if (plan.conflicts.length) {
          throw new Error(plan.conflicts.map((issue) => issue.message).join("；"));
        }
        const available = plan.changes.length > 0 || targetsChanged || rulepacksChanged;
        if (available) {
          this.checked = { kind: "workspace", root: resolved, workspacePath, targets: requestedTargets, rulepacks: requestedRulepacks };
        }
        return {
          root: resolved,
          currentVersion,
          latestVersion: "本地源",
          available,
          targetsChanged,
          ...(rulepacks !== undefined ? { rulepacksChanged } : {}),
        };
      }

      const repository = config.source.repository ?? REPOSITORY;
      const release = await this.releaseLoader(repository);
      const lock = await loadProjectLock(resolved);
      assertReleaseAssetUnchanged(lock, release);
      assertReleaseNotOlder(lock, release);
      const available = lock.sourceVersion !== release.version || lock.sourceDigest !== release.digest || targetsChanged || rulepacksChanged;
      if (available) {
        this.checked = { kind: "github", root: resolved, repository, release, targets: requestedTargets, rulepacks: requestedRulepacks };
      }
      return {
        root: resolved,
        currentVersion,
        latestVersion: release.version,
        available,
        targetsChanged,
        ...(rulepacks !== undefined ? { rulepacksChanged } : {}),
      };
    });
  }

  async previewUpdate(root: string): Promise<Preview> {
    return this.exclusive(async () => {
      await this.discardPending();
      const resolved = await checkedRoot(root);
      const checked = this.checked;
      if (!checked || checked.root !== resolved) throw new Error("请先检查更新");
      const { config } = await this.updateProject(resolved);
      const configContent = await readFile(path.join(resolved, "agent-rules.yaml"), "utf8");
      const targetsChanged = !sameStringSet(checked.targets, config.targets);
      const rulepacksChanged = !sameStringSet(checked.rulepacks, config.rulepacks);
      const configChanged = targetsChanged || rulepacksChanged;
      const nextConfig: ProjectConfig = configChanged
        ? { ...config, targets: checked.targets, rulepacks: checked.rulepacks }
        : config;
      const nextConfigContent = configChanged ? stringify(nextConfig) : undefined;
      const lock = await loadProjectLock(resolved);
      const retainedPaths = await listRetainedRulePaths(resolved, lock.managedFiles);

      if (checked.kind === "workspace") {
        if (config.source.type !== "workspace" || config.source.path !== checked.workspacePath) {
          throw new Error("项目规则源在检查更新后发生变化，请重新检查");
        }
        const plan = await planProject(resolved, nextConfig, codexAdapter);
        const changes = nextConfigContent
          ? [{ path: "agent-rules.yaml", action: "modify" as const, before: configContent, after: nextConfigContent }, ...plan.changes]
          : plan.changes;
        if (!plan.conflicts.length && changes.length) {
          this.pending = {
            kind: "update",
            sourceType: "workspace",
            root: resolved,
            workspacePath: checked.workspacePath,
            config: nextConfig,
            configContent,
            nextConfigContent,
            plan,
          };
        }
        return {
          kind: "update",
          root: resolved,
          changes,
          retainedPaths,
          conflicts: plan.conflicts,
          version: "本地源",
          targets: nextConfig.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "workspace",
        };
      }

      if (config.source.type !== "github" || config.source.repository !== checked.repository) {
        throw new Error("项目规则源在检查更新后发生变化，请重新检查");
      }
      assertReleaseAssetUnchanged(lock, checked.release);
      assertReleaseNotOlder(lock, checked.release);
      const source = await this.sourceLoader(checked.release);
      try {
        if (source.snapshot.version !== checked.release.version || source.snapshot.digest !== checked.release.digest) {
          throw new Error("下载的规则包与检查到的版本不一致");
        }
        const plan = await planProject(resolved, nextConfig, codexAdapter, source.snapshot);
        const changes = nextConfigContent
          ? [{ path: "agent-rules.yaml", action: "modify" as const, before: configContent, after: nextConfigContent }, ...plan.changes]
          : plan.changes;
        if (!plan.conflicts.length && changes.length) {
          this.pending = {
            kind: "update",
            sourceType: "github",
            root: resolved,
            repository: checked.repository,
            config: nextConfig,
            configContent,
            nextConfigContent,
            plan,
            source,
            release: checked.release,
          };
        } else {
          await source.cleanup();
        }
        return {
          kind: "update",
          root: resolved,
          changes,
          retainedPaths,
          conflicts: plan.conflicts,
          version: checked.release.version,
          targets: nextConfig.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "github",
        };
      } catch (error) {
        await source.cleanup();
        throw error;
      }
    });
  }

  async applyUpdate(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      const resolved = await checkedRoot(root);
      const pending = this.pending;
      if (!pending || pending.kind !== "update" || pending.root !== resolved) throw new Error("更新预览已失效，请重新查看变更");
      this.pending = undefined;
      this.checked = undefined;
      if (pending.sourceType === "workspace") {
        if (await readFile(path.join(resolved, "agent-rules.yaml"), "utf8") !== pending.configContent) {
          throw new Error("项目配置在预览后发生变化；请重新查看变更");
        }
        await this.updateProject(resolved);
        await applyProject(resolved, pending.config, codexAdapter, pending.nextConfigContent, undefined, pending.plan, pending.configContent);
        return inspectProjectRoot(resolved);
      }
      try {
        if (await readFile(path.join(resolved, "agent-rules.yaml"), "utf8") !== pending.configContent) {
          throw new Error("项目配置在预览后发生变化；请重新查看变更");
        }
        await this.updateProject(resolved);
        const latest = await this.releaseLoader(pending.repository);
        if (latest.version !== pending.release.version || latest.digest !== pending.release.digest) {
          throw new Error("发布版本在预览后发生变化，请重新检查更新");
        }
        await applyProject(resolved, pending.config, codexAdapter, pending.nextConfigContent, pending.source.snapshot, pending.plan, pending.configContent);
        return inspectProjectRoot(resolved);
      } finally {
        await pending.source.cleanup();
      }
    });
  }

  async previewUninstall(root: string): Promise<Preview> {
    return this.exclusive(async () => {
      await this.discardPending();
      const resolved = await checkedRoot(root);
      const plan = await planUninstall(resolved, codexAdapter);
      if (!plan.conflicts.length) this.pending = { kind: "uninstall", root: resolved, plan };
      let targets: string[] = [];
      try {
        targets = (await loadProjectConfig(resolved)).targets;
      } catch {
        // 配置文件损坏时安全降级为空平台数组，避免中断冲突预览展示。
      }
      return {
        kind: "uninstall",
        root: resolved,
        changes: plan.changes,
        retainedPaths: plan.retainedPaths,
        conflicts: plan.conflicts,
        targets,
      };
    });
  }

  async applyUninstall(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      const resolved = await checkedRoot(root);
      const pending = this.pending;
      if (!pending || pending.kind !== "uninstall" || pending.root !== resolved) throw new Error("卸载预览已失效，请重新预览");
      this.pending = undefined;
      await applyUninstall(resolved, codexAdapter, pending.plan);
      return inspectProjectRoot(resolved);
    });
  }

  /** 异常态（漂移/锁损坏/受控区块受损）可审查覆盖修复预览：保留 overrides.md，重同步全部受管文件与锁文件。 */
  async previewRepair(root: string, request?: InstallRequest): Promise<Preview> {
    return this.exclusive(async () => {
      await this.discardPending();
      this.checked = undefined;
      const resolved = await checkedRoot(root);
      let existingConfig: ProjectConfig | undefined;
      try {
        existingConfig = await loadProjectConfig(resolved);
      } catch {
        existingConfig = undefined;
      }
      const rulepacks = request?.rulepacks?.length
        ? checkedRulepacks(request.rulepacks)
        : existingConfig?.rulepacks?.length
          ? checkedRulepacks(existingConfig.rulepacks)
          : ["common"];
      const targets = request?.targets?.length
        ? checkedTargets(request.targets)
        : existingConfig?.targets?.length
          ? checkedTargets(existingConfig.targets as PlatformChoice[])
          : ["codex" as PlatformChoice];
      const requestedSource: RuleSourceChoice =
        request?.source ??
        (existingConfig?.source.type === "workspace" && existingConfig.source.path
          ? { type: "workspace", path: path.resolve(resolved, existingConfig.source.path) }
          : { type: "github", repository: existingConfig?.source.repository ?? REPOSITORY });

      const currentConfigText = (await isPresent(path.join(resolved, "agent-rules.yaml")))
        ? await readFile(path.join(resolved, "agent-rules.yaml"), "utf8").catch(() => undefined)
        : undefined;

      if (requestedSource.type === "workspace") {
        const workspaceInfo = await inspectWorkspaceSource(requestedSource.path);
        const config = workspaceConfigFor(resolved, workspaceInfo.root, rulepacks, targets);
        if (existingConfig?.project?.overrides) config.project.overrides = existingConfig.project.overrides;
        const nextConfigContent = stringify(config);
        const plan = await planProject(resolved, config, codexAdapter, undefined, { allowDriftRepair: true });
        const changes: ProjectChange[] =
          currentConfigText !== nextConfigContent
            ? [{ path: "agent-rules.yaml", action: currentConfigText ? "modify" : "add", before: currentConfigText, after: nextConfigContent }, ...plan.changes]
            : plan.changes;
        if (!plan.conflicts.length) {
          this.pending = {
            kind: "repair",
            sourceType: "workspace",
            root: resolved,
            workspacePath: config.source.path ?? ".",
            plan,
            config,
            nextConfigContent,
          };
        }
        return {
          kind: "repair",
          root: resolved,
          changes,
          retainedPaths: [config.project.overrides],
          conflicts: plan.conflicts,
          version: "本地源",
          targets: config.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "workspace",
        };
      }

      const repository = requestedSource.repository ?? REPOSITORY;
      const config = githubConfigFor(rulepacks, targets, repository);
      if (existingConfig?.project?.overrides) config.project.overrides = existingConfig.project.overrides;
      const nextConfigContent = stringify(config);
      const release = await this.releaseLoader(repository);
      const source = await this.sourceLoader(release);
      try {
        const plan = await planProject(resolved, config, codexAdapter, source.snapshot, { allowDriftRepair: true });
        const changes: ProjectChange[] =
          currentConfigText !== nextConfigContent
            ? [{ path: "agent-rules.yaml", action: currentConfigText ? "modify" : "add", before: currentConfigText, after: nextConfigContent }, ...plan.changes]
            : plan.changes;
        if (plan.conflicts.length) {
          await source.cleanup();
        } else {
          this.pending = {
            kind: "repair",
            sourceType: "github",
            root: resolved,
            repository,
            plan,
            config,
            nextConfigContent,
            source,
            release,
          };
        }
        return {
          kind: "repair",
          root: resolved,
          changes,
          retainedPaths: [config.project.overrides],
          conflicts: plan.conflicts,
          version: release.version,
          targets: config.targets,
          rulepacks: Object.keys(plan.to),
          sourceType: "github",
        };
      } catch (error) {
        await source.cleanup();
        throw error;
      }
    });
  }

  async applyRepair(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      const resolved = await checkedRoot(root);
      const pending = this.pending;
      if (!pending || pending.kind !== "repair" || pending.root !== resolved) throw new Error("修复预览已失效，请重新预览");
      this.pending = undefined;
      if (pending.sourceType === "workspace") {
        await applyProject(resolved, pending.config, codexAdapter, pending.nextConfigContent, undefined, pending.plan, undefined, { allowDriftRepair: true });
        return inspectProjectRoot(resolved);
      }
      try {
        await applyProject(resolved, pending.config, codexAdapter, pending.nextConfigContent, pending.source.snapshot, pending.plan, undefined, { allowDriftRepair: true });
        return inspectProjectRoot(resolved);
      } finally {
        await pending.source.cleanup();
      }
    });
  }

  /** 异常态或孤立锁文件强制卸载预览：清理受管文件与控制文件，严格保留 overrides.md 与非受管用户文件。 */
  async previewForceUninstall(root: string): Promise<Preview> {
    return this.exclusive(async () => {
      await this.discardPending();
      this.checked = undefined;
      const resolved = await checkedRoot(root);
      const plan = await planForceUninstall(resolved, codexAdapter);
      if (!plan.conflicts.length && plan.changes.length) {
        this.pending = { kind: "force-uninstall", root: resolved, plan };
      }
      let targets: string[] = [];
      try {
        targets = (await loadProjectConfig(resolved)).targets;
      } catch {
        targets = [];
      }
      return {
        kind: "force-uninstall",
        root: resolved,
        changes: plan.changes,
        retainedPaths: plan.retainedPaths,
        conflicts: plan.conflicts,
        targets,
      };
    });
  }

  async applyForceUninstall(root: string): Promise<ProjectStatus> {
    return this.exclusive(async () => {
      const resolved = await checkedRoot(root);
      const pending = this.pending;
      if (!pending || pending.kind !== "force-uninstall" || pending.root !== resolved) {
        throw new Error("强制卸载预览已失效，请重新预览");
      }
      this.pending = undefined;
      await applyForceUninstall(resolved, codexAdapter, pending.plan);
      return inspectProjectRoot(resolved);
    });
  }
}
