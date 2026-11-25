#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

export const DEFAULT_FORBIDDEN_VERBS = /预览安装|预览更新|预览卸载|预览并|预览变更并应用/;
export const DEFAULT_PLACEHOLDER_PATTERN = /\b(?:TODO|FIXME|lorem|ipsum|placeholder)\b|待补充|占位/i;
export const DEFAULT_ARCH_LEAK_PATTERN =
  /(?:CLI\s*返回码|进程间通信|数据库表|SQL\s*查询|JSON\s*Schema|HTTP\s*[45]\d\d|\b\d{2,4}px\b)/i;

/**
 * 纯 Node.js 零依赖读取 ZIP 归档中的普通文件条目（支持 Store 与 Deflate）。
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error("无效的 ZIP 文件：文件过短或格式损坏");
  }
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("无效的 ZIP 文件：缺少中央目录结束标记（EOCD）");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirOffset + centralDirSize > buffer.length) {
    throw new Error("无效的 ZIP 文件：中央目录越界");
  }

  const entries = new Map();
  let cursor = centralDirOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`无效的 ZIP 文件：第 ${index + 1} 条中央目录签名损坏`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;
    if (name.includes("..") || path.posix.isAbsolute(name)) {
      throw new Error(`ZIP 条目路径不安全：${name}`);
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`ZIP 本地文件头损坏：${name}`);
    }
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new Error(`ZIP 条目数据越界：${name}`);
    }
    const raw = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`不支持的 ZIP 压缩方式（method=${method}）：${name}`);
    }
    entries.set(name, data);
  }
  return entries;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseAttributes(raw) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(raw)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

/**
 * 轻量解析 XMind 8 content.xml 为统一树结构。
 * @param {string} xml
 */
function parseXmindXml(xml) {
  const tokenRegex = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([a-zA-Z0-9_:-]+)\s*>|<([a-zA-Z0-9_:-]+)([^>]*?)(\/?)>/g;
  const root = { tag: "__root__", attrs: {}, children: [], text: "" };
  const stack = [root];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(xml)) !== null) {
    if (match.index > lastIndex) {
      const chunk = xml.slice(lastIndex, match.index);
      stack[stack.length - 1].text += decodeXmlEntities(chunk);
    }
    lastIndex = tokenRegex.lastIndex;

    const [full, closeTag, openTag, rawAttrs, selfClosing] = match;
    if (full.startsWith("<!--") || full.startsWith("<?")) continue;
    if (closeTag) {
      if (stack.length <= 1 || stack[stack.length - 1].tag !== closeTag) {
        throw new Error(`XML 标签未正确闭合：</${closeTag}>`);
      }
      stack.pop();
    } else if (openTag) {
      const node = {
        tag: openTag,
        attrs: parseAttributes(rawAttrs || ""),
        children: [],
        text: "",
      };
      stack[stack.length - 1].children.push(node);
      if (selfClosing !== "/") {
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) {
    throw new Error(`XML 存在未闭合标签：<${stack[stack.length - 1].tag}>`);
  }

  const workbook = root.children.find((child) => child.tag === "xmap-content");
  if (!workbook) {
    throw new Error("content.xml 缺少 <xmap-content> 根节点");
  }

  function convertTopic(el) {
    const titleEl = el.children.find((c) => c.tag === "title");
    const title = (titleEl?.text ?? "").trim();
    const childrenContainer = el.children.find((c) => c.tag === "children");
    const attached = [];
    const summaryTopics = new Map();
    if (childrenContainer) {
      for (const topicsGroup of childrenContainer.children) {
        if (topicsGroup.tag !== "topics") continue;
        const type = topicsGroup.attrs.type || "attached";
        for (const childTopic of topicsGroup.children) {
          if (childTopic.tag !== "topic") continue;
          const converted = convertTopic(childTopic);
          if (type === "summary") {
            summaryTopics.set(converted.id, converted);
          } else {
            attached.push(converted);
          }
        }
      }
    }
    const summariesEl = el.children.find((c) => c.tag === "summaries");
    const summaries = [];
    if (summariesEl) {
      for (const sumEl of summariesEl.children) {
        if (sumEl.tag !== "summary") continue;
        const topicId = sumEl.attrs["topic-id"] || "";
        const range = sumEl.attrs.range || "";
        const target = summaryTopics.get(topicId);
        summaries.push({
          id: sumEl.attrs.id || "",
          range,
          topicId,
          title: target?.title ?? "",
          validTopicRef: Boolean(target),
        });
      }
    }
    return {
      id: el.attrs.id || "",
      title,
      children: attached,
      summaries,
    };
  }

  const sheets = workbook.children
    .filter((child) => child.tag === "sheet")
    .map((sheetEl) => {
      const titleEl = sheetEl.children.find((c) => c.tag === "title");
      const rootTopicEl = sheetEl.children.find((c) => c.tag === "topic");
      return {
        id: sheetEl.attrs.id || "",
        title: (titleEl?.text ?? "").trim(),
        rootTopic: rootTopicEl ? convertTopic(rootTopicEl) : null,
      };
    });

  return { format: "xmind-xml", sheets };
}

/**
 * 解析 XMind Zen / 新版 content.json 为统一树结构。
 * @param {string} jsonText
 */
function parseXmindJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("content.json 顶层必须为画布数组");
  }

  function convertTopic(topic) {
    const attached = Array.isArray(topic?.children?.attached)
      ? topic.children.attached.map(convertTopic)
      : [];
    const summaryTopics = new Map();
    if (Array.isArray(topic?.children?.summary)) {
      for (const st of topic.children.summary) {
        const converted = convertTopic(st);
        summaryTopics.set(converted.id, converted);
      }
    }
    const summaries = Array.isArray(topic?.summaries)
      ? topic.summaries.map((sum) => {
          const topicId = sum.topicId || "";
          const target = summaryTopics.get(topicId);
          return {
            id: sum.id || "",
            range: sum.range || "",
            topicId,
            title: target?.title ?? "",
            validTopicRef: Boolean(target),
          };
        })
      : [];
    return {
      id: String(topic?.id ?? ""),
      title: String(topic?.title ?? "").trim(),
      children: attached,
      summaries,
    };
  }

  return {
    format: "xmind-json",
    sheets: parsed.map((sheet) => ({
      id: String(sheet?.id ?? ""),
      title: String(sheet?.title ?? "").trim(),
      rootTopic: sheet?.rootTopic ? convertTopic(sheet.rootTopic) : null,
    })),
  };
}

