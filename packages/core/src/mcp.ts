import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAssetDirectory } from "./user-assets.js";

export type McpToolId = "antigravity" | "codex";

export interface McpEnvField {
  key: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
}

export interface McpServerDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  version: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  envSchema: McpEnvField[];
  preset?: boolean;
}

export interface McpReceipt {
  schemaVersion: 1;
  id: string;
  title: string;
  version: string;
  toolId: McpToolId;
  targetPath: string;
  transport: "stdio" | "http";
  installedAt: string;
  managedEntryDigest: string;
  envKeys: string[];
  secretKeys: string[];
}

export interface McpPreview {
  token: string;
  action: "install" | "update" | "uninstall";
  toolId: McpToolId;
  id: string;
  title: string;
  version: string;
  targetPath: string;
  maskedBefore: string;
  maskedAfter: string;
  conflicts: string[];
}

export const FEISHU_MCP_PRESET: McpServerDefinition = {
  schemaVersion: 1,
  id: "feishu-mcp",
  title: "飞书 MCP",
  version: "1.0.0",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@larksuiteoapi/lark-mcp", "mcp"],
  envSchema: [
    { key: "FEISHU_APP_ID", label: "飞书 App ID", required: true, secret: false, placeholder: "cli_xxxxxxxx" },
    { key: "FEISHU_APP_SECRET", label: "飞书 App Secret", required: true, secret: true, placeholder: "仅存本机配置文件" },
  ],
  preset: true,
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const HTTP_HEADER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SENSITIVE_KEY_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const STALE_MCP_LOCK_MS = 10 * 60 * 1000;

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isValidParamKey(key: string, transport: "stdio" | "http"): boolean {
  if (FORBIDDEN_KEYS.has(key)) return false;
  return transport === "http" ? HTTP_HEADER_KEY_PATTERN.test(key) : ENV_KEY_PATTERN.test(key);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalJsonValue(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function maskSecretValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function isSensitiveEnvKey(key: string, schema?: readonly McpEnvField[]): boolean {
  const field = schema?.find((item) => item.key === key);
  if (field?.secret !== undefined) return field.secret;
  return SENSITIVE_KEY_PATTERN.test(key);
}

function assertSafeUrl(urlText: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new Error("MCP 远程地址不是合法 URL");
  }
  const isLocalHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("远程 MCP 地址必须使用 HTTPS（仅本机回环地址允许 HTTP）");
  }
}

export function assertMcpServerDefinition(value: unknown): asserts value is McpServerDefinition {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("MCP 定义缺少有效的 schemaVersion");
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id) || FORBIDDEN_KEYS.has(value.id)) {
    throw new Error("MCP 标识必须为小写字母、数字或连字符");
  }
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) {
    throw new Error("MCP 名称无效");
  }
  if (typeof value.version !== "string" || !VERSION_PATTERN.test(value.version)) {
    throw new Error("MCP 版本号无效");
  }
  if (value.transport !== "stdio" && value.transport !== "http") {
    throw new Error("MCP 传输方式仅支持 stdio 或 http");
  }
  if (value.transport === "stdio") {
    if (typeof value.command !== "string" || !value.command.trim() || /[\r\n\0]/.test(value.command)) {
      throw new Error("stdio 类型 MCP 必须提供有效启动命令");
    }
    if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg)))) {
      throw new Error("MCP 命令参数无效");
    }
  } else {
    if (typeof value.url !== "string" || !value.url.trim()) {
      throw new Error("http 类型 MCP 必须提供远程地址");
    }
    assertSafeUrl(value.url);
  }
  if (!Array.isArray(value.envSchema)) {
    throw new Error("MCP 参数声明必须是数组");
  }
  const seenKeys = new Set<string>();
  for (const field of value.envSchema) {
    if (!isRecord(field) || typeof field.key !== "string" || !isValidParamKey(field.key, value.transport) ||
      typeof field.label !== "string" || !field.label.trim() || seenKeys.has(field.key)) {
      throw new Error("MCP 参数声明包含非法或重复字段名");
    }
    seenKeys.add(field.key);
  }
}

