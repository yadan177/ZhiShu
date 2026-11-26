import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_WATCH_SOURCES,
  EvolutionStore,
  assertSafeWatchUrl,
  computeAtomicDeltaPatch,
  detectSensitiveContent,
  scanOverridesForPromotions,
  validateEvolutionTargetFile,
  watchOfficialDocs,
} from "./evolution.js";
import { assetDigest } from "./user-assets.js";

async function createSampleRuleRepo(root: string): Promise<string> {
  const repoDir = path.join(root, "rule-repo");
  const ruleFile = path.join(repoDir, "rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
  await mkdir(path.dirname(ruleFile), { recursive: true });
  await writeFile(
    ruleFile,
    [
      "# XR 空间界面规范",
      "",
      "## 2. 视距、视野角与物理可读性参数",
      "",
      "- 默认主窗口视距保持在 1.25m～2.0m 之间。",
      "- 正文字号不低于 17pt，可点击热区最小 44pt。",
      "",
      "## 3. 安全红线",
      "",
      "- 禁止将主界面面板硬锁定在用户头部视角。",
      "",
    ].join("\n"),
    "utf8",
  );
  return repoDir;
}

test("AC-EV-01 & AC-EV-08：通道 1 捕获入箱、指纹去重及敏感明文/私钥拦截", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-cap-")));
  try {
    const store = new EvolutionStore(path.join(root, "evolution"));
    const repoDir = await createSampleRuleRepo(root);

    // AC-EV-08：包含明文 Token 或本机私有路径必须阻断，绝不落盘
    await assert.rejects(
      () =>
        store.capture({
          channel: "session-capture",
          targetKind: "rule",
          operation: "add-item",
          title: "泄露凭据的提案",
          targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
          anchorHeading: "## 2. 视距、视野角与物理可读性参数",
          afterSnippet: "- 调试时使用 api_key=sk-proj-1234567890abcdefghijklmnop 即可",
          evidence: [{ sourceLabel: "会话纠偏", summary: "调试记录" }],
        }),
      /敏感信息拦截/,
    );
    await assert.rejects(
      () =>
        store.capture({
          channel: "session-capture",
          targetKind: "rule",
          operation: "add-item",
          title: "泄露本机路径的提案",
          targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
          anchorHeading: "## 2. 视距、视野角与物理可读性参数",
          afterSnippet: "- 图标放到 /Users/alice/Desktop/icons 目录",
          evidence: [{ sourceLabel: "会话纠偏", summary: "本地路径误入" }],
        }),
      /敏感信息拦截/,
    );
    assert.equal((await store.list()).proposals.length, 0);

    // AC-EV-01：合法提案入箱 + 重复指纹自动折叠
    const created = await store.capture(
      {
        channel: "session-capture",
        targetKind: "rule",
        operation: "add-item",
        title: "visionOS 悬停热区补充 60pt 推荐值",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        afterSnippet: "- 眼动注视目标推荐尺寸 60pt，确保远距注视防误触。",
        evidence: [{ sourceLabel: "Codex 会话纠偏", summary: "visionOS 实机验收眼动点选偏小问题" }],
      },
      { targetSourceRoot: repoDir },
    );
    assert.equal(created.outcome, "created");
    assert.ok(created.proposal);
    assert.equal(created.proposal.channel, "session-capture");

    const duplicate = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "重复提交同条款",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 2. 视距、视野角与物理可读性参数",
      afterSnippet: "- 眼动注视目标推荐尺寸 60pt，确保远距注视防误触。",
      evidence: [{ sourceLabel: "重复会话", summary: "重复提交" }],
    });
    assert.equal(duplicate.outcome, "duplicate");

    const listed = await store.list();
    assert.equal(listed.counts.badge, 1);
    assert.equal(listed.counts.pendingTab, 1);
    assert.equal(listed.proposals.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-EV-02：通道 2 只读扫描多项目 overrides.md 聚类共性升格且原文件零修改", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-ovr-")));
  try {
    const projA = path.join(root, "project-alpha");
    const projB = path.join(root, "project-beta");
    const projMissing = path.join(root, "project-missing");
    await mkdir(path.join(projA, ".agent-rules"), { recursive: true });
    await mkdir(path.join(projB, ".agent-rules"), { recursive: true });

    const ovrA = path.join(projA, ".agent-rules/overrides.md");
    const ovrB = path.join(projB, ".agent-rules/overrides.md");
    const contentA = [
      "# 项目覆盖",
      "- 所有异步导出接口必须支持 AbortSignal 超时取消并释放临时文件。",
      "- [仅本项目] 内网测试服务地址为 http://192.168.1.50:8080。",
    ].join("\n");
    const contentB = [
      "# 项目覆盖",
      "- 异步导出接口必须支持 AbortSignal 超时取消与临时文件清理。",
      "- 本地私有目录 /Users/bob/work/tmp 禁止提交。",
    ].join("\n");
    await writeFile(ovrA, contentA, "utf8");
    await writeFile(ovrB, contentB, "utf8");

    const hashABefore = assetDigest(await readFile(ovrA));
    const hashBBefore = assetDigest(await readFile(ovrB));

    const scan = await scanOverridesForPromotions([projA, projB, projMissing]);
    assert.equal(scan.scannedCount, 2);
    assert.equal(scan.skippedProjects.length, 1);
    assert.equal(scan.candidates.length, 1);
    assert.equal(scan.candidates[0]?.channel, "overrides-promotion");
    assert.deepEqual(scan.candidates[0]?.evidence[0]?.projectNames, ["project-alpha", "project-beta"]);

    // 验证两份原项目 overrides.md 字节哈希 100% 未变
    assert.equal(assetDigest(await readFile(ovrA)), hashABefore);
    assert.equal(assetDigest(await readFile(ovrB)), hashBBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-EV-03：通道 3 官方文档巡检支持差异识别、单源失败降级与无差异不产空提案", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-watch-")));
  try {
    const repoDir = await createSampleRuleRepo(root);
    const sources = [
      {
        ...DEFAULT_WATCH_SOURCES[0]!,
        id: "ok-diff",
        name: "Apple visionOS 新版",
        url: "https://developer.apple.com/visionos-update",
      },
      {
        ...DEFAULT_WATCH_SOURCES[0]!,
        id: "ok-same",
        name: "无变化文档",
        url: "https://developer.apple.com/no-change",
        keywords: ["1.25m"],
      },
      {
        ...DEFAULT_WATCH_SOURCES[0]!,
        id: "broken-source",
        name: "不可达官方源",
        url: "https://unreachable.example.com/docs",
      },
    ];

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("visionos-update")) {
        return new Response(
          "<html><title>visionOS 2.5 HIG</title><body><p>visionOS 2.5 introduces 60pt hover target minimums.</p></body></html>",
          { status: 200 },
        );
      }
      if (url.includes("no-change")) {
        return new Response("<html><title>Same</title><body><p>Keep window at 1.25m distance.</p></body></html>", {
          status: 200,
        });
      }
      throw new Error("ENOTFOUND unreachable.example.com");
    };

    const run = await watchOfficialDocs(sources, repoDir, { fetcher: mockFetch });
    assert.equal(run.checkedCount, 3);
    assert.equal(run.succeededCount, 2);
    assert.equal(run.failedCount, 1);
    assert.equal(run.cancelled, false);
    assert.equal(run.candidates.length, 1);
    assert.equal(run.candidates[0]?.channel, "docs-watch");
    assert.equal(run.candidates[0]?.evidence[0]?.url, "https://developer.apple.com/visionos-update");
    assert.equal(run.results.find((r) => r.sourceId === "ok-same")?.hasDiff, false);
    assert.equal(run.results.find((r) => r.sourceId === "broken-source")?.status, "error");

    // SSRF 防护校验：拒绝 http:// 与本机内网地址
    assert.throws(() => assertSafeWatchUrl("http://example.com/docs"), /HTTPS/);
    assert.throws(() => assertSafeWatchUrl("https://127.0.0.1:8080/internal"), /本机或内网/);
    assert.throws(() => assertSafeWatchUrl("https://192.168.1.10/docs"), /本机或内网/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-EV-04 / 05 / 06 / 07：预览严格只读、冲突/只读阻断、原子写入与校验失败完整回滚", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-apply-")));
  try {
    const repoDir = await createSampleRuleRepo(root);
    const ruleFile = path.join(repoDir, "rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
    const store = new EvolutionStore(path.join(root, "evolution"));

    const originalText = await readFile(ruleFile, "utf8");
    const originalDigest = assetDigest(originalText);
    const originalMtime = (await stat(ruleFile)).mtimeMs;

    const { proposal } = await store.capture(
      {
        channel: "session-capture",
        targetKind: "rule",
        operation: "update-item",
        title: "更新 XR 可点击热区至 60pt 推荐规范",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        beforeSnippet: "- 正文字号不低于 17pt，可点击热区最小 44pt。",
        afterSnippet: "- 正文字号不低于 17pt，裸手热区最小 44pt，眼动推荐 60pt。",
        evidence: [{ sourceLabel: "设计评审", summary: "校准 visionOS 与 Meta 数值" }],
      },
      { targetSourceRoot: repoDir },
    );
    assert.ok(proposal);

    // AC-EV-06 (只读源阻断)：选择内置只读官方源时，预览产生冲突且 apply 被拒绝
    const readonlyPreview = await store.preview(proposal.id, {
      id: "zhishu-official",
      name: "智枢官方源",
      readonly: true,
    });
    assert.ok(readonlyPreview.conflicts.some((c) => c.includes("READONLY_SOURCE")));
    await assert.rejects(() => store.apply(readonlyPreview.token), /阻塞冲突/);

    // AC-EV-05 (严禁静默写入)：预览可写源但不 apply，文件字节与 mtime 完全不变
    const preview = await store.preview(proposal.id, {
      id: "local-workspace",
      name: "本地开发规则仓库",
      root: repoDir,
      readonly: false,
    });
    assert.deepEqual(preview.conflicts, []);
    assert.equal(assetDigest(await readFile(ruleFile, "utf8")), originalDigest);
    assert.equal((await stat(ruleFile)).mtimeMs, originalMtime);

    // AC-EV-07 (校验失败完整回滚)：模拟写入后门禁失败，文件必须恢复原始字节
    await assert.rejects(
      () =>
        store.apply(preview.token, async () => ({
          valid: false,
          errors: ["检测到失效 Markdown 相对链接 ./broken.md"],
        })),
      /已完整回滚目标文件/,
    );
    assert.equal(await readFile(ruleFile, "utf8"), originalText);
    assert.equal((await store.list()).proposals[0]?.status, "pending");

    // AC-EV-06 (指纹漂移阻断)：人工修改目标文件后预览报错，需 recheck 后才允许写入
    await writeFile(ruleFile, `${originalText}\n<!-- 人工临时注释 -->\n`, "utf8");
    const driftPreview = await store.preview(proposal.id, {
      id: "local-workspace",
      name: "本地开发规则仓库",
      root: repoDir,
    });
    assert.ok(driftPreview.conflicts.some((c) => c.includes("BASE_DIGEST_DRIFT")));
    await assert.rejects(() => store.apply(driftPreview.token), /阻塞冲突/);

    // 重新检测刷新指纹后，AC-EV-04 正常原子写入（仅修改锚点内对应行，其余章节字节不变）
    const rechecked = await store.recheck(proposal.id, {
      id: "local-workspace",
      name: "本地开发规则仓库",
      root: repoDir,
    });
    assert.deepEqual(rechecked.conflicts, []);
    assert.equal(rechecked.proposal.status, "pending");

    const cleanPreview = await store.preview(proposal.id, {
      id: "local-workspace",
      name: "本地开发规则仓库",
      root: repoDir,
    });
    assert.deepEqual(cleanPreview.conflicts, []);

    const applied = await store.apply(cleanPreview.token, async () => ({ valid: true, errors: [] }));
    assert.equal(applied.proposal.status, "approved");
    assert.equal(applied.receipt.validated, true);

    const updatedContent = await readFile(ruleFile, "utf8");
    assert.match(updatedContent, /眼动推荐 60pt/);
    assert.match(updatedContent, /## 3\. 安全红线\n\n- 禁止将主界面面板硬锁定在用户头部视角。/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("陈旧衰减（>30天）、驳回防重复、补丁导出拒绝覆盖与敏感检测单元测试", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-misc-")));
  try {
    const repoDir = await createSampleRuleRepo(root);
    const store = new EvolutionStore(path.join(root, "evolution"));

    // 创建一条 35 天前的提案，list() 自动标为 stale
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const { proposal } = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "陈旧测试提案",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 3. 安全红线",
      afterSnippet: "- 透视环境下禁止使用高饱和纯黑背景遮挡现实视野。",
      evidence: [{ sourceLabel: "历史评审", summary: "35 天前记录" }],
      createdAt: oldDate,
    });
    assert.ok(proposal);
    // 手动将 lastCheckedAt 回写为 35 天前以模拟真实挂起
    const proposalFile = path.join(root, "evolution/proposals", `${proposal.id}.json`);
    const raw = JSON.parse(await readFile(proposalFile, "utf8"));
    raw.lastCheckedAt = oldDate;
    await writeFile(proposalFile, JSON.stringify(raw, null, 2), "utf8");

    const listed = await store.list();
    assert.equal(listed.proposals[0]?.status, "stale");
    assert.equal(listed.counts.badge, 0);
    assert.equal(listed.counts.pendingTab, 1);

    // 导出补丁不得静默覆盖已有文件
    const patchFile = path.join(root, "out.patch");
    const exported = await store.exportPatch(proposal.id, patchFile, repoDir);
    assert.ok(exported.sha256.startsWith("sha256:"));
    assert.match(await readFile(patchFile, "utf8"), /透视环境下禁止使用高饱和纯黑背景/);
    await assert.rejects(() => store.exportPatch(proposal.id, patchFile, repoDir), /拒绝静默覆盖/);

    // 驳回后再次投递相同指纹会被识别为 previously-rejected
    const rejected = await store.reject(proposal.id, "已在其他专题覆盖");
    assert.equal(rejected.status, "rejected");
    const again = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "再次提交已驳回条款",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 3. 安全红线",
      afterSnippet: "- 透视环境下禁止使用高饱和纯黑背景遮挡现实视野。",
      evidence: [{ sourceLabel: "重复会话", summary: "再次出现" }],
    });
    assert.equal(again.outcome, "previously-rejected");

    // 直接校验 computeAtomicDeltaPatch 的查重与预算提示
    const patchCheck = computeAtomicDeltaPatch(
      "# 规范\n\n## 3. 安全红线\n\n- 禁止将主界面面板硬锁定在用户头部视角。\n",
      {
        targetKind: "rule",
        operation: "add-item",
        anchorHeading: "## 3. 安全红线",
        afterSnippet: "- 禁止将主界面面板硬锁定在用户头部视角，防止眩晕。",
      },
    );
    assert.equal(patchCheck.applied, true);
    assert.ok(patchCheck.similarItems.length >= 1);
    assert.ok(detectSensitiveContent({ afterSnippet: "Bearer abcdefghijklmnop123456" }).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC-EV-07 真实门禁：失效 Markdown 链接与非法 Skill Frontmatter 自动回滚", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-gate-")));
  try {
    const repoDir = await createSampleRuleRepo(root);
    const ruleFile = path.join(repoDir, "rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
    const skillFile = path.join(repoDir, "plugins/zhishu-fullstack-dev/skills/sample-skill/SKILL.md");
    await mkdir(path.dirname(skillFile), { recursive: true });
    const validSkill = [
      "---",
      "name: sample-skill",
      "description: 用于验证智枢规则进化写入后 YAML Frontmatter 完整性的测试技能。",
      "metadata:",
      "  title: 门禁校验测试技能",
      "---",
      "",
      "# 门禁校验测试技能",
      "",
      "## 1. 自检步骤",
      "",
      `- ${"执行完整的自动化门禁核对与变更审查，确保写入规则库或技能库的内容不含死链、非法元数据或敏感明文。".repeat(4)}`,
      "",
    ].join("\n");
    await writeFile(skillFile, validSkill, "utf8");

    const store = new EvolutionStore(path.join(root, "evolution"));
    const originalRule = await readFile(ruleFile, "utf8");

    // 1. 规则文件写入含死链的补丁 → validateEvolutionTargetFile 拦截并完整回滚
    const badRule = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "包含失效相对链接的补丁",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 3. 安全红线",
      afterSnippet: "- 详见 [不存在文档](./not-found-guide.md)。",
      evidence: [{ sourceLabel: "测试", summary: "验证死链拦截" }],
    });
    const rulePreview = await store.preview(badRule.proposal!.id, {
      id: "local",
      name: "本地源",
      root: repoDir,
    });
    await assert.rejects(() => store.apply(rulePreview.token, validateEvolutionTargetFile), /失效的 Markdown 相对链接/);
    assert.equal(await readFile(ruleFile, "utf8"), originalRule);

    // 2. Skill 文件破坏 description 长度 → validateEvolutionTargetFile 拦截并完整回滚
    const badSkill = await store.capture({
      channel: "session-capture",
      targetKind: "skill",
      operation: "update-item",
      title: "破坏 Skill 正文长度",
      targetPath: "plugins/zhishu-fullstack-dev/skills/sample-skill/SKILL.md",
      anchorHeading: "## 1. 自检步骤",
      beforeSnippet: `- ${"执行完整的自动化门禁核对与变更审查，确保写入规则库或技能库的内容不含死链、非法元数据或敏感明文。".repeat(4)}`,
      afterSnippet: "- 过短",
      evidence: [{ sourceLabel: "测试", summary: "验证 Skill 正文校验" }],
    });
    const skillPreview = await store.preview(badSkill.proposal!.id, {
      id: "local",
      name: "本地源",
      root: repoDir,
    });
    await assert.rejects(() => store.apply(skillPreview.token, validateEvolutionTargetFile), /正文内容不完整/);
    assert.equal(await readFile(skillFile, "utf8"), validSkill);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("规则进化 P0/P1 闭环：conflict 编辑后重检转 pending、reopen/archive、已通过去重与 3xx SSRF 拦截", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evo-p0-")));
  try {
    const repoDir = path.join(root, "repo");
    const ruleFile = path.join(repoDir, "rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
    await mkdir(path.dirname(ruleFile), { recursive: true });
    await writeFile(ruleFile, "# XR 规范\n\n## 1. 基准\n\n- 原条款 A。\n", "utf8");

    const store = new EvolutionStore(path.join(root, "evolution"));
    const targetSource = { id: "local", name: "本地源", root: repoDir };

    // 1. 故意传入错误锚点触发 conflict，再通过 recheck(id, source, editedPatch) 修正并转回 pending
    const captured = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "补充新条款 B",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 99. 不存在的章节",
      afterSnippet: "- 新条款 B：主操作面板保持 1.2m–2.0m 视距。",
      evidence: [{ sourceLabel: "评审", summary: "补齐视距约束" }],
    });
    const proposalId = captured.proposal!.id;
    const firstRecheck = await store.recheck(proposalId, targetSource);
    assert.equal(firstRecheck.proposal.status, "conflict");
    assert.ok(firstRecheck.conflicts.length > 0);

    // 未解除 conflict 时 preview 应显式拦截
    const blockedPreview = await store.preview(proposalId, targetSource);
    assert.ok(blockedPreview.conflicts.some((c) => c.includes("PROPOSAL_CONFLICT")));

    // 携带编辑后锚点重新检测 → 落盘并恢复为 pending，可正常预览并写入
    const fixed = await store.recheck(proposalId, targetSource, { anchorHeading: "## 1. 基准" });
    assert.equal(fixed.proposal.status, "pending");
    assert.deepEqual(fixed.conflicts, []);
    const okPreview = await store.preview(proposalId, targetSource);
    assert.deepEqual(okPreview.conflicts, []);
    const applied = await store.apply(okPreview.token);
    assert.equal(applied.proposal.status, "approved");

    // 2. 已 approved 指纹重复捕获应折叠，不得再建新提案
    const dupAfterApproved = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "补充新条款 B",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 1. 基准",
      afterSnippet: "- 新条款 B：主操作面板保持 1.2m–2.0m 视距。",
      evidence: [{ sourceLabel: "重复", summary: "应去重" }],
    });
    assert.equal(dupAfterApproved.outcome, "duplicate");

    // 3. reject -> reopen -> archive 全状态流转
    const second = await store.capture({
      channel: "session-capture",
      targetKind: "rule",
      operation: "add-item",
      title: "可重开提案 C",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 1. 基准",
      afterSnippet: "- 条款 C：测试重开与归档。",
      evidence: [{ sourceLabel: "测试", summary: "重开验证" }],
    });
    await store.reject(second.proposal!.id, "暂不纳入");
    const reopened = await store.reopen(second.proposal!.id);
    assert.equal(reopened.status, "pending");
    const archived = await store.archive(second.proposal!.id);
    assert.equal(archived.status, "archived");

    // 4. watchOfficialDocs 拦截 3xx 重定向至内网回环地址（SSRF 防护）
    const ssrfResult = await watchOfficialDocs(
      [
        {
          schemaVersion: 1,
          id: "ssrf-test",
          name: "SSRF 测试源",
          url: "https://docs.example.test/page",
          targetRulepack: "ui-design",
          targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
          keywords: ["test"],
          enabled: true,
        },
      ],
      repoDir,
      {
        fetcher: async () =>
          new Response("", {
            status: 302,
            headers: { location: "http://127.0.0.1:8080/internal" },
          }),
      },
    );
    assert.equal(ssrfResult.failedCount, 1);
    assert.match(ssrfResult.results[0]?.message ?? "", /HTTPS|内网|回环/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
