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
const SENSITIVE_KEY_PATTERN = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
    if (!isRecord(field) || typeof field.key !== "string" || !ENV_KEY_PATTERN.test(field.key) ||
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
    if (!ENV_KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key)) throw new Error(`参数名不合法：${key}`);
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

function maskCodexTomlText(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const match = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)"((?:\\.|[^"\\])*)"(.*)$/.exec(line);
      if (!match || !match[2] || match[4] === undefined) return line;
      if (!SENSITIVE_KEY_PATTERN.test(match[2])) return line;
      let decoded = match[4];
      try {
        const parsed: unknown = JSON.parse(`"${match[4]}"`);
        if (typeof parsed === "string") decoded = parsed;
      } catch {
        // 保留原转义片段脱敏。
      }
      return `${match[1]}${match[2]}${match[3]}${JSON.stringify(maskSecretValue(decoded))}${match[5]}`;
    })
    .join("\n");
}

function mergeCodexToml(existing: string, id: string, nextBlock: string | undefined): string {
  const extracted = extractDelimitedBlock(existing, id);
  if (!extracted.valid) throw new Error(`Codex 配置文件中 ${id} 的受控区块边界不完整`);
  if (extracted.block !== undefined) {
    if (nextBlock === undefined) {
      const before = existing.slice(0, extracted.start);
      const after = existing.slice(extracted.end);
      const trimmedBefore = before.endsWith("\n\n") ? before.slice(0, -1) : before;
      const trimmedAfter = after.startsWith("\n") ? after.slice(1) : after;
      const combined = `${trimmedBefore}${trimmedAfter}`;
      return combined.trim() ? combined : "";
    }
    return `${existing.slice(0, extracted.start)}${nextBlock}${existing.slice(extracted.end)}`;
  }
  if (nextBlock === undefined) return existing;
  if (!existing.trim()) return `${nextBlock}\n`;
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${nextBlock}\n`;
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
      const entryDigest = sha256(JSON.stringify(parsed.mcpServers[receipt.id]));
      if (entryDigest !== receipt.managedEntryDigest) {
        return [`受管 MCP 配置已发生漂移：${receipt.id}`];
      }
      return [];
    }
    const extracted = extractDelimitedBlock(target.text, receipt.id);
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
  ): Promise<McpPreview> {
    if (!Object.hasOwn(this.targets, toolId)) throw new Error("不支持的 MCP 目标工具");
    assertMcpServerDefinition(definition);
    const targetPath = this.targets[toolId];
    const loadedReceipt = await this.loadReceipt(toolId, definition.id);
    const previous = loadedReceipt.value;

    if (action === "install" && previous) throw new Error("该 MCP 已安装在所选工具中，请使用更新");
    if (action !== "install" && !previous) throw new Error("智枢没有该 MCP 在所选工具的安装记录");

    const envValues = action === "uninstall" ? {} : checkedEnvValues(definition, rawEnvValues);
    const target = await readTargetFile(targetPath);
    const conflicts: string[] = previous ? await this.validate(previous) : [];

    let nextRawText = "";
    let maskedBefore = "";
    let maskedAfter = "";
    let managedEntryDigest = "";

    if (toolId === "antigravity") {
      let parsed: Record<string, unknown> = {};
      if (target.existed && target.text.trim()) {
        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(target.text);
        } catch {
          throw new Error(`无法解析现有配置 JSON：${targetPath}`);
        }
        if (!isRecord(rawParsed)) throw new Error(`配置文件根节点必须是 JSON 对象：${targetPath}`);
        parsed = rawParsed;
      }
      const existingServers: Record<string, unknown> = isRecord(parsed.mcpServers) ? { ...parsed.mcpServers } : {};
      if (!previous && Object.hasOwn(existingServers, definition.id)) {
        conflicts.push(`配置文件中已存在同名的未知 MCP 配置：${definition.id}，拒绝覆盖`);
      }

      const schemaMap = new Map<string, readonly McpEnvField[]>([[definition.id, definition.envSchema]]);
      maskedBefore = target.existed
        ? `${JSON.stringify(maskAnyAntigravityJson(parsed, schemaMap), null, 2)}\n`
        : "（目标文件尚未创建）";

      const nextServers = { ...existingServers };
      const nextMaskedServers: Record<string, unknown> = isRecord(maskAnyAntigravityJson(parsed, schemaMap).mcpServers)
        ? { ...(maskAnyAntigravityJson(parsed, schemaMap).mcpServers as Record<string, unknown>) }
        : {};

      if (action === "uninstall") {
        delete nextServers[definition.id];
        delete nextMaskedServers[definition.id];
      } else {
        const realEntry = buildAntigravityEntry(definition, envValues, false);
        const maskedEntry = buildAntigravityEntry(definition, envValues, true);
        managedEntryDigest = sha256(JSON.stringify(realEntry));
        nextServers[definition.id] = realEntry;
        nextMaskedServers[definition.id] = maskedEntry;
      }

      const nextRoot = { ...parsed, mcpServers: nextServers };
      const nextMaskedRoot = { ...parsed, mcpServers: nextMaskedServers };
      nextRawText = `${JSON.stringify(nextRoot, null, 2)}\n`;
      maskedAfter = `${JSON.stringify(nextMaskedRoot, null, 2)}\n`;
    } else {
      const unmanagedSection = new RegExp(`^\\[mcp_servers\\.${definition.id}(?:\\.|\\])`, "m");
      const existingBlock = extractDelimitedBlock(target.text, definition.id);
      if (!existingBlock.valid) {
        conflicts.push(`Codex 配置文件中 ${definition.id} 的受控区块边界不完整`);
      }
      if (!previous && unmanagedSection.test(target.text)) {
        conflicts.push(`Codex 配置中已存在同名的未知 MCP 段落 [mcp_servers.${definition.id}]，拒绝覆盖`);
      }
      maskedBefore = target.existed ? maskCodexTomlText(target.text) : "（目标文件尚未创建）";
      if (action === "uninstall") {
        nextRawText = mergeCodexToml(target.text, definition.id, undefined);
        maskedAfter = nextRawText ? maskCodexTomlText(nextRawText) : "（受管区块已移除）";
      } else {
        const realBlock = renderCodexBlock(definition, envValues, false);
        const maskedBlock = renderCodexBlock(definition, envValues, true);
        managedEntryDigest = sha256(realBlock);
        nextRawText = mergeCodexToml(target.text, definition.id, realBlock);
        maskedAfter = mergeCodexToml(maskCodexTomlText(target.text), definition.id, maskedBlock);
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

    await assertAssetDirectory(this.receiptsRoot);
    await mkdir(this.receiptsRoot, { recursive: true });
    const lock = path.join(this.receiptsRoot, ".mcp-operation-lock");
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("另一个 MCP 配置写入操作尚未结束");
      }
      throw error;
    }

    const { preview, beforeRawText, beforeExisted, nextRawText, nextReceipt, previousReceiptText } = plan;
    const receiptPath = this.receiptFile(preview.toolId, preview.id);
    let wroteTarget = false;
    let committed = false;

    try {
      const currentTarget = await readTargetFile(preview.targetPath);
      const currentReceipt = await this.loadReceipt(preview.toolId, preview.id);
      if (currentTarget.existed !== beforeExisted || currentTarget.text !== beforeRawText || currentReceipt.text !== previousReceiptText) {
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