function checkedEnvValues(definition: McpServerDefinition, rawEnv: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of definition.envSchema) {
    const value = rawEnv[field.key] ?? "";
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
      throw new Error(`参数 ${field.key} 包含非法换行或空字符`);
    }
    if (field.required && !value.trim()) {
      throw new Error(`请填写必填参数：${field.label}（${field.key}）`);
    }
    if (value) result[field.key] = value;
  }
  for (const [key, value] of Object.entries(rawEnv)) {
    if (Object.hasOwn(result, key)) continue;
    if (!isValidParamKey(key, definition.transport)) throw new Error(`参数名不合法：${key}`);
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error(`参数 ${key} 内容不合法`);
    if (value) result[key] = value;
  }
  return result;
}

function maskEnvRecord(env: Record<string, string>, schema?: readonly McpEnvField[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, isSensitiveEnvKey(key, schema) ? maskSecretValue(value) : value]),
  );
}

function buildAntigravityEntry(definition: McpServerDefinition, env: Record<string, string>, masked: boolean): Record<string, unknown> {
  const envData = masked ? maskEnvRecord(env, definition.envSchema) : env;
  if (definition.transport === "stdio") {
    return {
      command: definition.command,
      ...(definition.args?.length ? { args: definition.args } : {}),
      ...(Object.keys(envData).length ? { env: envData } : {}),
    };
  }
  return {
    serverUrl: definition.url,
    ...(Object.keys(envData).length ? { headers: envData } : {}),
  };
}

function maskAnyAntigravityJson(parsed: Record<string, unknown>, schemaById?: Map<string, readonly McpEnvField[]>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...parsed };
  if (isRecord(parsed.mcpServers)) {
    const servers: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(parsed.mcpServers)) {
      if (!isRecord(entry)) {
        servers[id] = entry;
        continue;
      }
      const schema = schemaById?.get(id);
      const nextEntry: Record<string, unknown> = { ...entry };
      if (isRecord(entry.env)) {
        const maskedEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry.env)) {
          maskedEnv[k] = typeof v === "string" && isSensitiveEnvKey(k, schema) ? maskSecretValue(v) : String(v);
        }
        nextEntry.env = maskedEnv;
      }
      if (isRecord(entry.headers)) {
        const maskedHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry.headers)) {
          maskedHeaders[k] = typeof v === "string" && isSensitiveEnvKey(k, schema) ? maskSecretValue(v) : String(v);
        }
        nextEntry.headers = maskedHeaders;
      }
      servers[id] = nextEntry;
    }
    clone.mcpServers = servers;
  }
  return clone;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexMarkers(id: string): { start: string; end: string } {
  return {
    start: `# zhishu:mcp:${id}:start`,
    end: `# zhishu:mcp:${id}:end`,
  };
}

function renderCodexBlock(definition: McpServerDefinition, env: Record<string, string>, masked: boolean): string {
  const { start, end } = codexMarkers(definition.id);
  const envData = masked ? maskEnvRecord(env, definition.envSchema) : env;
  const lines: string[] = [start, `[mcp_servers.${definition.id}]`];
  if (definition.transport === "stdio") {
    lines.push(`command = ${tomlString(definition.command ?? "")}`);
    if (definition.args?.length) {
      lines.push(`args = [${definition.args.map(tomlString).join(", ")}]`);
    }
    if (Object.keys(envData).length) {
      lines.push(`[mcp_servers.${definition.id}.env]`);
      for (const [key, value] of Object.entries(envData)) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
    }
  } else {
    lines.push(`url = ${tomlString(definition.url ?? "")}`);
    if (Object.keys(envData).length) {
      lines.push(`[mcp_servers.${definition.id}.http_headers]`);
      for (const [key, value] of Object.entries(envData)) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
    }
  }
  lines.push(end);
  return lines.join("\n");
}

function extractDelimitedBlock(content: string, id: string): { block?: string; start: number; end: number; valid: boolean } {
  const { start: startMarker, end: endMarker } = codexMarkers(id);
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 && end < 0) return { start: -1, end: -1, valid: true };
  const valid =
    start >= 0 &&
    end > start &&
    content.indexOf(startMarker, start + startMarker.length) < 0 &&
    content.indexOf(endMarker, end + endMarker.length) < 0;
  if (!valid) return { start, end, valid: false };
  return {
    block: content.slice(start, end + endMarker.length),
    start,
    end: end + endMarker.length,
    valid: true,
  };
}

