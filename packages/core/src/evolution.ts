import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { assetDigest, assertAssetDirectory } from "./user-assets.js";

export type EvolutionChannel = "session-capture" | "overrides-promotion" | "docs-watch";
export type EvolutionTargetKind = "rule" | "skill";
export type EvolutionOperation = "add-item" | "update-item" | "deprecate-item";
export type EvolutionStatus = "pending" | "conflict" | "stale" | "approved" | "rejected" | "archived";

export interface EvolutionEvidence {
  sourceLabel: string;
  summary: string;
  url?: string;
  verifiedAt?: string;
  projectNames?: string[];
}

export interface EvolutionAppliedReceipt {
  sourceId: string;
  sourceName: string;
  targetFilePath: string;
  appliedAt: string;
  beforeDigest: string;
  afterDigest: string;
  validated: boolean;
}

export interface EvolutionProposal {
  schemaVersion: 1;
  id: string;
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  status: EvolutionStatus;
  title: string;
  summary?: string;
  targetRulepack?: string;
  targetPath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  evidence: EvolutionEvidence[];
  fingerprint: string;
  targetBaseDigest?: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  rejectionReason?: string;
  conflictMessages?: string[];
  appliedReceipt?: EvolutionAppliedReceipt;
}

export interface CaptureProposalInput {
  id?: string;
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  title: string;
  summary?: string;
  targetRulepack?: string;
  targetPath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  evidence: EvolutionEvidence[];
  targetBaseDigest?: string;
  createdAt?: string;
}

export interface WatchSourceConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  url: string;
  targetRulepack: string;
  targetPath: string;
  anchorHeading?: string;
  keywords: string[];
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus?: "ok" | "error";
  lastMessage?: string;
}

export interface EvolutionCounts {
  badge: number;
  pendingTab: number;
  conflictTab: number;
  processedTab: number;
  total: number;
}

export interface EvolutionListResult {
  proposals: EvolutionProposal[];
  counts: EvolutionCounts;
}

export interface EvolutionTargetSource {
  id: string;
  name: string;
  root?: string;
  readonly?: boolean;
}

export interface SimilarRuleMatch {
  lineNumber: number;
  text: string;
  similarity: number;
}

export interface AtomicPatchResult {
  applied: boolean;
  beforeContent: string;
  afterContent: string;
  beforeDigest: string;
  afterDigest: string;
  lineCountBefore: number;
  lineCountAfter: number;
  lineBudget: number;
  overBudget: boolean;
  similarItems: SimilarRuleMatch[];
  conflicts: string[];
}

export interface EvolutionPatchEdit {
  anchorHeading?: string;
  beforeSnippet?: string;
  afterSnippet?: string;
}

export interface EvolutionPreview {
  token: string;
  proposalId: string;
  title: string;
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  targetSource: EvolutionTargetSource;
  targetPath: string;
  targetFilePath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  beforeContent: string;
  afterContent: string;
  beforeDigest: string;
  afterDigest: string;
  lineCountBefore: number;
  lineCountAfter: number;
  lineBudget: number;
  overBudget: boolean;
  similarItems: SimilarRuleMatch[];
  conflicts: string[];
  validationChecks: string[];
}

export interface EvolutionPostWriteContext {
  sourceRoot: string;
  targetPath: string;
  targetKind: EvolutionTargetKind;
  targetFilePath: string;
}

export type EvolutionPostWriteValidator = (
  context: EvolutionPostWriteContext,
) => Promise<{ valid: boolean; errors: string[] }>;

export interface OverridesScanResult {
  scannedCount: number;
  skippedProjects: { root: string; reason: string }[];
  candidates: CaptureProposalInput[];
}

export interface DocsWatchSourceResult {
  sourceId: string;
  sourceName: string;
  url: string;
  status: "ok" | "error" | "cancelled";
  hasDiff: boolean;
  message: string;
  candidate?: CaptureProposalInput;
}

export interface DocsWatchRunResult {
  checkedCount: number;
  succeededCount: number;
  failedCount: number;
  cancelled: boolean;
  results: DocsWatchSourceResult[];
  candidates: CaptureProposalInput[];
}

export interface CaptureResult {
  outcome: "created" | "duplicate" | "previously-rejected";
  proposal?: EvolutionProposal;
  fingerprint: string;
}

export const EVOLUTION_STALE_DAYS = 30;
export const RULE_LINE_BUDGET = 260;
export const SKILL_LINE_BUDGET = 160;
export const MAX_PROPOSAL_IMPORT_BYTES = 512 * 1024;

export const DEFAULT_WATCH_SOURCES: readonly WatchSourceConfig[] = [
  {
    schemaVersion: 1,
    id: "apple-visionos-hig",
    name: "Apple visionOS HIG",
    url: "https://developer.apple.com/tutorials/data/design/human-interface-guidelines/designing-for-visionos.json",
    targetRulepack: "ui-design",
    targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
    anchorHeading: "## 2. 空间尺度、视距与角尺寸换算",
    keywords: ["60pt", "44pt", "ornament", "window", "passthrough", "field of view"],
    enabled: true,
  },
  {
    schemaVersion: 1,
    id: "meta-horizon-spatial",
    name: "Meta Horizon OS 空间设计",
    url: "https://developers.meta.com/horizon/design/",
    targetRulepack: "ui-design",
    targetPath: "rulepacks/ui-design/其他规则/08-XR空间布局与摆放架构规范.md",
    anchorHeading: "## 6. 主流设备与平台差异适配矩阵",
    keywords: ["Horizon OS", "dmm", "Quest", "passthrough", "spatial"],
    enabled: true,
  },
  {
    schemaVersion: 1,
    id: "pico-unity-sdk",
    name: "PICO Unity XR SDK",
    url: "https://developer.picoxr.com/document/unity/",
    targetRulepack: "pico",
    targetPath: "rulepacks/pico/PICO Unity SDK.md",
    anchorHeading: "## 3. 版本与来源记录",
    keywords: ["PICO", "OpenXR", "PXR", "Unity", "Spatial"],
    enabled: true,
  },
  {
    schemaVersion: 1,
    id: "typescript-tsconfig",
    name: "TypeScript tsconfig 参考",
    url: "https://www.typescriptlang.org/tsconfig/",
    targetRulepack: "typescript",
    targetPath: "rulepacks/typescript/其他规则/06-tsconfig 严格度.md",
    anchorHeading: "## 2. 🟡 推荐 · 团队约定",
    keywords: ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "verbatimModuleSyntax", "erasableSyntaxOnly"],
    enabled: true,
  },
];

const PROPOSAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const WATCH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9/-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CHANNELS: readonly EvolutionChannel[] = ["session-capture", "overrides-promotion", "docs-watch"];
const TARGET_KINDS: readonly EvolutionTargetKind[] = ["rule", "skill"];
const OPERATIONS: readonly EvolutionOperation[] = ["add-item", "update-item", "deprecate-item"];
const STATUSES: readonly EvolutionStatus[] = ["pending", "conflict", "stale", "approved", "rejected", "archived"];

