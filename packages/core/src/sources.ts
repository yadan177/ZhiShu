import path from "node:path";

export type SourceTier = "enterprise" | "personal" | "official";
export type SourceAccessKind = "local" | "git" | "github-release";

export interface AssetSourceRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  tier: SourceTier;
  access: SourceAccessKind;
  location: string;
  branch?: string;
  readonly?: boolean;
  requiredRulepacks: string[];
  hasLocalToken?: boolean;
  maskedToken?: string;
  lastSyncedAt?: string;
  localCheckoutPath?: string;
  availableRulepacks?: string[];
}

export interface EnterpriseRequiredPack {
  packId: string;
  sourceIds: string[];
  sourceNames: string[];
}

export const OFFICIAL_SOURCE_ID = "zhishu-official";

export const OFFICIAL_SOURCE_RECORD: AssetSourceRecord = {
  schemaVersion: 1,
  id: OFFICIAL_SOURCE_ID,
  name: "智枢官方源",
  tier: "official",
  access: "github-release",
  location: "yadan177/ZhiShu",
  readonly: true,
  requiredRulepacks: [],
};

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9/-]*$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertValidGitLocation(location: string): void {
  const trimmed = location.trim();
  if (!trimmed || trimmed.startsWith("-") || /[\r\n\0]/.test(trimmed)) {
    throw new Error("Git 仓库地址无效");
  }
  const isHttps = trimmed.startsWith("https://");
  const isSsh = trimmed.startsWith("ssh://") || /^git@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/.test(trimmed);
  const isLocalFile = trimmed.startsWith("file://") || path.isAbsolute(trimmed);
  if (!isHttps && !isSsh && !isLocalFile) {
    throw new Error("Git 仓库地址必须使用 HTTPS、SSH 或绝对路径");
  }
  if (isHttps || trimmed.startsWith("ssh://")) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("Git 仓库地址不是合法 URL");
    }
    if (isHttps && (parsed.username || parsed.password)) {
      throw new Error("Git HTTPS 地址禁止内嵌明文账号或密码，请使用独立访问令牌字段");
    }
    if (trimmed.startsWith("ssh://") && parsed.password) {
      throw new Error("Git SSH 地址禁止内嵌明文密码");
    }
  }
}

export function assertAssetSourceRecord(value: unknown): asserts value is AssetSourceRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("资产来源记录缺少有效的 schemaVersion");
  }
  if (typeof value.id !== "string" || !SOURCE_ID_PATTERN.test(value.id) || FORBIDDEN_KEYS.has(value.id)) {
    throw new Error("来源标识必须为小写字母、数字或连字符");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) {
    throw new Error("来源名称无效");
  }
  if (value.tier !== "enterprise" && value.tier !== "personal" && value.tier !== "official") {
    throw new Error("来源级别仅支持 enterprise、personal 或 official");
  }
  if (value.access !== "local" && value.access !== "git" && value.access !== "github-release") {
    throw new Error("来源接入方式仅支持 local、git 或 github-release");
  }
  if (typeof value.location !== "string" || !value.location.trim()) {
    throw new Error("来源地址不能为空");
  }
  if (value.access === "local" && !path.isAbsolute(value.location)) {
    throw new Error("本地目录来源必须使用绝对路径");
  }
  if (value.access === "git") {
    assertValidGitLocation(value.location);
    if (value.branch !== undefined && (typeof value.branch !== "string" || !BRANCH_PATTERN.test(value.branch) || value.branch.includes(".."))) {
      throw new Error("Git 分支名称不合法");
    }
  }
  if (value.access === "github-release" && !REPO_PATTERN.test(value.location)) {
    throw new Error("GitHub Release 来源必须是有效的 owner/repository");
  }
  if (!Array.isArray(value.requiredRulepacks)) {
    throw new Error("企业必选规则包列表必须是数组");
  }
  const seen = new Set<string>();
  for (const pack of value.requiredRulepacks) {
    if (typeof pack !== "string" || !PACK_ID_PATTERN.test(pack) || pack.includes("//") || pack.endsWith("/") || seen.has(pack)) {
      throw new Error(`企业必选规则包 ID 无效或重复：${String(pack)}`);
    }
    seen.add(pack);
  }
}

export function sortSourcesByPriority(sources: readonly AssetSourceRecord[]): AssetSourceRecord[] {
  const rank: Record<SourceTier, number> = { enterprise: 0, personal: 1, official: 2 };
  return [...sources].sort((left, right) => {
    const diff = rank[left.tier] - rank[right.tier];
    return diff !== 0 ? diff : left.name.localeCompare(right.name);
  });
}

/** 汇总所有企业源声明的必选规则包，用于在项目规则工作台锁定并提示团队必选规范。 */
export function collectEnterpriseRequiredRulepacks(sources: readonly AssetSourceRecord[]): EnterpriseRequiredPack[] {
  const map = new Map<string, { sourceIds: string[]; sourceNames: string[] }>();
  for (const source of sources) {
    if (source.tier !== "enterprise") continue;
    for (const packId of source.requiredRulepacks) {
      const existing = map.get(packId) ?? { sourceIds: [], sourceNames: [] };
      existing.sourceIds.push(source.id);
      existing.sourceNames.push(source.name);
      map.set(packId, existing);
    }
  }
  return [...map.entries()]
    .map(([packId, meta]) => ({ packId, ...meta }))
    .sort((left, right) => left.packId.localeCompare(right.packId));
}