function maskCodexTomlText(
  content: string,
  extraSecretKeys?: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  let currentServerId: string | undefined;
  let inSensitiveTable = false;
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const headerMatch = /^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))(?:\.(env|http_headers))?\]\s*$/.exec(line);
      if (headerMatch) {
        currentServerId = headerMatch[1] ?? headerMatch[2] ?? headerMatch[3];
        inSensitiveTable = headerMatch[4] === "env" || headerMatch[4] === "http_headers";
        return line;
      }
      if (/^\s*\[/.test(line)) {
        currentServerId = undefined;
        inSensitiveTable = false;
        return line;
      }
      const match = /^(\s*)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))(\s*=\s*)"((?:\\.|[^"\\])*)"(.*)$/.exec(line);
      if (!match || match[6] === undefined) return line;
      const keyName = match[2] ?? match[3] ?? match[4];
      if (!keyName) return line;
      const schemaSecrets = currentServerId && inSensitiveTable ? extraSecretKeys?.get(currentServerId) : undefined;
      if (!SENSITIVE_KEY_PATTERN.test(keyName) && !schemaSecrets?.has(keyName)) return line;
      let decoded = match[6];
      try {
        const parsed: unknown = JSON.parse(`"${match[6]}"`);
        if (typeof parsed === "string") decoded = parsed;
      } catch {
        // 保留原转义片段脱敏。
      }
      const keyToken = match[2] !== undefined ? `"${match[2]}"` : match[3] !== undefined ? `'${match[3]}'` : keyName;
      return `${match[1]}${keyToken}${match[5]}${JSON.stringify(maskSecretValue(decoded))}${match[7]}`;
    })
    .join(eol);
}

function mergeCodexToml(
  existing: string,
  id: string,
  nextBlock: string | undefined,
  allowBrokenMarkerRepair = false,
): string {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const normalized = existing.replace(/\r\n/g, "\n");
  const normalizedBlock = nextBlock?.replace(/\r\n/g, "\n");
  const extracted = extractDelimitedBlock(normalized, id);
  if (!extracted.valid) {
    if (!allowBrokenMarkerRepair) throw new Error(`Codex 配置文件中 ${id} 的受控区块边界不完整`);
    // 修复模式：剥离受损标记行与同名 mcp_servers 段落后重新插入干净受控区块。
    const { start: startMarker, end: endMarker } = codexMarkers(id);
    const keptLines: string[] = [];
    let skippingSection = false;
    const sectionHeader = new RegExp(`^\\s*\\[mcp_servers\\.(?:${id}|"${id}"|'${id}')(?:\\s*\\.|\\s*\\])`);
    for (const line of normalized.split("\n")) {
      if (line.includes(startMarker) || line.includes(endMarker)) continue;
      if (/^\s*\[/.test(line)) {
        skippingSection = sectionHeader.test(line);
      }
      if (!skippingSection) keptLines.push(line);
    }
    const cleaned = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (normalizedBlock === undefined) return cleaned ? `${cleaned}${eol}`.replace(/\n/g, eol) : "";
    const rebuilt = cleaned ? `${cleaned}\n\n${normalizedBlock}\n` : `${normalizedBlock}\n`;
    return rebuilt.replace(/\n/g, eol);
  }
  if (extracted.block !== undefined) {
    if (normalizedBlock === undefined) {
      const before = normalized.slice(0, extracted.start);
      const after = normalized.slice(extracted.end);
      const trimmedBefore = before.endsWith("\n\n") ? before.slice(0, -1) : before;
      const trimmedAfter = after.startsWith("\n") ? after.slice(1) : after;
      const combined = `${trimmedBefore}${trimmedAfter}`;
      return combined.trim() ? combined.replace(/\n/g, eol) : "";
    }
    return `${normalized.slice(0, extracted.start)}${normalizedBlock}${normalized.slice(extracted.end)}`.replace(/\n/g, eol);
  }
  if (normalizedBlock === undefined) return existing;
  if (!normalized.trim()) return `${normalizedBlock}\n`.replace(/\n/g, eol);
  const sep = normalized.endsWith("\n\n") ? "" : normalized.endsWith("\n") ? "\n" : "\n\n";
  return `${normalized}${sep}${normalizedBlock}\n`.replace(/\n/g, eol);
}

async function readTargetFile(targetPath: string): Promise<{ existed: boolean; text: string }> {
  await assertAssetDirectory(path.dirname(targetPath));
  if (!(await exists(targetPath))) return { existed: false, text: "" };
  const info = await lstat(targetPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`MCP 配置文件不是普通文件：${targetPath}`);
  }
  return { existed: true, text: await readFile(targetPath, "utf8") };
}