const SECRET_PATTERNS: readonly { label: string; regex: RegExp }[] = [
  { label: "GitHub Token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { label: "GitHub Fine-Grained PAT", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: "OpenAI / API Key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "Slack Token", regex: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
  { label: "AWS Access Key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Google API Key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { label: "Feishu App ID/Secret", regex: /\bcli_a[0-9a-fA-F]{12,}\b/ },
  { label: "私钥块", regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { label: "Bearer 凭据", regex: /\bBearer\s+(?!<|\$\{|YOUR_|EXAMPLE)[A-Za-z0-9._/+=-]{14,}\b/i },
  {
    label: "明文密钥赋值",
    regex:
      /\b(?:app[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|password|passwd)\b\s*[:=]\s*["']?(?!<|\$\{|YOUR_|EXAMPLE|REPLACE|\*{3,}|xxx+)[A-Za-z0-9._/+=-]{8,}["']?/i,
  },
];

const PRIVATE_HOME_PATH_PATTERN = /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWriteFile(filePath: string, content: string | Buffer, mode = 0o600): Promise<void> {
  await assertAssetDirectory(path.dirname(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await pathExists(filePath)) {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`目标文件不是普通文件：${filePath}`);
    }
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertNoSymlinkBelow(rootDir: string, relativePosixPath: string): Promise<string> {
  const rootInfo = await lstat(rootDir);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`目标源根目录不是普通目录：${rootDir}`);
  }
  const realRoot = await realpath(rootDir);
  const parts = relativePosixPath.split("/").filter(Boolean);
  let current = realRoot;
  for (const part of parts) {
    current = path.join(current, part);
    if (await pathExists(current)) {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`目标路径包含符号链接，已拒绝访问：${relativePosixPath}`);
      }
    }
  }
  const normalizedTarget = path.resolve(realRoot, relativePosixPath);
  if (normalizedTarget !== realRoot && !normalizedTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`目标路径越出规则源根目录：${relativePosixPath}`);
  }
  return normalizedTarget;
}

/** 校验提案相对路径：仅允许 rulepacks/ 或 plugins/ 下的 .md 文件，防止路径穿越。 */
export function assertSafeEvolutionTargetPath(targetPath: string, targetKind: EvolutionTargetKind): string {
  const normalized = targetPath.trim();
  if (
    !normalized ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.endsWith("/")
  ) {
    throw new Error(`目标路径不合法：${targetPath}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`目标路径不得包含越界段：${targetPath}`);
  }
  if (!normalized.endsWith(".md")) {
    throw new Error("进化提案仅允许修订 Markdown 规则或 SKILL.md 文档");
  }
  const requiredPrefix = targetKind === "rule" ? "rulepacks/" : "plugins/";
  if (!normalized.startsWith(requiredPrefix)) {
    throw new Error(`${targetKind === "rule" ? "规则" : "技能"}提案的目标路径必须位于 ${requiredPrefix} 下`);
  }
  return normalized;
}

/** 校验官方文档巡检地址：强制 HTTPS 且拦截本机/内网地址（防 SSRF）。 */
export function assertSafeWatchUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`巡检地址格式无效：${rawUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("巡检地址必须使用 HTTPS 协议");
  }
  if (parsed.username || parsed.password) {
    throw new Error("巡检地址不得包含凭据信息");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?(?:fc|fd|fe80)/i.test(host)
  ) {
    throw new Error(`巡检地址禁止指向本机或内网主机：${host}`);
  }
  return parsed.toString();
}

/** 检测提案文本中是否包含明文密钥、私钥或补丁正文中的本机私有绝对路径。 */
export function detectSensitiveContent(payload: {
  title?: string;
  summary?: string;
  anchorHeading?: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  evidence?: readonly EvolutionEvidence[];
}): string[] {
  const findings: string[] = [];
  const allTexts: { field: string; text: string }[] = [];
  if (payload.title) allTexts.push({ field: "标题", text: payload.title });
  if (payload.summary) allTexts.push({ field: "摘要", text: payload.summary });
  if (payload.anchorHeading) allTexts.push({ field: "锚点章节", text: payload.anchorHeading });
  if (payload.beforeSnippet) allTexts.push({ field: "变更前片段", text: payload.beforeSnippet });
  if (payload.afterSnippet) allTexts.push({ field: "变更后片段", text: payload.afterSnippet });
  if (payload.evidence) {
    for (const item of payload.evidence) {
      allTexts.push({ field: "证据来源", text: item.sourceLabel });
      allTexts.push({ field: "证据摘要", text: item.summary });
      if (item.url) allTexts.push({ field: "证据链接", text: item.url });
    }
  }

  for (const { field, text } of allTexts) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(text)) {
        findings.push(`${field}包含疑似明文凭据（${pattern.label}）`);
      }
    }
  }

  for (const { field, text } of [
    { field: "变更前片段", text: payload.beforeSnippet ?? "" },
    { field: "变更后片段", text: payload.afterSnippet ?? "" },
  ]) {
    if (text && PRIVATE_HOME_PATH_PATTERN.test(text)) {
      findings.push(`${field}包含本机私有绝对路径，请改用相对路径或占位符`);
    }
  }

  return [...new Set(findings)];
}

function normalizeForFingerprint(value: string | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function computeProposalFingerprint(input: {
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  targetPath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
}): string {
  const canonical = [
    input.channel,
    input.targetKind,
    input.operation,
    input.targetPath.trim(),
    normalizeForFingerprint(input.anchorHeading),
    normalizeForFingerprint(input.beforeSnippet),
    normalizeForFingerprint(input.afterSnippet),
  ].join("\n|\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function generateProposalId(channel: EvolutionChannel, title: string): string {
  const prefix = channel === "session-capture" ? "cap" : channel === "overrides-promotion" ? "ovr" : "doc";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomUUID().slice(0, 8);
  return `${prefix}-${stamp}-${slug ? `${slug}-` : ""}${suffix}`;
}

export function assertEvolutionProposal(value: unknown): asserts value is EvolutionProposal {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("进化提案缺少有效的 schemaVersion");
  }
  if (typeof value.id !== "string" || !PROPOSAL_ID_PATTERN.test(value.id) || FORBIDDEN_KEYS.has(value.id)) {
    throw new Error(`进化提案 ID 无效：${String(value.id)}`);
  }
  if (!CHANNELS.includes(value.channel as EvolutionChannel)) {
    throw new Error(`不支持的进化通道：${String(value.channel)}`);
  }
  if (!TARGET_KINDS.includes(value.targetKind as EvolutionTargetKind)) {
    throw new Error(`不支持的目标资产类型：${String(value.targetKind)}`);
  }
  if (!OPERATIONS.includes(value.operation as EvolutionOperation)) {
    throw new Error(`不支持的增量操作类型：${String(value.operation)}`);
  }
  if (!STATUSES.includes(value.status as EvolutionStatus)) {
    throw new Error(`不支持的提案状态：${String(value.status)}`);
  }
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) {
    throw new Error("进化提案标题不能为空且不超过 120 字");
  }
  if (typeof value.targetPath !== "string") {
    throw new Error("进化提案缺少目标文件路径");
  }
  assertSafeEvolutionTargetPath(value.targetPath, value.targetKind as EvolutionTargetKind);
  if (typeof value.anchorHeading !== "string" || !value.anchorHeading.trim() || value.anchorHeading.length > 200) {
    throw new Error("进化提案必须提供有效的目标章节锚点（anchorHeading）");
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new Error("进化提案必须至少包含 1 条证据来源");
  }
  for (const ev of value.evidence) {
    if (!isRecord(ev) || typeof ev.sourceLabel !== "string" || !ev.sourceLabel.trim() || typeof ev.summary !== "string" || !ev.summary.trim()) {
      throw new Error("进化提案证据项缺少 sourceLabel 或 summary");
    }
    if (ev.url !== undefined && (typeof ev.url !== "string" || !ev.url.startsWith("https://"))) {
      throw new Error("进化提案证据链接必须使用 HTTPS");
    }
  }
  if (typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)) {
    throw new Error("进化提案指纹无效");
  }
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    throw new Error("进化提案缺少时间戳");
  }
}

export function assertWatchSourceConfig(value: unknown): asserts value is WatchSourceConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("巡检源配置缺少有效的 schemaVersion");
  }
  if (typeof value.id !== "string" || !WATCH_ID_PATTERN.test(value.id) || FORBIDDEN_KEYS.has(value.id)) {
    throw new Error(`巡检源标识无效：${String(value.id)}`);
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) {
    throw new Error("巡检源名称无效");
  }
  if (typeof value.url !== "string") {
    throw new Error("巡检源 URL 缺失");
  }
  assertSafeWatchUrl(value.url);
  if (typeof value.targetRulepack !== "string" || !PACK_ID_PATTERN.test(value.targetRulepack)) {
    throw new Error(`巡检源关联规则包无效：${String(value.targetRulepack)}`);
  }
  if (typeof value.targetPath !== "string") {
    throw new Error("巡检源目标规则路径缺失");
  }
  assertSafeEvolutionTargetPath(value.targetPath, value.targetPath.startsWith("plugins/") ? "skill" : "rule");
  if (!Array.isArray(value.keywords) || value.keywords.some((kw) => typeof kw !== "string" || !kw.trim())) {
    throw new Error("巡检源关键词列表无效");
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error("巡检源启停字段必须是布尔值");
  }
}

