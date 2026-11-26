#!/usr/bin/env node

import process from "node:process";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { AGENTS_MD_TARGETS, codexAdapter } from "@zhishu/adapter-codex";
import {
  detectProject,
  createDefaultConfig,
  applyProject,
  initializeProject,
  initializeGithubProject,
  loadProjectConfig,
  loadProjectLock,
  planProject,
  planUninstall,
  applyUninstall,
  validateProject,
  findLatestRelease,
  downloadRulepacks,
  assertReleaseAssetUnchanged,
  assertReleaseNotOlder,
  listInterruptedTransactions,
  recoverInterruptedProject,
  EvolutionStore,
  resolveDefaultEvolutionDir,
  scanOverridesForPromotions,
  validateEvolutionTargetFile,
} from "@zhishu/core";
import type {
  DetectionResult,
  EvolutionChannel,
  EvolutionOperation,
  EvolutionTargetKind,
  ProjectChange,
  ProjectPlan,
  UninstallPlan,
} from "@zhishu/core";

const VERSION = "2.1.0";
const DEFAULT_REPOSITORY = "yadan177/ZhiShu";

function printHelp(): void {
  console.log(`智枢 (zhishu) ${VERSION}

用法：
  zhishu <command> [project-directory]

命令：
  detect      检测支持的技术栈并展示证据
  init        展示技术栈依据与建议规则包，再为所选平台安装规则
  check       检查本地完整性及规则源是否有更新
  diff        展示待更新文件的可审查差异
  update      预览更新；加 --apply 才会应用
  uninstall   预览项目规则卸载摘要；加 --details 查看逐行差异，--apply 才会卸载
  recover     查看中断事务；加 --apply 才会恢复原版本
  generate    update 的兼容命令，同样需要 --apply
  validate    只验证已安装项目文件的完整性
  evolve      规则自动进化（capture / list / scan-overrides / preview / apply / reject / export）
  version     输出 CLI 版本
  help        显示帮助

示例：zhishu diff /path/to/project
      zhishu update /path/to/project --apply
      zhishu uninstall /path/to/project --details
      zhishu uninstall /path/to/project --apply
      zhishu init /path/to/project --targets codex,antigravity,trae,qoder,cursor,workbuddy
      zhishu init /path/to/project --source-workspace /path/to/ZhiShu --rulepacks common,unity,xr-common,product-pm
      zhishu evolve capture --title "规范标题" --target-kind rule --target-path rulepacks/common/entry.md --anchor "## 工作准则" --op add-item --after "- 新增条目" --evidence "会话纠偏依据"
      zhishu evolve list --status pending
      zhishu evolve apply <proposal-id> --source-workspace /path/to/ZhiShu --apply`);
}

function isAgentsMdTarget(value: string): value is (typeof AGENTS_MD_TARGETS)[number] {
  return (AGENTS_MD_TARGETS as readonly string[]).includes(value);
}

function requestedTargets(): string[] {
  const index = process.argv.indexOf("--targets");
  if (index < 0) return ["codex"];
  const value = process.argv[index + 1];
  const targets = value?.split(",") ?? [];
  if (!value || value.startsWith("--") || targets.length === 0 ||
    new Set(targets).size !== targets.length || targets.some((target) => !isAgentsMdTarget(target))) {
    throw new Error(`--targets 只能填写不重复的平台：${AGENTS_MD_TARGETS.join(",")}`);
  }
  return targets;
}

function requestedRulepacks(): string[] | undefined {
  const index = process.argv.indexOf("--rulepacks");
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  const packs = value?.split(",") ?? [];
  if (!value || value.startsWith("--") || packs.length === 0 ||
    new Set(packs).size !== packs.length ||
    packs.some((id) => !/^[a-z0-9][a-z0-9/-]*$/.test(id) || id.includes("//") || id.endsWith("/"))) {
    throw new Error("--rulepacks 只能填写以逗号分隔且不重复的有效规则包 ID，例如 common,unity,xr-common,product-pm");
  }
  return packs;
}

