import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { validateXmindFile } from "../../plugins/zhishu-product-pm/skills/pm-product-structure/scripts/validate-xmind.mjs";
import { checkMarkdownLinks } from "../../plugins/zhishu-fullstack-dev/skills/fs-doc-changelog-sync/scripts/check-markdown-links.mjs";
import { validateConsistency } from "../validate-consistency.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造最小合法 ZIP 缓冲区，供 XMind 校验测试使用。 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(raw);
    const sum = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("XMind 校验器接受合规 XML 结构图并核对原生概要", async () => {
  await withTempDir("zhishu-xmind-ok-", async (dir) => {
    const file = path.join(dir, "ok.xmind");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content version="2.0">
  <sheet id="s1">
    <title>主画布</title>
    <topic id="r1">
      <title>示例产品（Demo）</title>
      <children>
        <topics type="attached">
          <topic id="m1">
            <title>我的项目</title>
            <children>
              <topics type="attached">
                <topic id="c1"><title>添加项目</title></topic>
                <topic id="c2"><title>查看变更</title></topic>
              </topics>
              <topics type="summary">
                <topic id="sum1"><title>变更预览弹窗</title></topic>
              </topics>
            </children>
            <summaries>
              <summary id="sref1" range="(0,1)" topic-id="sum1"/>
            </summaries>
          </topic>
        </topics>
      </children>
    </topic>
  </sheet>
</xmap-content>`;
    await writeFile(file, buildZip({ "content.xml": xml }));
    const result = await validateXmindFile(file, { requireSummary: true });
    assert.equal(result.valid, true);
    assert.equal(result.format, "xmind-xml");
    assert.equal(result.summaryCount, 1);
    assert.equal(result.totalNodes, 4);
  });
});

test("XMind 校验器拦截禁用拼接动词、超长中文节点、架构泄漏与概要越界", async () => {
  await withTempDir("zhishu-xmind-bad-", async (dir) => {
    const file = path.join(dir, "bad.xmind");
    const json = JSON.stringify([
      {
        id: "s1",
        title: "画布1",
        rootTopic: {
          id: "r1",
          title: "示例产品",
          children: {
            attached: [
              { id: "n1", title: "预览变更并应用" },
              { id: "n2", title: "这是一段明显超过七个字的纯中文节点" },
              { id: "n3", title: "左侧导航栏 216px" },
            ],
            summary: [{ id: "sum1", title: "汇总" }],
          },
          summaries: [{ id: "ref1", range: "(0,9)", topicId: "sum1" }],
        },
      },
    ]);
    await writeFile(file, buildZip({ "content.json": json }));
    const result = await validateXmindFile(file);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((x) => x.includes("禁用拼接动词")));
    assert.ok(result.issues.some((x) => x.includes("纯中文节点超过 7 字")));
    assert.ok(result.issues.some((x) => x.includes("技术实现/像素规格")));
    assert.ok(result.issues.some((x) => x.includes("range 越界")));
  });
});

test("Markdown 链接校验脚本能检测失效文件和失效标题锚点", async () => {
  await withTempDir("zhishu-md-links-", async (dir) => {
    await writeFile(path.join(dir, "target.md"), "# 有效章节\n\n正文内容。\n");
    await writeFile(
      path.join(dir, "index.md"),
      "[正常](./target.md#有效章节)\n[缺文件](./missing.md)\n[缺锚点](./target.md#不存在)\n",
    );
    const result = await checkMarkdownLinks(dir);
    assert.equal(result.valid, false);
    assert.equal(result.checkedFiles, 2);
    assert.ok(result.issues.some((x) => x.includes("目标文件不存在")));
    assert.ok(result.issues.some((x) => x.includes("标题锚点不存在")));
  });
});

test("跨文件一致性门禁拦截过期适配器能力与总览错误统计数", async () => {
  await withTempDir("zhishu-consistency-bad-", async (dir) => {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
    await mkdir(path.join(dir, "rulepacks", "common"), { recursive: true });
    await writeFile(path.join(dir, "rulepacks", "common", "pack.json"), JSON.stringify({ id: "common", rules: ["entry.md"] }));
    await mkdir(path.join(dir, "plugins", "demo-plugin", "skills", "demo-skill"), { recursive: true });
    await writeFile(path.join(dir, "plugins", "demo-plugin", "plugin.json"), JSON.stringify({ name: "demo-plugin" }));
    await writeFile(path.join(dir, "plugins", "demo-plugin", "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\n---\n");
    await mkdir(path.join(dir, "schemas"), { recursive: true });
    await writeFile(path.join(dir, "schemas", "a.schema.json"), "{}");
    await writeFile(path.join(dir, "schemas", "b.schema.json"), "{}");

    // 适配器声明与 user-assets.ts 矛盾 + 版本过期
    await mkdir(path.join(dir, "adapters", "demo"), { recursive: true });
    await writeFile(
      path.join(dir, "adapters", "demo", "adapter.json"),
      JSON.stringify({
        id: "demo",
        version: "0.9.0",
        status: "implemented",
        capabilities: { skills: "not-implemented", mcp: "not-implemented" },
        outputs: { projectEntry: "AGENTS.md" },
      }),
    );
    await writeFile(
      path.join(dir, "adapters", "demo", "user-assets.ts"),
      "export function demoSkillRoot() { return ''; }\nexport function demoMcpConfigPath() { return ''; }\n",
    );

    // 总览文档统计数漂移
    await mkdir(path.join(dir, "项目文档", "技术文档"), { recursive: true });
    await writeFile(
      path.join(dir, "项目文档", "技术文档", "README.md"),
      "当前维护 5 套 JSON Schema 与 6 大岗位插件（共 35 个 Skills）。\n",
    );

    const result = await validateConsistency(dir);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((x) => x.includes("与工作区版本")));
    assert.ok(result.issues.some((x) => x.includes("capabilities.skills")));
    assert.ok(result.issues.some((x) => x.includes("capabilities.mcp")));
    assert.ok(result.issues.some((x) => x.includes("5 套 JSON Schema")));
    assert.ok(result.issues.some((x) => x.includes("6 大岗位插件")));
    assert.ok(result.issues.some((x) => x.includes("共 35 个 Skills")));
  });
});

test("当前仓库自身通过跨文件一致性总门禁", async () => {
  const result = await validateConsistency();
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
  assert.ok(result.stats.rulepackCount >= 20);
  assert.ok(result.stats.pluginCount >= 6);
  assert.ok(result.stats.skillCount >= 38);
  assert.ok(result.stats.schemaCount >= 7);
});