/** 切分中英文特征词（英文词 + 中文二元组），用于查重与跨项目共性聚类。 */
export function extractSemanticTokens(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[`*_>#~[\]()]/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const tokens = new Set<string>();
  for (const match of cleaned.matchAll(/[a-z0-9][a-z0-9._-]{1,}/g)) {
    tokens.add(match[0]);
  }
  for (const match of cleaned.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const seq = match[0];
    if (seq.length <= 4) tokens.add(seq);
    for (let i = 0; i < seq.length - 1; i++) {
      tokens.add(seq.slice(i, i + 2));
    }
  }
  return tokens;
}

export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findSimilarLines(content: string, candidateText: string | undefined, excludeText?: string): SimilarRuleMatch[] {
  if (!candidateText?.trim()) return [];
  const candidateTokens = extractSemanticTokens(candidateText);
  if (candidateTokens.size < 2) return [];
  const excludedNormalized = excludeText ? normalizeForFingerprint(excludeText) : "";
  const lines = normalizeNewlines(content).split("\n");
  const matches: SimilarRuleMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.length < 10) continue;
    if (excludedNormalized && normalizeForFingerprint(trimmed) === excludedNormalized) continue;
    const score = jaccardSimilarity(candidateTokens, extractSemanticTokens(trimmed));
    if (score >= 0.45) {
      matches.push({
        lineNumber: i + 1,
        text: trimmed.length > 110 ? `${trimmed.slice(0, 107)}...` : trimmed,
        similarity: Number(score.toFixed(2)),
      });
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

function parseHeadingLine(line: string): { level: number; text: string; raw: string } | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line.trim());
  if (!match || !match[1] || !match[2]) return undefined;
  return { level: match[1].length, text: match[2].trim(), raw: `${match[1]} ${match[2].trim()}` };
}

function locateAnchoredSection(
  lines: readonly string[],
  anchorHeading: string,
): { startLine: number; endLine: number; level: number } | undefined {
  const trimmedAnchor = anchorHeading.trim();
  const parsedAnchor = parseHeadingLine(trimmedAnchor);
  let inFence = false;
  let startLine = -1;
  let anchorLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = parseHeadingLine(line);
    if (!heading) continue;

    if (startLine < 0) {
      const matched = parsedAnchor
        ? heading.level === parsedAnchor.level && heading.text === parsedAnchor.text
        : heading.text === trimmedAnchor || heading.raw === trimmedAnchor;
      if (matched) {
        startLine = i;
        anchorLevel = heading.level;
      }
    } else if (heading.level <= anchorLevel) {
      return { startLine, endLine: i, level: anchorLevel };
    }
  }

  if (startLine >= 0) {
    return { startLine, endLine: lines.length, level: anchorLevel };
  }
  return undefined;
}

/**
 * ACE 原子增量补丁计算器：仅在锚点章节范围内执行 add-item / update-item / deprecate-item，
 * 绝不整篇覆盖目标规则或技能正文。
 */
export function computeAtomicDeltaPatch(
  currentContent: string,
  proposal: Pick<EvolutionProposal, "targetKind" | "operation" | "anchorHeading" | "beforeSnippet" | "afterSnippet">,
  expectedBaseDigest?: string,
): AtomicPatchResult {
  const normalizedContent = normalizeNewlines(currentContent);
  const hadTrailingNewline = normalizedContent.endsWith("\n");
  const lines = hadTrailingNewline ? normalizedContent.slice(0, -1).split("\n") : normalizedContent.split("\n");
  const beforeDigest = assetDigest(currentContent);
  const lineBudget = proposal.targetKind === "skill" ? SKILL_LINE_BUDGET : RULE_LINE_BUDGET;
  const conflicts: string[] = [];

  if (expectedBaseDigest && expectedBaseDigest !== beforeDigest) {
    conflicts.push(
      `[BASE_DIGEST_DRIFT] 目标文件自提案生成后已发生修改（当前摘要 ${beforeDigest.slice(0, 19)}），请先点击「重新检测」刷新指纹`,
    );
  }

  const similarItems = findSimilarLines(normalizedContent, proposal.afterSnippet, proposal.beforeSnippet);
  const section = locateAnchoredSection(lines, proposal.anchorHeading);
  if (!section) {
    conflicts.push(`[ANCHOR_NOT_FOUND] 目标文件中未找到锚点章节「${proposal.anchorHeading}」`);
    return {
      applied: false,
      beforeContent: currentContent,
      afterContent: currentContent,
      beforeDigest,
      afterDigest: beforeDigest,
      lineCountBefore: lines.length,
      lineCountAfter: lines.length,
      lineBudget,
      overBudget: lines.length > lineBudget,
      similarItems,
      conflicts,
    };
  }

  const sectionLines = lines.slice(section.startLine + 1, section.endLine);
  const sectionText = sectionLines.join("\n");
  let nextSectionText = sectionText;

  if (proposal.operation === "add-item") {
    const snippet = normalizeNewlines(proposal.afterSnippet ?? "").trim();
    if (!snippet) {
      conflicts.push("[EMPTY_PATCH] 新增条款（add-item）缺少变更后内容（afterSnippet）");
    } else if (sectionText.includes(snippet)) {
      conflicts.push("[DUPLICATE_ITEM] 目标章节已存在完全相同的条款，无需重复追加");
    } else {
      let insertIndex = sectionLines.length;
      while (insertIndex > 0 && (sectionLines[insertIndex - 1] ?? "").trim() === "") {
        insertIndex--;
      }
      const nextLines = [...sectionLines];
      const snippetLines = snippet.split("\n");
      nextLines.splice(insertIndex, 0, ...snippetLines);
      nextSectionText = nextLines.join("\n");
    }
  } else if (proposal.operation === "update-item") {
    const before = normalizeNewlines(proposal.beforeSnippet ?? "").trim();
    const after = normalizeNewlines(proposal.afterSnippet ?? "").trim();
    if (!before || !after) {
      conflicts.push("[INVALID_UPDATE_PATCH] 修订条款（update-item）必须同时提供变更前与变更后片段");
    } else {
      const firstIndex = sectionText.indexOf(before);
      if (firstIndex < 0) {
        conflicts.push("[ANCHOR_DRIFT] 目标章节内未找到待修订的原文片段，文件内容可能已漂移");
      } else if (sectionText.indexOf(before, firstIndex + before.length) >= 0) {
        conflicts.push("[AMBIGUOUS_MATCH] 目标章节存在多处相同片段，请提供更精确的上下文后再修订");
      } else {
        nextSectionText = `${sectionText.slice(0, firstIndex)}${after}${sectionText.slice(firstIndex + before.length)}`;
      }
    }
  } else {
    // deprecate-item
    const before = normalizeNewlines(proposal.beforeSnippet ?? "").trim();
    const after = normalizeNewlines(proposal.afterSnippet ?? "").trim();
    if (!before) {
      conflicts.push("[INVALID_DEPRECATE_PATCH] 废弃条款（deprecate-item）必须提供待废弃的原文片段");
    } else {
      const firstIndex = sectionText.indexOf(before);
      if (firstIndex < 0) {
        conflicts.push("[ANCHOR_DRIFT] 目标章节内未找到待废弃的原文片段，文件内容可能已漂移");
      } else if (sectionText.indexOf(before, firstIndex + before.length) >= 0) {
        conflicts.push("[AMBIGUOUS_MATCH] 目标章节存在多处匹配片段，无法唯一确定废弃位置");
      } else if (after) {
        nextSectionText = `${sectionText.slice(0, firstIndex)}${after}${sectionText.slice(firstIndex + before.length)}`;
      } else {
        const beforePart = sectionText.slice(0, firstIndex).replace(/\n+$/, "");
        const afterPart = sectionText.slice(firstIndex + before.length).replace(/^\n+/, "");
        nextSectionText = beforePart && afterPart ? `${beforePart}\n${afterPart}` : beforePart || afterPart;
      }
    }
  }

  const rebuiltLines = [
    ...lines.slice(0, section.startLine + 1),
    ...(nextSectionText === "" ? [] : nextSectionText.split("\n")),
    ...lines.slice(section.endLine),
  ];
  const afterContent = `${rebuiltLines.join("\n")}${hadTrailingNewline ? "\n" : ""}`;
  const afterDigest = assetDigest(afterContent);

  return {
    applied: conflicts.length === 0,
    beforeContent: currentContent,
    afterContent,
    beforeDigest,
    afterDigest,
    lineCountBefore: lines.length,
    lineCountAfter: rebuiltLines.length,
    lineBudget,
    overBudget: rebuiltLines.length > lineBudget,
    similarItems,
    conflicts,
  };
}

function inferRulepackTargetFromText(text: string): { targetRulepack: string; targetPath: string; anchorHeading: string } {
  const lower = text.toLowerCase();
  if (/(visionos|horizon|quest|空间界面|空间布局|dmm|视距|视野角|头显)/.test(lower)) {
    return {
      targetRulepack: "ui-design",
      targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
      anchorHeading: "## 2. 空间尺度、视距与角尺寸换算",
    };
  }
  if (/(pico|pxr|openxr)/.test(lower)) {
    return {
      targetRulepack: "pico",
      targetPath: "rulepacks/pico/PICO Unity SDK.md",
      anchorHeading: "## 2. 候选路线识别",
    };
  }
  if (/(unity|monobehaviour|shader|urp|hdrp|prefab)/.test(lower)) {
    return {
      targetRulepack: "unity",
      targetPath: "rulepacks/unity/00-文档总览.md",
      anchorHeading: "## 1. 核心原则",
    };
  }
  if (/(typescript|\bts\b|tsconfig|类型守卫|unknown|noexplicitany|any)/.test(lower)) {
    return {
      targetRulepack: "typescript",
      targetPath: "rulepacks/typescript/其他规则/08-常见反模式与 AI 自检.md",
      anchorHeading: "## 1. 🔴 高风险反模式与适用边界",
    };
  }
  if (/(javascript|\bjs\b|esm|node:test|promise|async)/.test(lower)) {
    return {
      targetRulepack: "javascript",
      targetPath: "rulepacks/javascript/15-AI通用入口规则.md",
      anchorHeading: "## 3. 变更边界",
    };
  }
  if (/(golang|\bgo\b|goroutine|context\.context|defer)/.test(lower)) {
    return {
      targetRulepack: "go",
      targetPath: "rulepacks/go/13-AI通用入口规则.md",
      anchorHeading: "## 3. 变更边界",
    };
  }
  if (/(python|pytest|pydantic|venv|typing)/.test(lower)) {
    return {
      targetRulepack: "python",
      targetPath: "rulepacks/python/14-AI通用入口规则.md",
      anchorHeading: "## 3. 变更边界",
    };
  }
  if (/(prd|需求文档|泳道图|验收标准|产品结构)/.test(lower)) {
    return {
      targetRulepack: "product-pm",
      targetPath: "rulepacks/product-pm/15-AI通用入口规则.md",
      anchorHeading: "## 3. 决策与边界约束",
    };
  }
  if (/(figma|设计令牌|设计系统|无障碍|wcag|下拉框|dropdown)/.test(lower)) {
    return {
      targetRulepack: "ui-design",
      targetPath: "rulepacks/ui-design/其他规则/02-交互设计规则.md",
      anchorHeading: "## 2. 任务流程与 UI 覆盖",
    };
  }
  return {
    targetRulepack: "common",
    targetPath: "rulepacks/common/entry.md",
    anchorHeading: "## 1. 优先级",
  };
}

function isProjectSpecificOverrideLine(line: string): boolean {
  if (/\[仅本项目\]|仅限本项目|本项目专属|仅适用于本仓库/.test(line)) return true;
  if (PRIVATE_HOME_PATH_PATTERN.test(line)) return true;
  if (/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|\.internal\b)/.test(line)) return true;
  if (SECRET_PATTERNS.some((pattern) => pattern.regex.test(line))) return true;
  return false;
}

function isPlaceholderOverrideLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 8) return true;
  if (/^(?:在此补充|暂无项目本地覆盖|示例[:：]|待补充|TODO|TBD)/i.test(trimmed)) return true;
  if (/^记录本项目特有/.test(trimmed)) return true;
  return false;
}

function extractOverrideItems(content: string): string[] {
  const cleaned = normalizeNewlines(content).replace(/<!--[\s\S]*?-->/g, "");
  const items: string[] = [];
  let inFence = false;
  for (const rawLine of cleaned.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const bulletMatch = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(rawLine);
    if (!bulletMatch || !bulletMatch[1]) continue;
    const text = bulletMatch[1].trim();
    if (isPlaceholderOverrideLine(text) || isProjectSpecificOverrideLine(text)) continue;
    items.push(text);
  }
  return items;
}

/**
 * 通道 2：只读扫描多个项目的 `.agent-rules/overrides.md`，聚类跨项目共性条款（默认 >= 2 个项目命中）
 * 并产出升格提案草稿。严禁修改任何原项目文件。
 */
export async function scanOverridesForPromotions(
  projectRoots: readonly string[],
  options: { minProjects?: number; targetSourceRoot?: string } = {},
): Promise<OverridesScanResult> {
  const minProjects = Math.max(2, options.minProjects ?? 2);
  const skippedProjects: { root: string; reason: string }[] = [];
  let scannedCount = 0;

  interface ExtractedEntry {
    projectRoot: string;
    projectName: string;
    text: string;
    tokens: Set<string>;
  }
  const entries: ExtractedEntry[] = [];

  for (const root of projectRoots) {
    const overridesPath = path.join(root, ".agent-rules", "overrides.md");
    try {
      const rootStat = await lstat(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        skippedProjects.push({ root, reason: "项目目录不存在或为符号链接" });
        continue;
      }
      const fileStat = await lstat(overridesPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        skippedProjects.push({ root, reason: "overrides.md 不是普通文件" });
        continue;
      }
      const content = await readFile(overridesPath, "utf8");
      scannedCount++;
      const projectName = path.basename(root) || root;
      for (const item of extractOverrideItems(content)) {
        const tokens = extractSemanticTokens(item);
        if (tokens.size >= 2) {
          entries.push({ projectRoot: root, projectName, text: item, tokens });
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      skippedProjects.push({
        root,
        reason: code === "ENOENT" ? "未找到 .agent-rules/overrides.md" : error instanceof Error ? error.message : String(error),
      });
    }
  }

  interface Cluster {
    representative: ExtractedEntry;
    members: ExtractedEntry[];
    projects: Set<string>;
    projectNames: Set<string>;
  }
  const clusters: Cluster[] = [];

  for (const entry of entries) {
    let bestCluster: Cluster | undefined;
    let bestScore = 0;
    for (const cluster of clusters) {
      const score = jaccardSimilarity(entry.tokens, cluster.representative.tokens);
      if (score >= 0.42 && score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }
    if (bestCluster) {
      bestCluster.members.push(entry);
      bestCluster.projects.add(entry.projectRoot);
      bestCluster.projectNames.add(entry.projectName);
    } else {
      clusters.push({
        representative: entry,
        members: [entry],
        projects: new Set([entry.projectRoot]),
        projectNames: new Set([entry.projectName]),
      });
    }
  }

  const candidates: CaptureProposalInput[] = [];
  for (const cluster of clusters) {
    if (cluster.projects.size < minProjects) continue;
    const ruleText = cluster.representative.text;
    const inferred = inferRulepackTargetFromText(ruleText);
    const resolvedAnchor = await resolveAvailableHeading(
      options.targetSourceRoot,
      inferred.targetPath,
      inferred.anchorHeading,
    );
    const projectList = [...cluster.projectNames].sort((a, b) => a.localeCompare(b));
    const titleBase = ruleText.replace(/[`*_]/g, "").slice(0, 48);
    candidates.push({
      channel: "overrides-promotion",
      targetKind: "rule",
      operation: "add-item",
      title: `升格共性覆盖：${titleBase}${ruleText.length > 48 ? "…" : ""}`,
      summary: `在 ${projectList.length} 个项目的 overrides.md 中发现同类共性约束，建议升格至 ${inferred.targetRulepack} 共享规则。`,
      targetRulepack: inferred.targetRulepack,
      targetPath: inferred.targetPath,
      anchorHeading: resolvedAnchor,
      afterSnippet: `- ${ruleText}`,
      evidence: [
        {
          sourceLabel: `跨项目覆盖扫描（命中 ${projectList.length} 个项目）`,
          summary: cluster.members.map((m) => `[${m.projectName}] ${m.text}`).join("\n"),
          verifiedAt: new Date().toISOString().slice(0, 10),
          projectNames: projectList,
        },
      ],
    });
  }

  return { scannedCount, skippedProjects, candidates };
}

