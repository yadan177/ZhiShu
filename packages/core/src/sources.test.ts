import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_SOURCE_RECORD,
  assertAssetSourceRecord,
  collectEnterpriseRequiredRulepacks,
  sortSourcesByPriority,
  type AssetSourceRecord,
} from "./sources.js";

test("sortSourcesByPriority 始终按 企业源 > 个人源 > 官方源 排序", () => {
  const personal: AssetSourceRecord = {
    schemaVersion: 1,
    id: "my-local",
    name: "我的个人源",
    tier: "personal",
    access: "local",
    location: "/tmp/personal-rules",
    requiredRulepacks: [],
  };
  const enterprise: AssetSourceRecord = {
    schemaVersion: 1,
    id: "corp-xr",
    name: "企业 XR 规范源",
    tier: "enterprise",
    access: "git",
    location: "https://git.corp.example/xr/rules.git",
    branch: "main",
    requiredRulepacks: ["common", "xr-common"],
  };
  const ordered = sortSourcesByPriority([OFFICIAL_SOURCE_RECORD, personal, enterprise]);
  assert.deepEqual(ordered.map((item) => item.tier), ["enterprise", "personal", "official"]);
});

test("collectEnterpriseRequiredRulepacks 只汇总企业源必选规则并忽略个人源", () => {
  const items: AssetSourceRecord[] = [
    {
      schemaVersion: 1,
      id: "corp-a",
      name: "企业源 A",
      tier: "enterprise",
      access: "local",
      location: "/tmp/a",
      requiredRulepacks: ["common", "xr-common"],
    },
    {
      schemaVersion: 1,
      id: "personal-b",
      name: "个人源 B",
      tier: "personal",
      access: "local",
      location: "/tmp/b",
      requiredRulepacks: ["product-pm"],
    },
  ];
  const required = collectEnterpriseRequiredRulepacks(items);
  assert.deepEqual(required.map((item) => item.packId), ["common", "xr-common"]);
  assert.deepEqual(required[0]?.sourceNames, ["企业源 A"]);
});

test("assertAssetSourceRecord 拒绝危险 Git 参数注入与非法分支名", () => {
  assert.throws(() => {
    assertAssetSourceRecord({
      schemaVersion: 1,
      id: "bad-git",
      name: "恶意源",
      tier: "enterprise",
      access: "git",
      location: "--upload-pack=sh",
      requiredRulepacks: [],
    });
  }, /Git 仓库地址无效/);

  assert.throws(() => {
    assertAssetSourceRecord({
      schemaVersion: 1,
      id: "bad-branch",
      name: "非法分支",
      tier: "personal",
      access: "git",
      location: "https://example.com/repo.git",
      branch: "-evil",
      requiredRulepacks: [],
    });
  }, /Git 分支名称不合法/);
});