function isPureChinese(text) {
  return /^[\u4e00-\u9fff]+$/.test(text);
}

/**
 * 校验 XMind 产品结构图文件。
 * @param {string} filePath
 * @param {{
 *   maxDepth?: number;
 *   maxZhLen?: number;
 *   maxSheets?: number;
 *   requireSummary?: boolean;
 *   forbidRegex?: RegExp;
 *   checkArchLeak?: boolean;
 * }} [options]
 */
export async function validateXmindFile(filePath, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const maxZhLen = options.maxZhLen ?? 7;
  const maxSheets = options.maxSheets ?? 1;
  const requireSummary = options.requireSummary ?? false;
  const forbidRegex = options.forbidRegex ?? DEFAULT_FORBIDDEN_VERBS;
  const checkArchLeak = options.checkArchLeak ?? true;

  const buffer = await readFile(filePath);
  const entries = readZipEntries(buffer);

  let workbook;
  if (entries.has("content.json")) {
    workbook = parseXmindJson(entries.get("content.json").toString("utf8"));
  } else if (entries.has("content.xml")) {
    workbook = parseXmindXml(entries.get("content.xml").toString("utf8"));
  } else {
    throw new Error("XMind 归档中既无 content.json 也无 content.xml");
  }

  const issues = [];
  if (workbook.sheets.length === 0) {
    issues.push("结构图不包含任何画布（sheet）");
  } else if (maxSheets > 0 && workbook.sheets.length > maxSheets) {
    issues.push(`画布数量为 ${workbook.sheets.length}，超过单产品主画布上限 ${maxSheets}`);
  }

  let totalNodes = 0;
  let observedMaxDepth = 0;
  let summaryCount = 0;

  function checkLabel(label, trail, depth) {
    if (!label) {
      issues.push(`存在空标题节点：${trail}`);
      return;
    }
    if (forbidRegex.test(label)) {
      issues.push(`命中禁用拼接动词「${label}」（路径：${trail}）`);
    }
    if (DEFAULT_PLACEHOLDER_PATTERN.test(label)) {
      issues.push(`存在未清理占位文案「${label}」（路径：${trail}）`);
    }
    if (checkArchLeak && DEFAULT_ARCH_LEAK_PATTERN.test(label)) {
      issues.push(`疑似混入技术实现/像素规格描述「${label}」（路径：${trail}）`);
    }
    if (depth > 0 && maxZhLen > 0 && isPureChinese(label) && [...label].length > maxZhLen) {
      issues.push(`纯中文节点超过 ${maxZhLen} 字（${[...label].length} 字）：「${label}」（路径：${trail}）`);
    }
  }

  function visit(topic, depth, ancestors) {
    totalNodes++;
    if (depth > observedMaxDepth) observedMaxDepth = depth;
    const trail = [...ancestors, topic.title || "(空)"].join(" / ");
    if (depth > maxDepth) {
      issues.push(`节点深度 ${depth} 超过上限 ${maxDepth}：${trail}`);
    }
    checkLabel(topic.title, trail, depth);

    for (const summary of topic.summaries) {
      summaryCount++;
      if (!summary.validTopicRef) {
        issues.push(`原生概要缺少有效目标主题引用（topic-id=${summary.topicId}，路径：${trail}）`);
      } else {
        checkLabel(summary.title, `${trail} [概要]`, depth + 1);
      }
      const rangeMatch = /^\((\d+),(\d+)\)$/.exec(summary.range);
      if (!rangeMatch) {
        issues.push(`原生概要 range 格式不合法（${summary.range}，路径：${trail}）`);
      } else {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (start > end || end >= topic.children.length) {
          issues.push(`原生概要 range 越界（${summary.range}，子节点数=${topic.children.length}，路径：${trail}）`);
        }
      }
    }

    for (const child of topic.children) {
      visit(child, depth + 1, [...ancestors, topic.title || "(空)"]);
    }
  }

  for (const sheet of workbook.sheets) {
    if (!sheet.rootTopic) {
      issues.push(`画布「${sheet.title || sheet.id}」缺少根主题`);
      continue;
    }
    visit(sheet.rootTopic, 0, []);
  }

  if (requireSummary && summaryCount === 0) {
    issues.push("未检测到任何原生概要（summary）节点");
  }

  return {
    valid: issues.length === 0,
    format: workbook.format,
    sheets: workbook.sheets.length,
    totalNodes,
    maxDepth: observedMaxDepth,
    summaryCount,
    issues,
  };
}