async function resolveAvailableHeading(
  sourceRoot: string | undefined,
  targetPath: string,
  preferredHeading: string,
): Promise<string> {
  if (!sourceRoot) return preferredHeading;
  try {
    const filePath = await assertNoSymlinkBelow(sourceRoot, targetPath);
    const content = await readFile(filePath, "utf8");
    const lines = normalizeNewlines(content).split("\n");
    if (locateAnchoredSection(lines, preferredHeading)) return preferredHeading;
    // 回退到目标文档中首个二级标题（若无则首个一级标题），保证提案锚点真实命中
    let firstH1: string | undefined;
    for (const line of lines) {
      const heading = parseHeadingLine(line);
      if (!heading) continue;
      if (heading.level === 2) return heading.raw;
      if (heading.level === 1 && !firstH1) firstH1 = heading.raw;
    }
    return firstH1 ?? preferredHeading;
  } catch {
    return preferredHeading;
  }
}

function extractJsonDocText(rawJson: string): { title: string; text: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!isRecord(parsed)) return undefined;
    const chunks: string[] = [];
    let title = "";
    if (isRecord(parsed.metadata) && typeof parsed.metadata.title === "string") {
      title = parsed.metadata.title.trim();
    }
    const visit = (node: unknown, depth: number): void => {
      if (depth > 14 || chunks.length > 800) return;
      if (typeof node === "string") {
        const t = node.trim();
        if (t.length >= 6 && !t.startsWith("doc://") && !t.startsWith("/")) chunks.push(t);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (isRecord(node)) {
        if (typeof node.text === "string") chunks.push(node.text.trim());
        if (typeof node.title === "string" && !node.identifier) chunks.push(node.title.trim());
        for (const key of ["abstract", "primaryContentSections", "content", "inlineContent", "items", "sections"]) {
          if (key in node) visit(node[key], depth + 1);
        }
      }
    };
    visit(parsed, 0);
    return { title, text: chunks.filter(Boolean).join("\n") };
  } catch {
    return undefined;
  }
}

function stripHtmlToPlainText(html: string): { title: string; text: string; bodyOnlyText: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const cleanFragment = (fragment: string): string =>
    fragment
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<script\b[\s\S]*$/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<style\b[\s\S]*$/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();

  const bodyOnlyText = cleanFragment(bodyMatch?.[1] ?? html);
  const text = bodyOnlyText || cleanFragment(html);
  return { title, text, bodyOnlyText };
}

function extractVersionAndParamSignals(text: string): Set<string> {
  const signals = new Set<string>();
  const patterns = [
    /\b(?:visionOS|iOS|iPadOS|Horizon OS|PICO OS|Unity|Electron|OpenXR|TypeScript|SDK)\s*v?\d+(?:\.\d+){0,2}\b/gi,
    /\b[1-9]\d*(?:\.\d+)?\s*(?:pt|dmm|Hz|fps)\b/gi,
  ];
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      signals.add(match[0].replace(/\s+/g, " ").trim());
    }
  }
  return signals;
}

/**
 * 通道 3：巡检已配置的外部官方文档，仅在发现与本地规则正文存在明确版本/参数信号差异时产出提案。
 * 支持 AbortSignal 中途取消与单源失败降级（保留其余成功源结果）。
 */
export async function watchOfficialDocs(
  sources: readonly WatchSourceConfig[],
  targetSourceRoot?: string,
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (progress: { completed: number; total: number; currentSourceName: string }) => void;
  } = {},
): Promise<DocsWatchRunResult> {
  const enabledSources = sources.filter((source) => source.enabled);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 12000;
  const results: DocsWatchSourceResult[] = [];
  const candidates: CaptureProposalInput[] = [];
  let cancelled = false;

  for (let index = 0; index < enabledSources.length; index++) {
    const source = enabledSources[index]!;
    if (options.signal?.aborted) {
      cancelled = true;
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        url: source.url,
        status: "cancelled",
        hasDiff: false,
        message: "已取消巡检",
      });
      continue;
    }

    options.onProgress?.({
      completed: index,
      total: enabledSources.length,
      currentSourceName: source.name,
    });

    const controller = new AbortController();
    const timeoutErr = new Error("请求超时");
    timeoutErr.name = "TimeoutError";
    const timer = setTimeout(() => controller.abort(timeoutErr), timeoutMs);
    const onParentAbort = () => controller.abort(options.signal?.reason ?? new Error("用户取消巡检"));
    options.signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const safeUrl = assertSafeWatchUrl(source.url);
      let currentUrl = safeUrl;
      let response: Response | undefined;
      for (let hop = 0; hop <= 5; hop++) {
        const res = await fetcher(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "ZhiShu-DocsWatch/2.2 (+https://github.com/yadan177/ZhiShu)",
            Accept: "text/html, text/markdown, text/plain;q=0.9",
          },
        });
        if (res.status >= 300 && res.status < 400) {
          void res.body?.cancel().catch(() => {});
          const location = res.headers.get("location");
          if (!location) throw new Error("巡检目标重定向缺少 Location 头");
          const nextUrl = new URL(location, currentUrl).toString();
          currentUrl = assertSafeWatchUrl(nextUrl);
          continue;
        }
        response = res;
        break;
      }
      if (!response) throw new Error("巡检目标重定向次数过多，已中止");
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
      }
      const maxBodyBytes = 512 * 1024;
      let rawBody: string;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            const remaining = maxBodyBytes - total;
            if (value.byteLength >= remaining) {
              chunks.push(value.subarray(0, remaining));
              total += remaining;
              await reader.cancel().catch(() => {});
              break;
            }
            chunks.push(value);
            total += value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }
        rawBody = Buffer.concat(chunks).toString("utf8");
      } else {
        rawBody = (await response.text()).slice(0, maxBodyBytes);
      }
      const contentType = response.headers.get("content-type") ?? "";
      const jsonDoc =
        contentType.includes("application/json") || rawBody.trimStart().startsWith("{")
          ? extractJsonDocText(rawBody)
          : undefined;
      const htmlDoc = jsonDoc ? undefined : stripHtmlToPlainText(rawBody);
      const pageTitle = jsonDoc?.title ?? htmlDoc?.title ?? "";
      const plainText = jsonDoc?.text ?? htmlDoc?.bodyOnlyText ?? "";

      if (!plainText.trim()) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          url: safeUrl,
          status: "ok",
          hasDiff: false,
          message: "页面正文为客户端动态渲染，暂未提取到可比对文本信号",
        });
        continue;
      }

      let localRuleText = "";
      if (targetSourceRoot) {
        try {
          const localPath = await assertNoSymlinkBelow(targetSourceRoot, source.targetPath);
          localRuleText = await readFile(localPath, "utf8");
        } catch {
          localRuleText = "";
        }
      }

      if (!localRuleText) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          url: safeUrl,
          status: "ok",
          hasDiff: false,
          message: "未配置可比对的本地规则源（或本地目标文件缺失），已验证远端文档可达",
        });
        continue;
      }

      const remoteSignals = extractVersionAndParamSignals(plainText);
      const localLower = localRuleText.toLowerCase();
      const missingSignals = [...remoteSignals]
        .filter((signal) => {
          const sigLower = signal.toLowerCase();
          if (localLower.includes(sigLower)) return false;
          // 只采纳与巡检关键词同句或高相关版本/参数信号，过滤网页导航杂讯
          return (
            source.keywords.length === 0 ||
            source.keywords.some((kw) => sigLower.includes(kw.toLowerCase())) ||
            /\b(?:visionOS|Horizon OS|PICO OS|OpenXR|TypeScript|SDK|Electron)\s*v?\d+/i.test(signal) ||
            /\b[1-9]\d*(?:\.\d+)?\s*(?:pt|dmm|Hz)\b/i.test(signal)
          );
        })
        .slice(0, 5);

      const missingKeywords = source.keywords.filter(
        (kw) => plainText.toLowerCase().includes(kw.toLowerCase()) && !localLower.includes(kw.toLowerCase()),
      );

      // 防噪：单靠 1 个宽泛词命中且无明确版本/参数信号时不产出低质空泛提案
      if (missingSignals.length === 0 && missingKeywords.length < 2) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          url: safeUrl,
          status: "ok",
          hasDiff: false,
          message: "未发现版本或参数滞后差异",
        });
        continue;
      }

      const verifiedAt = new Date().toISOString().slice(0, 10);
      const highlights = [...missingSignals, ...missingKeywords].slice(0, 6);
      const excerptLine =
        plainText
          .split("\n")
          .find(
            (line) =>
              highlights.some((hl) => line.toLowerCase().includes(hl.toLowerCase())) &&
              line.length >= 16 &&
              !/(?:self\.__next_f|__NEXT_DATA__|window\.__|function\s*\()/.test(line),
          )
          ?.slice(0, 180) ?? `官方文档《${pageTitle || source.name}》包含新参数或版本信号：${highlights.join("、")}`;

      const resolvedAnchor = await resolveAvailableHeading(
        targetSourceRoot,
        source.targetPath,
        source.anchorHeading ?? "## 核验记录",
      );

      const candidate: CaptureProposalInput = {
        channel: "docs-watch",
        targetKind: source.targetPath.startsWith("plugins/") ? "skill" : "rule",
        operation: "add-item",
        title: `核对 ${source.name} 新指标：${highlights.slice(0, 2).join(" / ")}`,
        summary: `官方文档检测到本地规则尚未涵盖的新版本或参数信号：${highlights.join("、")}。`,
        targetRulepack: source.targetRulepack,
        targetPath: source.targetPath,
        anchorHeading: resolvedAnchor,
        afterSnippet: `- **${source.name} 核验（${verifiedAt}）**：请同步核对官方文档最新参数与版本基线（${highlights.join("、")}），来源：${safeUrl}。`,
        evidence: [
          {
            sourceLabel: source.name,
            summary: excerptLine,
            url: safeUrl,
            verifiedAt,
          },
        ],
      };

      candidates.push(candidate);
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        url: safeUrl,
        status: "ok",
        hasDiff: true,
        message: `发现 ${highlights.length} 项差异信号（${highlights.slice(0, 3).join("、")}）`,
        candidate,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        cancelled = true;
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          url: source.url,
          status: "cancelled",
          hasDiff: false,
          message: "已取消巡检",
        });
      } else {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          url: source.url,
          status: "error",
          hasDiff: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onParentAbort);
    }
  }

  if (!cancelled) {
    options.onProgress?.({
      completed: enabledSources.length,
      total: enabledSources.length,
      currentSourceName: "",
    });
  }

  const succeededCount = results.filter((r) => r.status === "ok").length;
  const failedCount = results.filter((r) => r.status === "error").length;

  return {
    checkedCount: results.filter((r) => r.status !== "cancelled").length,
    succeededCount,
    failedCount,
    cancelled,
    results,
    candidates,
  };
}