async function atomicWriteSecure(filePath: string, content: string): Promise<void> {
  await assertAssetDirectory(path.dirname(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await exists(filePath)) {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`目标文件不是普通文件：${filePath}`);
    }
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertMcpReceipt(value: unknown, toolId: McpToolId, id: string): asserts value is McpReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.id !== id || value.toolId !== toolId ||
    typeof value.title !== "string" || typeof value.version !== "string" ||
    typeof value.targetPath !== "string" || (value.transport !== "stdio" && value.transport !== "http") ||
    typeof value.installedAt !== "string" || typeof value.managedEntryDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.managedEntryDigest) ||
    !Array.isArray(value.envKeys) || !Array.isArray(value.secretKeys)) {
    throw new Error("MCP 安装记录已损坏，拒绝写入");
  }
}

interface PendingMcpPlan {
  preview: McpPreview;
  definition: McpServerDefinition;
  previous?: McpReceipt;
  previousReceiptText?: string;
  beforeRawText: string;
  beforeExisted: boolean;
  nextRawText: string;
  nextReceipt?: McpReceipt;
}

/** 跨 AI 工具的 MCP 安全配置引擎：密钥仅写本机配置、预览强制脱敏、漂移阻断、原子写入与失败回滚。 */
export class McpConfigEngine {
  private pending = new Map<string, PendingMcpPlan>();

  constructor(
    private readonly receiptsRoot: string,
    private readonly targets: Record<McpToolId, string>,
  ) {}

  clearPending(): void {
    this.pending.clear();
  }