function renderChange(change: ProjectChange): string {
  const lines = (content: string | undefined): string[] => {
    if (!content) return [];
    const result = content.split("\n");
    if (content.endsWith("\n")) result.pop();
    return result;
  };
  const before = lines(change.before);
  const after = lines(change.after);
  const newlineChanged = change.before !== undefined && change.after !== undefined &&
    change.before.endsWith("\n") !== change.after.endsWith("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  if (newlineChanged && prefix === before.length && prefix === after.length && prefix > 0) prefix--;
  let suffix = 0;
  if (!newlineChanged) {
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  }
  const oldChanged = before.slice(prefix, before.length - suffix);
  const newChanged = after.slice(prefix, after.length - suffix);
  const showLine = (line: string): string => line.replace(/\r/g, "\\r");
  const oldLines = oldChanged.map((line) => `-${showLine(line)}`);
  const newLines = newChanged.map((line) => `+${showLine(line)}`);
  if (suffix === 0 && oldChanged.length && change.before && !change.before.endsWith("\n")) oldLines.push("\\ No newline at end of file");
  if (suffix === 0 && newChanged.length && change.after && !change.after.endsWith("\n")) newLines.push("\\ No newline at end of file");
  const oldStart = oldChanged.length ? prefix + 1 : prefix;
  const newStart = newChanged.length ? prefix + 1 : prefix;
  return [`diff --zhishu ${change.path}`, `--- ${change.action === "add" ? "/dev/null" : change.path}`, `+++ ${change.action === "remove" ? "/dev/null" : change.path}`, `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`, ...oldLines, ...newLines].join("\n");
}

function printPlan(plan: ProjectPlan): void {
  console.log(`规则包版本：${JSON.stringify(plan.from)} → ${JSON.stringify(plan.to)}`);
  if (!plan.changes.length) console.log("没有待更新文件。");
  for (const change of plan.changes) console.log(renderChange(change));
  for (const conflict of plan.conflicts) console.error(`[${conflict.code}] ${conflict.message}`);
}

function printUninstallSummary(plan: UninstallPlan, applied: boolean): void {
  const verb = applied ? "已" : "将";
  const managedCount = plan.changes.filter((change) => change.path.startsWith(".agent-rules/") && change.action === "remove").length;
  const entryChange = plan.changes.find((change) => change.path === codexAdapter.entryFile);
  console.log(`${verb}删除 ${managedCount} 个受管文件（.agent-rules/）。`);
  if (entryChange) {
    console.log(entryChange.action === "remove"
      ? `${verb}删除工具生成的 ${codexAdapter.entryFile}。`
      : `${verb}从 ${codexAdapter.entryFile} 移除 智枢入口，保留原有内容。`);
  }
  console.log(`${verb}删除 agent-rules.yaml 和 .agent-rules.lock.json。`);
  console.log(plan.retainedPaths.length
    ? `保留项目本地文件（不删除）：\n${plan.retainedPaths.map((file) => `- ${file}`).join("\n")}`
    : "没有需要保留的项目本地文件。");
}

function printInitRecommendation(detection: DetectionResult, rulepacks: string[]): void {
  console.log("技术栈检测依据：");
  if (!detection.stacks.length) console.log("- 未发现可识别的语言标记；建议仅安装通用规则。");
  for (const stack of detection.stacks) {
    for (const evidence of stack.evidence) console.log(`- ${stack.id}（${stack.confidence}）：${evidence.path}，${evidence.reason}`);
  }
  console.log(`建议规则包：${rulepacks.join(", ")}`);
}

async function projectConfigExists(root: string): Promise<boolean> {
  try {
    await lstat(path.join(root, "agent-rules.yaml"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function collectPositionalArgs(args: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      if (valueFlags.has(arg)) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

async function runEvolve(args: readonly string[]): Promise<void> {
  const subcommand = args[0] ?? "help";
  const rest = args.slice(1);
  const valueFlags = new Set([
    "--inbox",
    "--from-json",
    "--title",
    "--channel",
    "--target-kind",
    "--target-path",
    "--rulepack",
    "--anchor",
    "--op",
    "--before",
    "--after",
    "--summary",
    "--evidence",
    "--source-label",
    "--url",
    "--source-workspace",
    "--status",
    "--reason",
    "--out",
  ]);
  const inboxArg = readFlagValue(rest, "--inbox");
  const inboxDir = inboxArg ? path.resolve(inboxArg) : resolveDefaultEvolutionDir();
  const store = new EvolutionStore(inboxDir);

  switch (subcommand) {
    case "capture": {
      const sourceWorkspace = readFlagValue(rest, "--source-workspace");
      const fromJson = readFlagValue(rest, "--from-json");
      let result;
      if (fromJson) {
        result = await store.importProposalFile(path.resolve(fromJson), {
          targetSourceRoot: sourceWorkspace ? path.resolve(sourceWorkspace) : undefined,
        });
      } else {
        const title = readFlagValue(rest, "--title");
        const targetKind = (readFlagValue(rest, "--target-kind") ?? "rule") as EvolutionTargetKind;
        const targetPath = readFlagValue(rest, "--target-path");
        const anchorHeading = readFlagValue(rest, "--anchor");
        const operation = (readFlagValue(rest, "--op") ?? "add-item") as EvolutionOperation;
        const channel = (readFlagValue(rest, "--channel") ?? "session-capture") as EvolutionChannel;
        const beforeSnippet = readFlagValue(rest, "--before");
        const afterSnippet = readFlagValue(rest, "--after");
        const summary = readFlagValue(rest, "--summary");
        const targetRulepack = readFlagValue(rest, "--rulepack");
        const evidenceSummary = readFlagValue(rest, "--evidence");
        const sourceLabel = readFlagValue(rest, "--source-label") ?? "CLI 会话捕获";
        const url = readFlagValue(rest, "--url");
        if (!title || !targetPath || !anchorHeading || !evidenceSummary) {
          throw new Error(
            "capture 必填参数：--title、--target-path、--anchor、--evidence（或使用 --from-json <file>）",
          );
        }
        result = await store.capture(
          {
            channel,
            targetKind,
            operation,
            title,
            summary,
            targetRulepack,
            targetPath,
            anchorHeading,
            beforeSnippet,
            afterSnippet,
            evidence: [
              {
                sourceLabel,
                summary: evidenceSummary,
                ...(url ? { url } : {}),
                verifiedAt: new Date().toISOString().slice(0, 10),
              },
            ],
          },
          { targetSourceRoot: sourceWorkspace ? path.resolve(sourceWorkspace) : undefined },
        );
      }
      if (result.outcome === "created" && result.proposal) {
        console.log(`已投递至规则进化待审收件箱：${result.proposal.id}`);
        console.log(`目标文件：${result.proposal.targetPath}（${result.proposal.anchorHeading}）`);
        console.log(`收件箱目录：${inboxDir}`);
      } else if (result.outcome === "duplicate" && result.proposal) {
        console.log(`已存在同指纹待审提案，已自动折叠：${result.proposal.id}`);
      } else {
        console.log(`该提案指纹曾被驳回，未重复入箱（${result.fingerprint.slice(0, 12)}）`);
      }
      return;
    }
    case "list": {
      const statusFilter = readFlagValue(rest, "--status") ?? "all";
      const listed = await store.list();
      const filtered = listed.proposals.filter((item) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "pending") return item.status === "pending" || item.status === "stale";
        if (statusFilter === "processed") {
          return item.status === "approved" || item.status === "rejected" || item.status === "archived";
        }
        return item.status === statusFilter;
      });
      if (rest.includes("--json")) {
        console.log(JSON.stringify({ counts: listed.counts, proposals: filtered }, null, 2));
        return;
      }
      console.log(
        `规则进化收件箱（待审 ${listed.counts.pendingTab} · 有冲突 ${listed.counts.conflictTab} · 已处理 ${listed.counts.processedTab}）：`,
      );
      if (!filtered.length) {
        console.log("（无匹配提案）");
        return;
      }
      for (const item of filtered) {
        console.log(`- [${item.status}] ${item.id} | ${item.channel} | ${item.targetPath} | ${item.title}`);
      }
      return;
    }
    case "scan-overrides": {
      const projects = collectPositionalArgs(rest, valueFlags).map((item) => path.resolve(item));
      if (projects.length < 2) {
        throw new Error("scan-overrides 至少需要传入 2 个项目目录以提取跨项目共性覆盖");
      }
      const sourceWorkspace = readFlagValue(rest, "--source-workspace");
      const targetSourceRoot = sourceWorkspace ? path.resolve(sourceWorkspace) : undefined;
      const scan = await scanOverridesForPromotions(projects, { targetSourceRoot });
      let created = 0;
      let folded = 0;
      for (const candidate of scan.candidates) {
        const res = await store.capture(candidate, { targetSourceRoot });
        if (res.outcome === "created") created++;
        else folded++;
      }
      console.log(
        `已只读扫描 ${scan.scannedCount} 个项目（跳过 ${scan.skippedProjects.length} 个）：新增 ${created} 条升格提案，折叠 ${folded} 条重复/已驳回项。`,
      );
      return;
    }
    case "preview":
    case "apply": {
      const positionals = collectPositionalArgs(rest, valueFlags);
      const proposalId = positionals[0];
      const sourceWorkspace = readFlagValue(rest, "--source-workspace");
      if (!proposalId || !sourceWorkspace) {
        throw new Error(`${subcommand} 需要参数：<proposal-id> --source-workspace <dir>`);
      }
      const resolvedSource = path.resolve(sourceWorkspace);
      const preview = await store.preview(proposalId, {
        id: "cli-workspace",
        name: path.basename(resolvedSource) || resolvedSource,
        root: resolvedSource,
        readonly: false,
      });
      console.log(`提案：${preview.proposalId} · ${preview.title}`);
      console.log(`目标：${preview.targetFilePath}（${preview.anchorHeading}，${preview.lineCountBefore} → ${preview.lineCountAfter} 行）`);
      if (preview.similarItems.length) {
        console.log(`相似条款提醒：命中 ${preview.similarItems.length} 处（最高相似度 ${Math.round(preview.similarItems[0]!.similarity * 100)}%）`);
      }
      if (preview.overBudget) {
        console.log(`体量预算提示：写入后 ${preview.lineCountAfter} 行，超过建议阈值 ${preview.lineBudget} 行，建议优先修订或合并旧条目。`);
      }
      if (preview.conflicts.length) {
        for (const conflict of preview.conflicts) console.error(conflict);
        process.exitCode = 2;
        return;
      }
      console.log(
        renderChange({
          path: preview.targetPath,
          action: "modify",
          before: preview.beforeContent,
          after: preview.afterContent,
        }),
      );
      if (subcommand === "preview" || !rest.includes("--apply")) {
        console.log(`审查无误后，运行 zhishu evolve apply ${proposalId} --source-workspace ${resolvedSource} --apply 确认写入。`);
        return;
      }
      const applied = await store.apply(preview.token, validateEvolutionTargetFile);
      console.log(`已原子写入并完成自动化门禁校验：${applied.receipt.targetFilePath}`);
      return;
    }
    case "reject": {
      const positionals = collectPositionalArgs(rest, valueFlags);
      const proposalId = positionals[0];
      if (!proposalId) throw new Error("reject 需要指定 <proposal-id>");
      const reason = readFlagValue(rest, "--reason");
      const updated = await store.reject(proposalId, reason);
      console.log(`已驳回提案并记录去重指纹：${updated.id}`);
      return;
    }
    case "export": {
      const positionals = collectPositionalArgs(rest, valueFlags);
      const proposalId = positionals[0];
      const outPath = readFlagValue(rest, "--out");
      if (!proposalId || !outPath) throw new Error("export 需要参数：<proposal-id> --out <file.patch>");
      const sourceWorkspace = readFlagValue(rest, "--source-workspace");
      const exported = await store.exportPatch(
        proposalId,
        path.resolve(outPath),
        sourceWorkspace ? path.resolve(sourceWorkspace) : undefined,
      );
      console.log(`已导出增量补丁：${exported.path}（${exported.sha256}）`);
      return;
    }
    default:
      console.log(`用法：
  zhishu evolve capture --title <标题> --target-kind rule|skill --target-path <相对路径> --anchor <章节标题> --op add-item|update-item|deprecate-item --after <内容> --evidence <依据>
  zhishu evolve capture --from-json <提案文件.json>
  zhishu evolve list [--status pending|conflict|stale|processed|all] [--json]
  zhishu evolve scan-overrides <project1> <project2> [...] [--source-workspace <规则源目录>]
  zhishu evolve preview <proposal-id> --source-workspace <规则源目录>
  zhishu evolve apply <proposal-id> --source-workspace <规则源目录> --apply
  zhishu evolve reject <proposal-id> [--reason <原因>]
  zhishu evolve export <proposal-id> --out <补丁文件.patch>`);
  }
}

async function run(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const root = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : process.cwd();

  switch (command) {
    case "detect": {
      const result = await detectProject(root);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "init": {
      if (await projectConfigExists(root)) throw new Error("agent-rules.yaml 已存在；请使用 diff/update，不要再次运行 init");
      const sourceArg = process.argv.indexOf("--source-workspace");
      const sourceRoot = sourceArg >= 0 ? process.argv[sourceArg + 1] : undefined;
      if (sourceArg >= 0 && !sourceRoot) throw new Error("--source-workspace 需要规则源目录");
      const targets = requestedTargets();
      const selectedRulepacks = requestedRulepacks();
      const detection = await detectProject(root);
      const recommendation = await createDefaultConfig(root, codexAdapter);
      printInitRecommendation(detection, recommendation.rulepacks);
      let config;
      if (sourceArg >= 0 && sourceRoot !== undefined) {
        config = await initializeProject(root, codexAdapter, sourceRoot, targets, selectedRulepacks);
      } else {
        const release = await findLatestRelease(DEFAULT_REPOSITORY);
        const downloaded = await downloadRulepacks(release);
        try {
          config = await initializeGithubProject(root, codexAdapter, {
            root: downloaded.sourceRoot,
            version: downloaded.version,
            digest: release.digest,
            commit: downloaded.sourceCommit,
          }, DEFAULT_REPOSITORY, selectedRulepacks, undefined, targets);
        } finally {
          await downloaded.cleanup();
        }
      }
      console.log(`已在 ${root} 初始化智枢`);
      console.log(`规则包：${config.rulepacks.join(", ")}`);
      console.log(`目标平台：${config.targets.join(", ")}`);
      return;
    }
    case "generate":
    case "diff":
    case "update": {
      const config = await loadProjectConfig(root);
      const repository = config.source.type === "github" ? config.source.repository : undefined;
      if (config.source.type === "github" && !repository) throw new Error("GitHub 规则源缺少 repository");
      const release = repository ? await findLatestRelease(repository) : undefined;
      if (release) {
        const installed = await loadProjectLock(root);
        assertReleaseAssetUnchanged(installed, release);
        assertReleaseNotOlder(installed, release);
      }
      const downloaded = release ? await downloadRulepacks(release) : undefined;
      try {
      const snapshot = downloaded && release ? {
        root: downloaded.sourceRoot,
        version: downloaded.version,
        digest: release.digest,
        commit: downloaded.sourceCommit,
      } : undefined;
      const plan = await planProject(root, config, codexAdapter, snapshot);
      printPlan(plan);
      if (plan.conflicts.length) {
        process.exitCode = 2;
        return;
      }
      if (command === "diff" || !process.argv.includes("--apply")) {
        if (command !== "diff" && plan.changes.length) console.log("如已审查差异，运行 update <project-directory> --apply 应用。");
        return;
      }
      if (plan.changes.length) {
        await applyProject(root, config, codexAdapter, undefined, snapshot, plan);
        console.log(`已在 ${root} 应用 ${plan.changes.length} 项变更`);
      }
      return;
      } finally {
        await downloaded?.cleanup();
      }
    }
    case "recover": {
      const pending = await listInterruptedTransactions(root);
      if (!pending.length) {
        console.log("没有未完成的规则更新事务。");
        return;
      }
      console.log(`发现 ${pending.length} 个未完成事务：${pending.join(", ")}`);
      if (!process.argv.includes("--apply")) {
        console.log("审查事务目录后，运行 recover <project-directory> --apply 恢复更新前的文件；未完成的新文件会保留在恢复副本中。");
        return;
      }
      const recovered = await recoverInterruptedProject(root, codexAdapter);
      console.log(`已恢复更新前的项目文件；中断期间的文件保留在 ${recovered}`);
      return;
    }
    case "uninstall": {
      const args = process.argv.slice(3);
      const unknownFlags = args.filter((arg) => arg.startsWith("--") && arg !== "--apply" && arg !== "--details");
      const directories = args.filter((arg) => !arg.startsWith("--"));
      if (unknownFlags.length || directories.length > 1) throw new Error(`uninstall 参数不合法：${args.join(" ")}`);
      const target = directories[0] ?? process.cwd();
      const plan = await planUninstall(target, codexAdapter);
      if (plan.conflicts.length) {
        for (const conflict of plan.conflicts) console.error(`[${conflict.code}] ${conflict.message}`);
        process.exitCode = 2;
        return;
      }
      if (args.includes("--details")) {
        for (const change of plan.changes) console.log(renderChange(change));
      }
      if (!args.includes("--apply")) {
        printUninstallSummary(plan, false);
        if (!args.includes("--details")) console.log("如需查看逐行差异，运行 zhishu uninstall <project-directory> --details。");
        console.log("确认后运行 zhishu uninstall <project-directory> --apply 卸载项目规则。");
        return;
      }
      await applyUninstall(target, codexAdapter, plan);
      console.log(`已在 ${target} 卸载 智枢项目规则。`);
      printUninstallSummary(plan, true);
      return;
    }
    case "validate": {
      const result = await validateProject(root, codexAdapter);
      if (!result.valid) {
        for (const issue of result.issues) {
          console.error(`[${issue.code}] ${issue.message}`);
        }
        process.exitCode = 1;
        return;
      }
      console.log(`智枢项目验证通过：${root}`);
      return;
    }
    case "evolve": {
      await runEvolve(process.argv.slice(3));
      return;
    }
    case "check": {
      const validation = await validateProject(root, codexAdapter);
      if (!validation.valid) {
        for (const issue of validation.issues) console.error(`[${issue.code}] ${issue.message}`);
        process.exitCode = 2;
        return;
      }
      const config = await loadProjectConfig(root);
      if (config.source.type === "github") {
        if (!config.source.repository) throw new Error("GitHub 规则源缺少 repository");
        const release = await findLatestRelease(config.source.repository);
        const lock = await loadProjectLock(root);
        assertReleaseAssetUnchanged(lock, release);
        assertReleaseNotOlder(lock, release);
        const upToDate = lock.sourceVersion === release.version && lock.sourceDigest === release.digest;
        console.log(upToDate ? `远程规则已是最新版本：${release.version}` : `发现远程规则新版本或未固定资产摘要：${lock.sourceVersion ?? "未知"} → ${release.version}；运行 diff 查看。`);
        if (!upToDate) process.exitCode = 3;
        return;
      }
      const plan = await planProject(root, config, codexAdapter);
      for (const conflict of plan.conflicts) console.error(`[${conflict.code}] ${conflict.message}`);
      if (plan.conflicts.length) {
        process.exitCode = 2;
        return;
      }
      console.log(plan.changes.length ? `发现 ${plan.changes.length} 项待更新变更；运行 diff 查看。` : "已安装规则是最新版本。");
      if (plan.changes.length) process.exitCode = 3;
      return;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      console.error(`未知命令：${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`zhishu：${message}`);
  process.exitCode = 1;
});