/** 推算本机智枢桌面端默认规则进化收件箱目录，供 CLI 与跨工具 Skill 自动投递。 */
export function resolveDefaultEvolutionDir(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  const env = options.env ?? process.env;
  if (env.ZHISHU_EVOLUTION_DIR && path.isAbsolute(env.ZHISHU_EVOLUTION_DIR)) {
    return env.ZHISHU_EVOLUTION_DIR;
  }
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "智枢", "evolution");
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "智枢", "evolution");
  }
  const xdgConfig = env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return path.join(xdgConfig, "智枢", "evolution");
}

interface PendingEvolutionPreview {
  preview: EvolutionPreview;
  proposalUpdatedAt: string;
  editedPatch?: EvolutionPatchEdit;
}

const STATUS_SORT_ORDER: Record<EvolutionStatus, number> = {
  conflict: 0,
  pending: 1,
  stale: 2,
  approved: 3,
  rejected: 4,
  archived: 5,
};

export class EvolutionStore {
  private readonly proposalsDir: string;
  private readonly receiptsDir: string;
  private readonly rejectedFile: string;
  private readonly watchSourcesFile: string;
  private readonly lockFile: string;
  private readonly pendingPreviews = new Map<string, PendingEvolutionPreview>();

  constructor(readonly stateRoot: string) {
    this.proposalsDir = path.join(stateRoot, "proposals");
    this.receiptsDir = path.join(stateRoot, "receipts");
    this.rejectedFile = path.join(stateRoot, "rejected-fingerprints.json");
    this.watchSourcesFile = path.join(stateRoot, "watch-sources.json");
    this.lockFile = path.join(stateRoot, ".evolution-operation-lock");
  }