  private async acquireLock(): Promise<string> {
    await assertAssetDirectory(this.receiptsRoot);
    await mkdir(this.receiptsRoot, { recursive: true });
    const lock = path.join(this.receiptsRoot, ".mcp-operation-lock");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mkdir(lock);
        await writeFile(
          path.join(lock, "lock.json"),
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          { mode: 0o600 },
        );
        return lock;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          if (attempt === 0) {
            let stale = false;
            try {
              const parsed: unknown = JSON.parse(await readFile(path.join(lock, "lock.json"), "utf8"));
              if (isRecord(parsed) && typeof parsed.pid === "number" && !isPidAlive(parsed.pid)) {
                stale = true;
              }
            } catch {
              try {
                const info = await lstat(lock);
                if (Date.now() - info.mtimeMs > STALE_MCP_LOCK_MS) stale = true;
              } catch {
                stale = false;
              }
            }
            if (stale) {
              await rm(lock, { recursive: true, force: true });
              continue;
            }
          }
          throw new Error("另一个 MCP 配置写入操作尚未结束");
        }
        throw error;
      }
    }
    throw new Error("另一个 MCP 配置写入操作尚未结束");
  }

  /** 仅在用户显式确认接管时补写本地 MCP 回执；绝不修改目标工具配置文件，也绝不覆盖已有回执。 */
  async adoptReceipt(receipt: McpReceipt): Promise<McpReceipt> {
    assertMcpReceipt(receipt, receipt.toolId, receipt.id);
    const lock = await this.acquireLock();
    try {
      const file = this.receiptFile(receipt.toolId, receipt.id);
      if (await exists(file)) throw new Error("此 MCP 已有安装记录，拒绝覆盖");
      await atomicWriteSecure(file, `${JSON.stringify(receipt, null, 2)}\n`);
      return receipt;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  /** 显式移除本地 MCP 回执（不修改目标工具配置文件），用于解除冲突/损坏配置死锁或清理失效记录。 */
  async forgetReceipt(toolId: McpToolId, id: string): Promise<void> {
    if (!Object.hasOwn(this.targets, toolId)) throw new Error("不支持的 MCP 目标工具");
    const lock = await this.acquireLock();
    try {
      const file = this.receiptFile(toolId, id);
      if (!(await exists(file))) throw new Error("智枢没有该 MCP 在所选工具的安装记录");
      await rm(file, { force: true });
      this.pending.clear();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  private receiptFile(toolId: McpToolId, id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("MCP 标识无效");
    return path.join(this.receiptsRoot, `${toolId}--${id}.json`);
  }

  private async loadReceipt(toolId: McpToolId, id: string): Promise<{ value?: McpReceipt; text?: string }> {
    await assertAssetDirectory(this.receiptsRoot);
    const file = this.receiptFile(toolId, id);
    if (!(await exists(file))) return {};
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("MCP 安装记录不是普通文件");
    const text = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(text);
    assertMcpReceipt(parsed, toolId, id);
    return { value: parsed, text };
  }

  async list(): Promise<Array<McpReceipt & { issues: string[] }>> {
    await assertAssetDirectory(this.receiptsRoot);
    if (!(await exists(this.receiptsRoot))) return [];
    const results: Array<McpReceipt & { issues: string[] }> = [];
    for (const entry of (await readdir(this.receiptsRoot)).sort()) {
      const match = /^(antigravity|codex)--([a-z0-9-]+)\.json$/.exec(entry);
      if (!match || !match[1] || !match[2]) continue;
      const toolId = match[1] as McpToolId;
      const id = match[2];
      const loaded = (await this.loadReceipt(toolId, id)).value;
      if (!loaded) continue;
      const issues = await this.validate(loaded);
      results.push({ ...loaded, issues });
    }
    return results;
  }

  async validate(receipt: McpReceipt): Promise<string[]> {
    const targetPath = this.targets[receipt.toolId];
    if (path.resolve(receipt.targetPath) !== path.resolve(targetPath)) {
      return ["MCP 目标配置路径与当前工具环境不一致"];
    }
    let target: { existed: boolean; text: string };
    try {
      target = await readTargetFile(targetPath);
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
    if (!target.existed) return [`配置文件缺失：${targetPath}`];
    if (receipt.toolId === "antigravity") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(target.text);
      } catch {
        return ["Antigravity MCP 配置文件不是合法 JSON"];
      }
      if (!isRecord(parsed) || !isRecord(parsed.mcpServers) || !isRecord(parsed.mcpServers[receipt.id])) {
        return [`配置文件中缺少受管 MCP 项：${receipt.id}`];
      }
      const canonicalDigest = sha256(canonicalJsonStringify(parsed.mcpServers[receipt.id]));
      const legacyDigest = sha256(JSON.stringify(parsed.mcpServers[receipt.id]));
      if (canonicalDigest !== receipt.managedEntryDigest && legacyDigest !== receipt.managedEntryDigest) {
        return [`受管 MCP 配置已发生漂移：${receipt.id}`];
      }
      return [];
    }
    const normalizedToml = target.text.replace(/\r\n/g, "\n");
    const extracted = extractDelimitedBlock(normalizedToml, receipt.id);
    if (!extracted.valid) return [`Codex 配置文件中 ${receipt.id} 的受控区块边界不完整`];
    if (!extracted.block) return [`Codex 配置文件中缺少受管 MCP 区块：${receipt.id}`];
    if (sha256(extracted.block) !== receipt.managedEntryDigest) {
      return [`Codex 受管 MCP 区块已发生漂移：${receipt.id}`];
    }
    return [];
  }

  async preview(
    action: "install" | "update" | "uninstall",
    toolId: McpToolId,
    definition: McpServerDefinition,
    rawEnvValues: Record<string, string> = {},
    options: {
      allowConflictOverride?: boolean;
      allSchemas?: ReadonlyMap<string, readonly McpEnvField[]>;
      allSecretKeys?: ReadonlyMap<string, readonly string[]>;
    } = {},
  ): Promise<McpPreview> {
    const allowConflictOverride = options.allowConflictOverride === true;
    if (!Object.hasOwn(this.targets, toolId)) throw new Error("不支持的 MCP 目标工具");
    assertMcpServerDefinition(definition);
    const targetPath = this.targets[toolId];
    const loadedReceipt = await this.loadReceipt(toolId, definition.id);
    const previous = loadedReceipt.value;

    if (action === "install" && previous) throw new Error("该 MCP 已安装在所选工具中，请使用更新");
    if (action !== "install" && !previous) throw new Error("智枢没有该 MCP 在所选工具的安装记录");

    const envValues = action === "uninstall" ? {} : checkedEnvValues(definition, rawEnvValues);
    const target = await readTargetFile(targetPath);
    const conflicts: string[] = previous && !allowConflictOverride ? await this.validate(previous) : [];

    // 合并全部已知 MCP 敏感键集合，避免预览时误泄自定义 secret: true 字段。
    const schemaMap = new Map<string, readonly McpEnvField[]>();
    if (options.allSchemas) {
      for (const [k, v] of options.allSchemas) schemaMap.set(k, v);
    }
    schemaMap.set(definition.id, definition.envSchema);
    const secretKeysMap = new Map<string, Set<string>>();
    for (const [k, fields] of schemaMap) {
      const set = secretKeysMap.get(k) ?? new Set<string>();
      for (const field of fields) {
        if (field.secret) set.add(field.key);
      }
      secretKeysMap.set(k, set);
    }
    if (options.allSecretKeys) {
      for (const [k, keys] of options.allSecretKeys) {
        const set = secretKeysMap.get(k) ?? new Set<string>();
        for (const key of keys) set.add(key);
        secretKeysMap.set(k, set);
      }
    }
    if (previous?.secretKeys.length) {
      const set = secretKeysMap.get(definition.id) ?? new Set<string>();
      for (const key of previous.secretKeys) set.add(key);
      secretKeysMap.set(definition.id, set);
    }

    let nextRawText = "";
    let maskedBefore = "";
    let maskedAfter = "";
    let managedEntryDigest = "";

    if (toolId === "antigravity") {
      let parsed: Record<string, unknown> = {};
      let jsonBroken = false;
      if (target.existed && target.text.trim()) {
        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(target.text);
        } catch {
          jsonBroken = true;
          if (!conflicts.some((c) => c.includes("不是合法 JSON"))) {
            conflicts.push(`无法解析现有配置 JSON：${targetPath}`);
          }
        }
        if (!jsonBroken) {
          if (!isRecord(rawParsed)) {
            jsonBroken = true;
            conflicts.push(`配置文件根节点必须是 JSON 对象：${targetPath}`);
          } else {
            parsed = rawParsed;
          }
        }
      }
      if (jsonBroken) {
        maskedBefore = target.text;
        maskedAfter = "（现有配置文件 JSON 损坏，无法自动合并，请先修复文件或仅清除智枢记录）";
      } else {
        const existingServers: Record<string, unknown> = isRecord(parsed.mcpServers) ? { ...parsed.mcpServers } : {};
        if (!previous && !allowConflictOverride && Object.hasOwn(existingServers, definition.id)) {
          conflicts.push(`配置文件中已存在同名的未知 MCP 配置：${definition.id}，拒绝覆盖`);
        }

        const maskedExisting = maskAnyAntigravityJson(parsed, schemaMap);
        // 同步按 persisted secretKeys 脱敏其它已装自定义 MCP
        if (isRecord(maskedExisting.mcpServers)) {
          for (const [serverKey, serverVal] of Object.entries(maskedExisting.mcpServers)) {
            const extraKeys = secretKeysMap.get(serverKey);
            if (!extraKeys?.size || !isRecord(serverVal)) continue;
            for (const sub of ["env", "headers"] as const) {
              if (!isRecord(serverVal[sub])) continue;
              const subObj = serverVal[sub] as Record<string, unknown>;
              for (const key of extraKeys) {
                if (typeof subObj[key] === "string") subObj[key] = maskSecretValue(subObj[key] as string);
              }
            }
          }
        }
        maskedBefore = target.existed
          ? `${JSON.stringify(maskedExisting, null, 2)}\n`
          : "（目标文件尚未创建）";

        const nextServers = { ...existingServers };
        const nextMaskedServers: Record<string, unknown> = isRecord(maskedExisting.mcpServers)
          ? { ...(maskedExisting.mcpServers as Record<string, unknown>) }
          : {};

        if (action === "uninstall") {
          delete nextServers[definition.id];
          delete nextMaskedServers[definition.id];
        } else {
          const realEntry = buildAntigravityEntry(definition, envValues, false);
          const maskedEntry = buildAntigravityEntry(definition, envValues, true);
          managedEntryDigest = sha256(canonicalJsonStringify(realEntry));
          nextServers[definition.id] = realEntry;
          nextMaskedServers[definition.id] = maskedEntry;
        }

        const nextRoot = { ...parsed, mcpServers: nextServers };
        const nextMaskedRoot = { ...maskedExisting, mcpServers: nextMaskedServers };
        nextRawText = `${JSON.stringify(nextRoot, null, 2)}\n`;
        maskedAfter = `${JSON.stringify(nextMaskedRoot, null, 2)}\n`;
      }
    } else {
      const unmanagedSection = new RegExp(`^\\s*\\[mcp_servers\\.(?:${definition.id}|"${definition.id}"|'${definition.id}')(?:\\s*\\.|\\s*\\])`, "m");
      const existingBlock = extractDelimitedBlock(target.text.replace(/\r\n/g, "\n"), definition.id);
      if (!existingBlock.valid && !allowConflictOverride) {
        if (!conflicts.some((c) => c.includes("受控区块边界不完整"))) {
          conflicts.push(`Codex 配置文件中 ${definition.id} 的受控区块边界不完整`);
        }
      }
      if (!previous && !allowConflictOverride && unmanagedSection.test(target.text)) {
        conflicts.push(`Codex 配置中已存在同名的未知 MCP 段落 [mcp_servers.${definition.id}]，拒绝覆盖`);
      }
      maskedBefore = target.existed ? maskCodexTomlText(target.text, secretKeysMap) : "（目标文件尚未创建）";
      if (!existingBlock.valid && !allowConflictOverride) {
        maskedAfter = "（现有配置受控区块边界损坏，请选择「覆盖修复」重建受控区块或先手工修正）";
      } else if (action === "uninstall") {
        nextRawText = mergeCodexToml(target.text, definition.id, undefined, allowConflictOverride);
        maskedAfter = nextRawText ? maskCodexTomlText(nextRawText, secretKeysMap) : "（受管区块已移除）";
      } else {
        const realBlock = renderCodexBlock(definition, envValues, false);
        const maskedBlock = renderCodexBlock(definition, envValues, true);
        managedEntryDigest = sha256(realBlock);
        nextRawText = mergeCodexToml(target.text, definition.id, realBlock, allowConflictOverride);
        maskedAfter = mergeCodexToml(maskCodexTomlText(target.text, secretKeysMap), definition.id, maskedBlock, allowConflictOverride);
      }
    }

    const token = randomUUID();
    const preview: McpPreview = {
      token,
      action,
      toolId,
      id: definition.id,
      title: definition.title,
      version: definition.version,
      targetPath,
      maskedBefore,
      maskedAfter,
      conflicts,
    };

    const nextReceipt: McpReceipt | undefined =
      action === "uninstall"
        ? undefined
        : {
            schemaVersion: 1,
            id: definition.id,
            title: definition.title,
            version: definition.version,
            toolId,
            targetPath,
            transport: definition.transport,
            installedAt: new Date().toISOString(),
            managedEntryDigest,
            envKeys: Object.keys(envValues).sort(),
            secretKeys: Object.keys(envValues)
              .filter((key) => isSensitiveEnvKey(key, definition.envSchema))
              .sort(),
          };

    this.pending.clear();
    this.pending.set(token, {
      preview,
      definition,
      previous,
      previousReceiptText: loadedReceipt.text,
      beforeRawText: target.text,
      beforeExisted: target.existed,
      nextRawText,
      nextReceipt,
    });
    return preview;
  }

  async apply(token: string): Promise<McpReceipt | undefined> {
    const plan = this.pending.get(token);
    if (!plan) throw new Error("MCP 变更预览已失效，请重新预览");
    if (plan.preview.conflicts.length) throw new Error("存在冲突，拒绝写入 MCP 配置");

    const lock = await this.acquireLock();

    const { preview, beforeRawText, beforeExisted, nextRawText, nextReceipt, previousReceiptText } = plan;
    const receiptPath = this.receiptFile(preview.toolId, preview.id);
    let wroteTarget = false;
    let committed = false;

    try {
      const currentTarget = await readTargetFile(preview.targetPath);
      const currentReceipt = await this.loadReceipt(preview.toolId, preview.id);
      if (currentTarget.existed !== beforeExisted || currentTarget.text !== beforeRawText || currentReceipt.text !== previousReceiptText) {
        this.pending.delete(token);
        throw new Error("目标配置文件在预览后发生变化，请重新预览");
      }
      await atomicWriteSecure(preview.targetPath, nextRawText);
      wroteTarget = true;
      if (nextReceipt) {
        await atomicWriteSecure(receiptPath, `${JSON.stringify(nextReceipt, null, 2)}\n`);
      } else {
        await rm(receiptPath);
      }
      committed = true;
      this.pending.delete(token);
      return nextReceipt;
    } catch (error) {
      if (!committed && wroteTarget) {
        try {
          if (beforeExisted) await atomicWriteSecure(preview.targetPath, beforeRawText);
          else await rm(preview.targetPath, { force: true });
          if (previousReceiptText !== undefined) await atomicWriteSecure(receiptPath, previousReceiptText);
          else await rm(receiptPath, { force: true });
        } catch {
          // 回滚失败时不掩盖原始错误。
        }
      }
      throw error;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
