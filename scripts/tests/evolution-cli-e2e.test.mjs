import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repository, "packages", "cli", "dist", "index.js");

function runCli(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("CLI zhishu evolve 全链路：capture、脱敏拦截、scan-overrides、preview、apply、reject 与 export", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-evolve-cli-e2e-")));
  try {
    const inbox = path.join(root, "inbox");
    const sourceRepo = path.join(root, "source-repo");
    await mkdir(sourceRepo, { recursive: true });
    await cp(path.join(repository, "rulepacks"), path.join(sourceRepo, "rulepacks"), { recursive: true });

    const targetRel = "rulepacks/common/entry.md";
    const targetAbs = path.join(sourceRepo, targetRel);
    const originalContent = await readFile(targetAbs, "utf8");
    const firstH2 = originalContent.split(/\r?\n/).find((line) => line.startsWith("## ")) ?? "## 通用工作规则";

    // 1. 敏感明文捕获被阻断
    const secretAttempt = runCli(
      "evolve",
      "capture",
      "--inbox",
      inbox,
      "--title",
      "含明文密钥测试",
      "--target-kind",
      "rule",
      "--target-path",
      targetRel,
      "--anchor",
      firstH2,
      "--op",
      "add-item",
      "--after",
      "- 使用 api_key=sk-proj-abcdefghijklmnopqrstuvwxyz123456 调试",
      "--evidence",
      "敏感拦截验证",
    );
    assert.equal(secretAttempt.status, 1);
    assert.match(secretAttempt.stderr, /敏感信息拦截/);

    // 2. 合法通道 1 捕获入箱
    const captured = runCli(
      "evolve",
      "capture",
      "--inbox",
      inbox,
      "--source-workspace",
      sourceRepo,
      "--title",
      "新增自动化回归验证要求",
      "--target-kind",
      "rule",
      "--target-path",
      targetRel,
      "--anchor",
      firstH2,
      "--op",
      "add-item",
      "--after",
      "- 凡涉及多端共享契约变更，必须同步补充端到端自动化验证。",
      "--evidence",
      "代码评审发现接口契约漂移",
    );
    assert.equal(captured.status, 0, `${captured.stdout}\n${captured.stderr}`);
    assert.match(captured.stdout, /已投递至规则进化待审收件箱/);

    // 3. list --json 读取提案 ID
    const listed = runCli("evolve", "list", "--inbox", inbox, "--status", "pending", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    const parsedList = JSON.parse(listed.stdout);
    assert.equal(parsedList.counts.badge, 1);
    const proposalId = parsedList.proposals[0].id;

    // 4. preview 与不带 --apply 的 apply 均不得修改目标规则文件
    const previewRes = runCli("evolve", "preview", proposalId, "--inbox", inbox, "--source-workspace", sourceRepo);
    assert.equal(previewRes.status, 0, previewRes.stderr);
    assert.match(previewRes.stdout, /\+- 凡涉及多端共享契约变更/);
    assert.equal(await readFile(targetAbs, "utf8"), originalContent);

    const dryApplyRes = runCli("evolve", "apply", proposalId, "--inbox", inbox, "--source-workspace", sourceRepo);
    assert.equal(dryApplyRes.status, 0, dryApplyRes.stderr);
    assert.equal(await readFile(targetAbs, "utf8"), originalContent);

    // 5. export 补丁文件，且重复导出拒绝静默覆盖
    const patchPath = path.join(root, "captured.patch");
    const exportRes = runCli(
      "evolve",
      "export",
      proposalId,
      "--inbox",
      inbox,
      "--source-workspace",
      sourceRepo,
      "--out",
      patchPath,
    );
    assert.equal(exportRes.status, 0, exportRes.stderr);
    assert.match(await readFile(patchPath, "utf8"), /凡涉及多端共享契约变更/);
    const exportAgain = runCli("evolve", "export", proposalId, "--inbox", inbox, "--out", patchPath);
    assert.equal(exportAgain.status, 1);
    assert.match(exportAgain.stderr, /拒绝静默覆盖/);

    // 6. apply --apply 显式批准写入并通过自动门禁
    const applied = runCli("evolve", "apply", proposalId, "--inbox", inbox, "--source-workspace", sourceRepo, "--apply");
    assert.equal(applied.status, 0, `${applied.stdout}\n${applied.stderr}`);
    assert.match(applied.stdout, /已原子写入并完成自动化门禁校验/);
    assert.match(await readFile(targetAbs, "utf8"), /凡涉及多端共享契约变更/);

    // 7. scan-overrides 只读扫描两个项目共性覆盖并支持 reject
    const p1 = path.join(root, "p1");
    const p2 = path.join(root, "p2");
    await mkdir(path.join(p1, ".agent-rules"), { recursive: true });
    await mkdir(path.join(p2, ".agent-rules"), { recursive: true });
    const ovrText = "# 本地覆盖\n- 所有后台长任务必须绑定超时取消句柄并打印清晰退出原因。\n";
    await writeFile(path.join(p1, ".agent-rules/overrides.md"), ovrText, "utf8");
    await writeFile(path.join(p2, ".agent-rules/overrides.md"), ovrText, "utf8");

    const scanned = runCli("evolve", "scan-overrides", p1, p2, "--inbox", inbox, "--source-workspace", sourceRepo);
    assert.equal(scanned.status, 0, scanned.stderr);
    assert.match(scanned.stdout, /新增 1 条升格提案/);
    assert.equal(await readFile(path.join(p1, ".agent-rules/overrides.md"), "utf8"), ovrText);

    const listAfterScan = JSON.parse(runCli("evolve", "list", "--inbox", inbox, "--status", "pending", "--json").stdout);
    assert.equal(listAfterScan.proposals.length, 1);
    const rejected = runCli("evolve", "reject", listAfterScan.proposals[0].id, "--inbox", inbox, "--reason", "暂不升格");
    assert.equal(rejected.status, 0, rejected.stderr);
    assert.match(rejected.stdout, /已驳回提案/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