  private static isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  private async withExclusiveLock<T>(action: () => Promise<T>): Promise<T> {
    await assertAssetDirectory(this.stateRoot);
    await mkdir(this.stateRoot, { recursive: true });
    let acquired = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const handle = await open(this.lockFile, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
        } finally {
          await handle.close();
        }
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          let reclaimed = false;
          try {
            const raw = await readFile(this.lockFile, "utf8");
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed) && typeof parsed.pid === "number" && !EvolutionStore.isPidAlive(parsed.pid)) {
              await rm(this.lockFile, { force: true });
              reclaimed = true;
            }
          } catch {
            try {
              const stat = await lstat(this.lockFile);
              if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
                await rm(this.lockFile, { force: true });
                reclaimed = true;
              }
            } catch {
              // 锁已被其他进程释放，进入下次重试
              reclaimed = true;
            }
          }
          if (reclaimed) continue;
          if (attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
            continue;
          }
          throw new Error("已有另一个规则进化写入事务正在进行，请稍后重试");
        }
        throw error;
      }
    }
    if (!acquired) {
      throw new Error("已有另一个规则进化写入事务正在进行，请稍后重试");
    }
    try {
      return await action();
    } finally {
      await rm(this.lockFile, { force: true });
    }
  }

  private proposalPath(id: string): string {
    if (!PROPOSAL_ID_PATTERN.test(id) || FORBIDDEN_KEYS.has(id)) {
      throw new Error(`进化提案 ID 无效：${id}`);
    }
    return path.join(this.proposalsDir, `${id}.json`);
  }

  private async readProposal(id: string): Promise<EvolutionProposal> {
    const filePath = this.proposalPath(id);
    await assertAssetDirectory(this.proposalsDir);
    let info;
    try {
      info = await lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`未找到进化提案：${id}`);
      }
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`进化提案文件无效：${id}`);
    }
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    assertEvolutionProposal(parsed);
    return parsed;
  }

  private async writeProposal(proposal: EvolutionProposal): Promise<void> {
    assertEvolutionProposal(proposal);
    await atomicWriteFile(this.proposalPath(proposal.id), `${JSON.stringify(proposal, null, 2)}\n`, 0o600);
  }

  private async loadRejectedFingerprints(): Promise<Record<string, { rejectedAt: string; reason?: string }>> {
    await assertAssetDirectory(this.stateRoot);
    if (!(await pathExists(this.rejectedFile))) return {};
    const info = await lstat(this.rejectedFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("驳回指纹记录文件无效");
    const parsed: unknown = JSON.parse(await readFile(this.rejectedFile, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.fingerprints)) {
      throw new Error("驳回指纹记录文件已损坏");
    }
    const result: Record<string, { rejectedAt: string; reason?: string }> = {};
    for (const [k, v] of Object.entries(parsed.fingerprints)) {
      if (isRecord(v) && typeof v.rejectedAt === "string") {
        result[k] = { rejectedAt: v.rejectedAt, ...(typeof v.reason === "string" ? { reason: v.reason } : {}) };
      }
    }
    return result;
  }

  private async saveRejectedFingerprints(
    fingerprints: Record<string, { rejectedAt: string; reason?: string }>,
  ): Promise<void> {
    await atomicWriteFile(
      this.rejectedFile,
      `${JSON.stringify({ schemaVersion: 1, fingerprints }, null, 2)}\n`,
      0o600,
    );
  }

  async getWatchSources(): Promise<WatchSourceConfig[]> {
    await assertAssetDirectory(this.stateRoot);
    if (!(await pathExists(this.watchSourcesFile))) {
      return DEFAULT_WATCH_SOURCES.map((item) => ({ ...item, keywords: [...item.keywords] }));
    }
    const info = await lstat(this.watchSourcesFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("官方文档巡检源配置文件无效");
    const parsed: unknown = JSON.parse(await readFile(this.watchSourcesFile, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources)) {
      throw new Error("官方文档巡检源配置文件已损坏");
    }
    const validated: WatchSourceConfig[] = [];
    for (const item of parsed.sources) {
      assertWatchSourceConfig(item);
      validated.push({ ...item, keywords: [...item.keywords] });
    }
    return validated;
  }

  async saveWatchSources(sources: readonly WatchSourceConfig[]): Promise<WatchSourceConfig[]> {
    return this.withExclusiveLock(async () => {
      const seen = new Set<string>();
      const normalized: WatchSourceConfig[] = [];
      for (const item of sources) {
        assertWatchSourceConfig(item);
        if (seen.has(item.id)) {
          throw new Error(`巡检源标识重复：${item.id}`);
        }
        seen.add(item.id);
        normalized.push({
          ...item,
          url: assertSafeWatchUrl(item.url),
          keywords: [...new Set(item.keywords.map((kw) => kw.trim()).filter(Boolean))],
        });
      }
      await atomicWriteFile(
        this.watchSourcesFile,
        `${JSON.stringify({ schemaVersion: 1, sources: normalized }, null, 2)}\n`,
        0o600,
      );
      return normalized;
    });
  }

  private async listUnlocked(options: { now?: Date; persistStale?: boolean } = {}): Promise<EvolutionListResult> {
    await assertAssetDirectory(this.stateRoot);
    const proposals: EvolutionProposal[] = [];
    if (await pathExists(this.proposalsDir)) {
      await assertAssetDirectory(this.proposalsDir);
      const entries = await readdir(this.proposalsDir, { withFileTypes: true });
      const nowMs = (options.now ?? new Date()).getTime();
      const staleThresholdMs = EVOLUTION_STALE_DAYS * 24 * 60 * 60 * 1000;

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const fullPath = path.join(this.proposalsDir, entry.name);
        const info = await lstat(fullPath);
        if (info.isSymbolicLink() || !info.isFile()) {
          throw new Error(`收件箱包含非法提案文件：${entry.name}`);
        }
        const parsed: unknown = JSON.parse(await readFile(fullPath, "utf8"));
        assertEvolutionProposal(parsed);
        let proposal = parsed;
        if (proposal.status === "pending") {
          const refTime = Date.parse(proposal.lastCheckedAt ?? proposal.createdAt);
          if (!Number.isNaN(refTime) && nowMs - refTime > staleThresholdMs) {
            proposal = {
              ...proposal,
              status: "stale",
              updatedAt: new Date(nowMs).toISOString(),
            };
            if (options.persistStale !== false) {
              await this.writeProposal(proposal);
            }
          }
        }
        proposals.push(proposal);
      }
    }

    proposals.sort((left, right) => {
      const rankDiff = STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
      if (rankDiff !== 0) return rankDiff;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

    const pendingCount = proposals.filter((p) => p.status === "pending").length;
    const conflictCount = proposals.filter((p) => p.status === "conflict").length;
    const staleCount = proposals.filter((p) => p.status === "stale").length;
    const processedCount = proposals.filter(
      (p) => p.status === "approved" || p.status === "rejected" || p.status === "archived",
    ).length;

    return {
      proposals,
      counts: {
        badge: pendingCount + conflictCount,
        pendingTab: pendingCount + staleCount,
        conflictTab: conflictCount,
        processedTab: processedCount,
        total: proposals.length,
      },
    };
  }

  async list(options: { now?: Date } = {}): Promise<EvolutionListResult> {
    return this.withExclusiveLock(() => this.listUnlocked({ ...options, persistStale: true }));
  }

  async capture(
    input: CaptureProposalInput,
    options: { allowPreviouslyRejected?: boolean; targetSourceRoot?: string } = {},
  ): Promise<CaptureResult> {
    if (!CHANNELS.includes(input.channel)) throw new Error(`不支持的进化通道：${String(input.channel)}`);
    if (!TARGET_KINDS.includes(input.targetKind)) throw new Error(`不支持的目标资产类型：${String(input.targetKind)}`);
    if (!OPERATIONS.includes(input.operation)) throw new Error(`不支持的增量操作：${String(input.operation)}`);
    const title = input.title?.trim();
    if (!title || title.length > 120) throw new Error("进化提案标题不能为空且不超过 120 字");
    const targetPath = assertSafeEvolutionTargetPath(input.targetPath, input.targetKind);
    const anchorHeading = input.anchorHeading?.trim();
    if (!anchorHeading || anchorHeading.length > 200) throw new Error("必须指定有效的锚点章节标题");
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
      throw new Error("必须至少提供 1 条证据来源");
    }
    if (input.operation === "add-item" && !input.afterSnippet?.trim()) {
      throw new Error("新增条款（add-item）必须提供 afterSnippet");
    }
    if (input.operation === "update-item" && (!input.beforeSnippet?.trim() || !input.afterSnippet?.trim())) {
      throw new Error("修订条款（update-item）必须同时提供 beforeSnippet 与 afterSnippet");
    }
    if (input.operation === "deprecate-item" && !input.beforeSnippet?.trim()) {
      throw new Error("废弃条款（deprecate-item）必须提供 beforeSnippet");
    }

    const sensitiveFindings = detectSensitiveContent({
      title,
      summary: input.summary,
      anchorHeading,
      beforeSnippet: input.beforeSnippet,
      afterSnippet: input.afterSnippet,
      evidence: input.evidence,
    });
    if (sensitiveFindings.length > 0) {
      throw new Error(`敏感信息拦截，已拒绝入箱：${sensitiveFindings.join("；")}`);
    }

    const fingerprint = computeProposalFingerprint({
      channel: input.channel,
      targetKind: input.targetKind,
      operation: input.operation,
      targetPath,
      anchorHeading,
      beforeSnippet: input.beforeSnippet,
      afterSnippet: input.afterSnippet,
    });

    return this.withExclusiveLock(async () => {
      const existingList = await this.listUnlocked({ persistStale: false });
      const existingDuplicate = existingList.proposals.find(
        (item) =>
          item.fingerprint === fingerprint &&
          (item.status === "pending" || item.status === "conflict" || item.status === "stale" || item.status === "approved"),
      );
      if (existingDuplicate) {
        return { outcome: "duplicate", proposal: existingDuplicate, fingerprint };
      }

      const rejected = await this.loadRejectedFingerprints();
      if (!options.allowPreviouslyRejected && Object.hasOwn(rejected, fingerprint)) {
        return { outcome: "previously-rejected", fingerprint };
      }

      let targetBaseDigest = input.targetBaseDigest;
      if (!targetBaseDigest && options.targetSourceRoot) {
        try {
          const targetFile = await assertNoSymlinkBelow(options.targetSourceRoot, targetPath);
          const content = await readFile(targetFile, "utf8");
          targetBaseDigest = assetDigest(content);
        } catch {
          // 目标文件尚未在本地检出时留空，审阅预览阶段会重新核验
        }
      }

      const nowIso = new Date().toISOString();
      let id = input.id && PROPOSAL_ID_PATTERN.test(input.id) ? input.id : generateProposalId(input.channel, title);
      // 防止外部导入 JSON 伪造或碰撞已有提案 ID 静默覆盖已审阅/已写入记录。
      if (await pathExists(this.proposalPath(id))) {
        id = generateProposalId(input.channel, title);
      }
      const proposal: EvolutionProposal = {
        schemaVersion: 1,
        id,
        channel: input.channel,
        targetKind: input.targetKind,
        operation: input.operation,
        status: "pending",
        title,
        ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
        ...(input.targetRulepack?.trim() ? { targetRulepack: input.targetRulepack.trim() } : {}),
        targetPath,
        anchorHeading,
        ...(input.beforeSnippet !== undefined ? { beforeSnippet: normalizeNewlines(input.beforeSnippet) } : {}),
        ...(input.afterSnippet !== undefined ? { afterSnippet: normalizeNewlines(input.afterSnippet) } : {}),
        evidence: input.evidence.map((ev) => ({
          sourceLabel: ev.sourceLabel.trim(),
          summary: ev.summary.trim(),
          ...(ev.url ? { url: assertSafeWatchUrl(ev.url) } : {}),
          ...(ev.verifiedAt ? { verifiedAt: ev.verifiedAt } : {}),
          ...(ev.projectNames?.length ? { projectNames: [...ev.projectNames] } : {}),
        })),
        fingerprint,
        ...(targetBaseDigest ? { targetBaseDigest } : {}),
        createdAt: input.createdAt ?? nowIso,
        updatedAt: nowIso,
        lastCheckedAt: nowIso,
      };

      await this.writeProposal(proposal);
      return { outcome: "created", proposal, fingerprint };
    });
  }

  async importProposalFile(
    filePath: string,
    options: { targetSourceRoot?: string } = {},
  ): Promise<CaptureResult> {
    if (!path.isAbsolute(filePath)) throw new Error("提案文件路径必须是绝对路径");
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("导入的提案文件不是普通文件");
    if (info.size > MAX_PROPOSAL_IMPORT_BYTES) {
      throw new Error(`提案文件体积超过上限（最大 ${Math.floor(MAX_PROPOSAL_IMPORT_BYTES / 1024)} KB）`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      throw new Error("提案文件不是合法的 JSON 格式");
    }
    if (!isRecord(parsed)) throw new Error("提案文件顶层必须是 JSON 对象");
    const input: CaptureProposalInput = {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      channel: (parsed.channel as EvolutionChannel) ?? "session-capture",
      targetKind: parsed.targetKind as EvolutionTargetKind,
      operation: parsed.operation as EvolutionOperation,
      title: parsed.title as string,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      targetRulepack: typeof parsed.targetRulepack === "string" ? parsed.targetRulepack : undefined,
      targetPath: parsed.targetPath as string,
      anchorHeading: parsed.anchorHeading as string,
      beforeSnippet: typeof parsed.beforeSnippet === "string" ? parsed.beforeSnippet : undefined,
      afterSnippet: typeof parsed.afterSnippet === "string" ? parsed.afterSnippet : undefined,
      evidence: parsed.evidence as EvolutionEvidence[],
      targetBaseDigest: typeof parsed.targetBaseDigest === "string" ? parsed.targetBaseDigest : undefined,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
    };
    return this.capture(input, { targetSourceRoot: options.targetSourceRoot });
  }

  async recheck(
    proposalId: string,
    targetSource: EvolutionTargetSource,
    editedPatch?: EvolutionPatchEdit,
  ): Promise<{ proposal: EvolutionProposal; patch: AtomicPatchResult | undefined; conflicts: string[] }> {
    return this.withExclusiveLock(async () => {
      const proposal = await this.readProposal(proposalId);
      if (proposal.status === "approved" || proposal.status === "rejected" || proposal.status === "archived") {
        throw new Error("已处理的提案无需重新检测");
      }

      let workingProposal = proposal;
      if (editedPatch) {
        const nextAnchor = (editedPatch.anchorHeading ?? proposal.anchorHeading).trim();
        if (!nextAnchor || nextAnchor.length > 200) throw new Error("必须指定有效的锚点章节标题");
        const nextBefore =
          editedPatch.beforeSnippet !== undefined ? normalizeNewlines(editedPatch.beforeSnippet) : proposal.beforeSnippet;
        const nextAfter =
          editedPatch.afterSnippet !== undefined ? normalizeNewlines(editedPatch.afterSnippet) : proposal.afterSnippet;
        const sensitiveFindings = detectSensitiveContent({
          anchorHeading: nextAnchor,
          beforeSnippet: nextBefore,
          afterSnippet: nextAfter,
        });
        if (sensitiveFindings.length > 0) {
          throw new Error(`编辑后的补丁包含敏感内容：${sensitiveFindings.join("；")}`);
        }
        workingProposal = {
          ...proposal,
          anchorHeading: nextAnchor,
          ...(nextBefore !== undefined ? { beforeSnippet: nextBefore } : {}),
          ...(nextAfter !== undefined ? { afterSnippet: nextAfter } : {}),
          fingerprint: computeProposalFingerprint({
            channel: proposal.channel,
            targetKind: proposal.targetKind,
            operation: proposal.operation,
            targetPath: proposal.targetPath,
            anchorHeading: nextAnchor,
            beforeSnippet: nextBefore,
            afterSnippet: nextAfter,
          }),
        };
      }

      const nowIso = new Date().toISOString();
      if (!targetSource.root) {
        const conflicts = [`[SOURCE_UNAVAILABLE] 目标源「${targetSource.name}」尚未在本地检出，无法核验目标文件`];
        const next: EvolutionProposal = {
          ...workingProposal,
          status: "conflict",
          conflictMessages: conflicts,
          lastCheckedAt: nowIso,
          updatedAt: nowIso,
        };
        await this.writeProposal(next);
        return { proposal: next, patch: undefined, conflicts };
      }

      let targetFilePath: string;
      let currentContent: string;
      try {
        targetFilePath = await assertNoSymlinkBelow(targetSource.root, workingProposal.targetPath);
        const stat = await lstat(targetFilePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error("目标路径不是普通文件");
        }
        currentContent = await readFile(targetFilePath, "utf8");
      } catch (error) {
        const conflicts = [
          `[TARGET_NOT_FOUND] 在目标源中未找到文件 ${workingProposal.targetPath}（${error instanceof Error ? error.message : String(error)}）`,
        ];
        const next: EvolutionProposal = {
          ...workingProposal,
          status: "conflict",
          conflictMessages: conflicts,
          lastCheckedAt: nowIso,
          updatedAt: nowIso,
        };
        await this.writeProposal(next);
        return { proposal: next, patch: undefined, conflicts };
      }

      // 重新检测时不校验旧的 targetBaseDigest，而是以最新文件为准核验锚点与片段是否可无冲突应用
      const patch = computeAtomicDeltaPatch(currentContent, workingProposal, undefined);
      const next: EvolutionProposal = {
        ...workingProposal,
        status: patch.conflicts.length === 0 ? "pending" : "conflict",
        targetBaseDigest: patch.beforeDigest,
        lastCheckedAt: nowIso,
        updatedAt: nowIso,
        ...(patch.conflicts.length > 0 ? { conflictMessages: patch.conflicts } : { conflictMessages: undefined }),
      };
      if (!next.conflictMessages) delete next.conflictMessages;
      await this.writeProposal(next);
      return { proposal: next, patch, conflicts: patch.conflicts };
    });
  }

  /**
   * 生成人工审阅 Diff 预览（严格只读，绝不修改目标规则源任何文件）。
   */
  async preview(
    proposalId: string,
    targetSource: EvolutionTargetSource,
    editedPatch?: EvolutionPatchEdit,
  ): Promise<EvolutionPreview> {
    const proposal = await this.readProposal(proposalId);
    if (proposal.status === "approved" || proposal.status === "rejected" || proposal.status === "archived") {
      throw new Error("该提案已完成处理，无法再次预览写入");
    }

    const effectiveAnchor = (editedPatch?.anchorHeading ?? proposal.anchorHeading).trim();
    const effectiveBefore =
      editedPatch?.beforeSnippet !== undefined ? normalizeNewlines(editedPatch.beforeSnippet) : proposal.beforeSnippet;
    const effectiveAfter =
      editedPatch?.afterSnippet !== undefined ? normalizeNewlines(editedPatch.afterSnippet) : proposal.afterSnippet;

    if (editedPatch) {
      const sensitiveFindings = detectSensitiveContent({
        anchorHeading: effectiveAnchor,
        beforeSnippet: effectiveBefore,
        afterSnippet: effectiveAfter,
      });
      if (sensitiveFindings.length > 0) {
        throw new Error(`编辑后的补丁包含敏感内容：${sensitiveFindings.join("；")}`);
      }
    }

    const conflicts: string[] = [];
    if (targetSource.readonly) {
      conflicts.push(
        `[READONLY_SOURCE] 目标源「${targetSource.name}」为只读源，禁止直接写入；请切换可写本地源或使用「导出补丁」`,
      );
    }
    if (proposal.status === "stale") {
      conflicts.push(
        `[PROPOSAL_STALE] 该提案已超过 ${EVOLUTION_STALE_DAYS} 天未审阅，请先点击「重新检测」核验最新基线指纹`,
      );
    }
    if (proposal.status === "conflict") {
      conflicts.push(
        "[PROPOSAL_CONFLICT] 该提案处于冲突态，请先点击「重新检测」保存并核验修订后的锚点与补丁内容",
      );
    }

    let targetFilePath = proposal.targetPath;
    let patch: AtomicPatchResult;

    if (!targetSource.root) {
      conflicts.push(`[SOURCE_UNAVAILABLE] 目标源「${targetSource.name}」无本地可写目录，仅支持导出补丁`);
      patch = {
        applied: false,
        beforeContent: "",
        afterContent: "",
        beforeDigest: assetDigest(""),
        afterDigest: assetDigest(""),
        lineCountBefore: 0,
        lineCountAfter: 0,
        lineBudget: proposal.targetKind === "skill" ? SKILL_LINE_BUDGET : RULE_LINE_BUDGET,
        overBudget: false,
        similarItems: [],
        conflicts: [],
      };
    } else {
      try {
        targetFilePath = await assertNoSymlinkBelow(targetSource.root, proposal.targetPath);
        const stat = await lstat(targetFilePath);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error("目标路径不是普通文件");
        }
        const currentContent = await readFile(targetFilePath, "utf8");
        patch = computeAtomicDeltaPatch(
          currentContent,
          {
            targetKind: proposal.targetKind,
            operation: proposal.operation,
            anchorHeading: effectiveAnchor,
            beforeSnippet: effectiveBefore,
            afterSnippet: effectiveAfter,
          },
          proposal.targetBaseDigest,
        );
        conflicts.push(...patch.conflicts);
      } catch (error) {
        conflicts.push(
          `[TARGET_NOT_FOUND] 目标文件不可读：${proposal.targetPath}（${error instanceof Error ? error.message : String(error)}）`,
        );
        patch = {
          applied: false,
          beforeContent: "",
          afterContent: "",
          beforeDigest: assetDigest(""),
          afterDigest: assetDigest(""),
          lineCountBefore: 0,
          lineCountAfter: 0,
          lineBudget: proposal.targetKind === "skill" ? SKILL_LINE_BUDGET : RULE_LINE_BUDGET,
          overBudget: false,
          similarItems: [],
          conflicts: [],
        };
      }
    }

    const token = randomUUID();
    const preview: EvolutionPreview = {
      token,
      proposalId: proposal.id,
      title: proposal.title,
      channel: proposal.channel,
      targetKind: proposal.targetKind,
      operation: proposal.operation,
      targetSource,
      targetPath: proposal.targetPath,
      targetFilePath,
      anchorHeading: effectiveAnchor,
      beforeSnippet: effectiveBefore,
      afterSnippet: effectiveAfter,
      beforeContent: patch.beforeContent,
      afterContent: patch.afterContent,
      beforeDigest: patch.beforeDigest,
      afterDigest: patch.afterDigest,
      lineCountBefore: patch.lineCountBefore,
      lineCountAfter: patch.lineCountAfter,
      lineBudget: patch.lineBudget,
      overBudget: patch.overBudget,
      similarItems: patch.similarItems,
      conflicts,
      validationChecks:
        proposal.targetKind === "skill"
          ? ["YAML Frontmatter 完整性校验", "Skill 本地相对链接与无符号链接校验", "写入前指纹一致性复核"]
          : ["Markdown 相对链接完整性校验", "规则包清单（pack.json）与正文一致性校验", "写入前指纹一致性复核"],
    };

    this.pendingPreviews.clear();
    this.pendingPreviews.set(token, {
      preview,
      proposalUpdatedAt: proposal.updatedAt,
      editedPatch,
    });
    return preview;
  }

  /**
   * 仅在用户显式批准后调用：加排他锁 → 重验指纹 → 原子写入 → 执行自动化校验 → 失败完整回滚。
   */
  async apply(
    token: string,
    postWriteValidator?: EvolutionPostWriteValidator,
  ): Promise<{ proposal: EvolutionProposal; receipt: EvolutionAppliedReceipt }> {
    const pending = this.pendingPreviews.get(token);
    if (!pending) {
      throw new Error("变更预览已失效，请重新点击「查看变更」");
    }
    const { preview } = pending;
    if (preview.conflicts.length > 0) {
      throw new Error(`存在阻塞冲突，无法写入：${preview.conflicts.join("；")}`);
    }
    if (preview.targetSource.readonly || !preview.targetSource.root) {
      throw new Error("目标源为只读或不可写目录，已拒绝写入");
    }

    return this.withExclusiveLock(async () => {
      const proposal = await this.readProposal(preview.proposalId);
      if (proposal.status !== "pending") {
        throw new Error(`提案状态已变为 ${proposal.status}，请刷新后重试`);
      }
      if (proposal.updatedAt !== pending.proposalUpdatedAt) {
        throw new Error("提案内容自预览后已被修改，请重新查看变更");
      }

      const targetFilePath = await assertNoSymlinkBelow(preview.targetSource.root!, proposal.targetPath);
      const stat = await lstat(targetFilePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("目标文件不是普通文件，已拒绝写入");
      }
      const originalBytes = await readFile(targetFilePath);
      const currentDigest = assetDigest(originalBytes);
      if (currentDigest !== preview.beforeDigest) {
        throw new Error("目标文件自预览后已被外部修改，已中断写入以防覆盖");
      }

      const fileMode = stat.mode & 0o777;
      const writeAndRollback = async (bytes: Buffer | string): Promise<void> => {
        const tempPath = `${targetFilePath}.${randomUUID()}.zhishu.tmp`;
        try {
          await writeFile(tempPath, bytes, { flag: "wx", mode: fileMode || 0o644 });
          await rename(tempPath, targetFilePath);
        } finally {
          await rm(tempPath, { force: true });
        }
      };

      try {
        await writeAndRollback(Buffer.from(preview.afterContent, "utf8"));
        if (postWriteValidator) {
          const validation = await postWriteValidator({
            sourceRoot: preview.targetSource.root!,
            targetPath: proposal.targetPath,
            targetKind: proposal.targetKind,
            targetFilePath,
          });
          if (!validation.valid) {
            throw new Error(validation.errors.join("；") || "自动化门禁校验未通过");
          }
        }
      } catch (error) {
        await writeAndRollback(originalBytes);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`写入校验未通过，已完整回滚目标文件：${detail}`);
      }

      const appliedAt = new Date().toISOString();
      const receipt: EvolutionAppliedReceipt = {
        sourceId: preview.targetSource.id,
        sourceName: preview.targetSource.name,
        targetFilePath,
        appliedAt,
        beforeDigest: preview.beforeDigest,
        afterDigest: preview.afterDigest,
        validated: true,
      };
      const updatedProposal: EvolutionProposal = {
        ...proposal,
        anchorHeading: preview.anchorHeading,
        ...(preview.beforeSnippet !== undefined ? { beforeSnippet: preview.beforeSnippet } : {}),
        ...(preview.afterSnippet !== undefined ? { afterSnippet: preview.afterSnippet } : {}),
        status: "approved",
        targetBaseDigest: preview.afterDigest,
        updatedAt: appliedAt,
        lastCheckedAt: appliedAt,
        appliedReceipt: receipt,
      };
      delete updatedProposal.conflictMessages;

      await atomicWriteFile(
        path.join(this.receiptsDir, `${proposal.id}.json`),
        `${JSON.stringify({ schemaVersion: 1, proposalId: proposal.id, receipt }, null, 2)}\n`,
        0o600,
      );
      await this.writeProposal(updatedProposal);
      this.pendingPreviews.delete(token);
      return { proposal: updatedProposal, receipt };
    });
  }

  async reject(proposalId: string, reason?: string): Promise<EvolutionProposal> {
    return this.withExclusiveLock(async () => {
      const proposal = await this.readProposal(proposalId);
      if (proposal.status === "approved") {
        throw new Error("已写入的提案不能驳回");
      }
      const nowIso = new Date().toISOString();
      const cleanedReason = reason?.trim().slice(0, 300);
      const updated: EvolutionProposal = {
        ...proposal,
        status: "rejected",
        updatedAt: nowIso,
        ...(cleanedReason ? { rejectionReason: cleanedReason } : {}),
      };
      await this.writeProposal(updated);

      const rejected = await this.loadRejectedFingerprints();
      rejected[proposal.fingerprint] = {
        rejectedAt: nowIso,
        ...(cleanedReason ? { reason: cleanedReason } : {}),
      };
      await this.saveRejectedFingerprints(rejected);
      return updated;
    });
  }

  /** 将已驳回或已归档的提案重新放回待审收件箱，并移除其驳回指纹拦截记录。 */
  async reopen(proposalId: string): Promise<EvolutionProposal> {
    return this.withExclusiveLock(async () => {
      const proposal = await this.readProposal(proposalId);
      if (proposal.status !== "rejected" && proposal.status !== "archived") {
        throw new Error("仅支持重新打开已驳回或已归档的提案");
      }
      const nowIso = new Date().toISOString();
      const updated: EvolutionProposal = {
        ...proposal,
        status: "pending",
        updatedAt: nowIso,
        lastCheckedAt: nowIso,
      };
      delete updated.rejectionReason;
      delete updated.conflictMessages;
      await this.writeProposal(updated);

      const rejected = await this.loadRejectedFingerprints();
      if (Object.hasOwn(rejected, proposal.fingerprint)) {
        delete rejected[proposal.fingerprint];
        await this.saveRejectedFingerprints(rejected);
      }
      return updated;
    });
  }

  /** 将已处理或暂不处理的提案归档，保持主收件箱清爽。 */
  async archive(proposalId: string): Promise<EvolutionProposal> {
    return this.withExclusiveLock(async () => {
      const proposal = await this.readProposal(proposalId);
      if (proposal.status === "archived") return proposal;
      const nowIso = new Date().toISOString();
      const updated: EvolutionProposal = {
        ...proposal,
        status: "archived",
        updatedAt: nowIso,
      };
      await this.writeProposal(updated);
      return updated;
    });
  }

  /** 导出标准增量补丁文件，拒绝静默覆盖已有文件；支持合并抽屉中尚未落盘的编辑草稿。 */
  async exportPatch(
    proposalId: string,
    destinationPath: string,
    targetSourceRoot?: string,
    editedPatch?: EvolutionPatchEdit,
  ): Promise<{ path: string; sha256: string }> {
    if (!path.isAbsolute(destinationPath)) {
      throw new Error("补丁导出路径必须是绝对路径");
    }
    const baseProposal = await this.readProposal(proposalId);
    let proposal = baseProposal;
    if (editedPatch) {
      const nextAnchor = (editedPatch.anchorHeading ?? baseProposal.anchorHeading).trim();
      const nextBefore =
        editedPatch.beforeSnippet !== undefined ? normalizeNewlines(editedPatch.beforeSnippet) : baseProposal.beforeSnippet;
      const nextAfter =
        editedPatch.afterSnippet !== undefined ? normalizeNewlines(editedPatch.afterSnippet) : baseProposal.afterSnippet;
      const sensitiveFindings = detectSensitiveContent({
        anchorHeading: nextAnchor,
        beforeSnippet: nextBefore,
        afterSnippet: nextAfter,
      });
      if (sensitiveFindings.length > 0) {
        throw new Error(`编辑后的补丁包含敏感内容：${sensitiveFindings.join("；")}`);
      }
      proposal = {
        ...baseProposal,
        anchorHeading: nextAnchor,
        ...(nextBefore !== undefined ? { beforeSnippet: nextBefore } : {}),
        ...(nextAfter !== undefined ? { afterSnippet: nextAfter } : {}),
      };
    }
    await assertAssetDirectory(path.dirname(destinationPath));
    await mkdir(path.dirname(destinationPath), { recursive: true });

    let diffBlock = "";
    if (targetSourceRoot) {
      try {
        const targetFile = await assertNoSymlinkBelow(targetSourceRoot, proposal.targetPath);
        const currentContent = await readFile(targetFile, "utf8");
        const patch = computeAtomicDeltaPatch(currentContent, proposal, undefined);
        if (patch.applied) {
          const beforeLines = normalizeNewlines(patch.beforeContent).split("\n");
          const afterLines = normalizeNewlines(patch.afterContent).split("\n");
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
          const removed = beforeLines.slice(prefix, beforeLines.length - suffix).map((l) => `-${l}`);
          const added = afterLines.slice(prefix, afterLines.length - suffix).map((l) => `+${l}`);
          diffBlock = [
            `--- a/${proposal.targetPath}`,
            `+++ b/${proposal.targetPath}`,
            `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
            ...removed,
            ...added,
          ].join("\n");
        }
      } catch {
        // 无法读取本地目标源时回退为结构化补丁描述
      }
    }

    const lines = [
      `# 智枢规则进化增量补丁`,
      `# Proposal-ID: ${proposal.id}`,
      `# Channel: ${proposal.channel}`,
      `# Target-Kind: ${proposal.targetKind}`,
      `# Target-Path: ${proposal.targetPath}`,
      `# Anchor-Heading: ${proposal.anchorHeading}`,
      `# Operation: ${proposal.operation}`,
      `# Title: ${proposal.title}`,
      `# Fingerprint: ${proposal.fingerprint}`,
      "",
      ...(diffBlock
        ? [diffBlock]
        : [
            `--- a/${proposal.targetPath}`,
            `+++ b/${proposal.targetPath}`,
            `@@ anchor: ${proposal.anchorHeading} @@`,
            ...(proposal.beforeSnippet ? proposal.beforeSnippet.split("\n").map((l) => `-${l}`) : []),
            ...(proposal.afterSnippet ? proposal.afterSnippet.split("\n").map((l) => `+${l}`) : []),
          ]),
      "",
    ];
    const payload = lines.join("\n");
    try {
      await writeFile(destinationPath, payload, { flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`导出目标文件已存在，已拒绝静默覆盖：${destinationPath}`);
      }
      throw error;
    }
    return { path: destinationPath, sha256: assetDigest(payload) };
  }
}

/**
 * 写入后自动化质量门禁校验器（CLI 与桌面端共用）：
 * - 规则文件：校验 Markdown 相对链接有效性（非死链、非越界、非符号链接）与所属 pack.json 一致性；
 * - 技能文件：校验 YAML Frontmatter 结构完整、必填字段合法及本地相对链接有效。
 */
export async function validateEvolutionTargetFile(
  context: EvolutionPostWriteContext,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const content = await readFile(context.targetFilePath, "utf8");
  if (!content.trim()) {
    return { valid: false, errors: ["写入后的目标文档为空"] };
  }

  const baseDir = path.dirname(context.targetFilePath);
  const realRoot = await realpath(context.sourceRoot);

  const checkRelativeLinks = async (markdownBody: string, boundaryDir: string): Promise<void> => {
    let inFence = false;
    for (const rawLine of normalizeNewlines(markdownBody).split("\n")) {
      if (/^\s*(?:```|~~~)/.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const cleaned = rawLine.replace(/`[^`]*`/g, "");
      for (const match of cleaned.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']+["'])?\)/g)) {
        const rawTarget = match[1];
        if (!rawTarget) continue;
        const unwrapped = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1) : rawTarget;
        if (/^[a-z][a-z\d+.-]*:/i.test(unwrapped) || unwrapped.startsWith("#") || unwrapped.includes("<") || unwrapped.includes(">")) {
          continue;
        }
        let decoded: string;
        try {
          decoded = decodeURIComponent(unwrapped).split("#", 1)[0]?.split("?", 1)[0] ?? "";
        } catch {
          errors.push(`Markdown 相对链接编码无效：${unwrapped}`);
          continue;
        }
        if (!decoded) continue;
        const resolved = path.resolve(baseDir, decoded);
        if (resolved !== boundaryDir && !resolved.startsWith(`${boundaryDir}${path.sep}`)) {
          errors.push(`Markdown 相对链接越出允许目录：${unwrapped}`);
          continue;
        }
        try {
          const stat = await lstat(resolved);
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
            errors.push(`Markdown 链接指向符号链接或特殊文件：${unwrapped}`);
          } else if (stat.isFile() && stat.size === 0) {
            errors.push(`Markdown 链接指向空文件：${unwrapped}`);
          }
        } catch {
          errors.push(`检测到失效的 Markdown 相对链接：${unwrapped}`);
        }
      }
    }
  };

  if (context.targetKind === "skill") {
    const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
    if (!header || !header[1] || !header[2]) {
      errors.push("SKILL.md 缺少合法的 YAML Frontmatter");
      return { valid: false, errors };
    }
    let meta: unknown;
    try {
      meta = parseYaml(header[1]);
    } catch (error) {
      errors.push(`SKILL.md YAML Frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return { valid: false, errors };
    }
    const skillDirName = path.basename(baseDir);
    const body = header[2].trim();
    if (!isRecord(meta) || meta.name !== skillDirName || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.name)) {
      errors.push(`SKILL.md frontmatter.name 必须与目录名 "${skillDirName}" 一致`);
    }
    if (!isRecord(meta) || typeof meta.description !== "string" || meta.description.trim().length < 20) {
      errors.push("SKILL.md frontmatter.description 缺失或过短（至少 20 字）");
    }
    if (!isRecord(meta) || !isRecord(meta.metadata) || typeof meta.metadata.title !== "string" || !meta.metadata.title.trim()) {
      errors.push("SKILL.md frontmatter.metadata.title 缺失");
    }
    if (body.length < 200) {
      errors.push("SKILL.md 正文内容不完整（至少 200 字）");
    }
    await checkRelativeLinks(body, baseDir);
  } else {
    await checkRelativeLinks(content, realRoot);
    // 若所在规则包目录存在 pack.json，核对 JSON 格式与清单完整性
    let cursor = baseDir;
    const rulepacksRoot = path.join(realRoot, "rulepacks");
    while (cursor.startsWith(rulepacksRoot)) {
      const candidatePack = path.join(cursor, "pack.json");
      if (await pathExists(candidatePack)) {
        try {
          const manifest: unknown = JSON.parse(await readFile(candidatePack, "utf8"));
          if (!isRecord(manifest) || typeof manifest.id !== "string" || !Array.isArray(manifest.rules)) {
            errors.push(`${path.relative(realRoot, candidatePack)} 清单格式不合法`);
          }
        } catch (error) {
          errors.push(`规则包清单解析失败：${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  return { valid: errors.length === 0, errors };
}