function parseCliArgs(argv) {
  const args = {
    file: "",
    maxDepth: 6,
    maxZhLen: 7,
    maxSheets: 1,
    requireSummary: false,
    checkArchLeak: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--max-depth") args.maxDepth = Number(argv[++i]);
    else if (token === "--max-zh-len") args.maxZhLen = Number(argv[++i]);
    else if (token === "--max-sheets") args.maxSheets = Number(argv[++i]);
    else if (token === "--require-summary") args.requireSummary = true;
    else if (token === "--no-arch-leak-check") args.checkArchLeak = false;
    else if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") {
      console.log(
        "用法：node validate-xmind.mjs <file.xmind> [--max-depth 6] [--max-zh-len 7] [--max-sheets 1] [--require-summary] [--json]",
      );
      process.exit(0);
    } else if (!token.startsWith("--") && !args.file) {
      args.file = token;
    } else {
      throw new Error(`未知参数：${token}`);
    }
  }
  if (!args.file) {
    throw new Error("请提供待校验的 .xmind 文件路径");
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const result = await validateXmindFile(path.resolve(cli.file), cli);
    if (cli.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.valid) {
      console.log(
        `XMind 结构图校验通过（${result.format}）：${result.sheets} 画布，${result.totalNodes} 节点，最大深度 ${result.maxDepth}，原生概要 ${result.summaryCount} 处`,
      );
    } else {
      console.error(`XMind 结构图校验失败（发现 ${result.issues.length} 项问题）：`);
      for (const issue of result.issues) console.error(`- ${issue}`);
    }
    if (!result.valid) process.exit(1);
  } catch (error) {
    console.error(`XMind 校验异常：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
