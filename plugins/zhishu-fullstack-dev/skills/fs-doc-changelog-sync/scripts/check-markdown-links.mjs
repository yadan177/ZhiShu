#!/usr/bin/env node

import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function extractAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .replace(/`([^`]*)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!base) continue;
    const seen = counts.get(base) ?? 0;
    anchors.add(seen ? `${base}-${seen}` : base);
    counts.set(base, seen + 1);
  }
  return anchors;
}

async function collectMarkdownFiles(targetDir, results = []) {
  for (const entry of await readdir(targetDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(full, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 扫描指定目录下所有 Markdown 文件的相对路径链接与标题锚点有效性。
 * @param {string} targetDir
 */
export async function checkMarkdownLinks(targetDir) {
  const root = path.resolve(targetDir);
  const files = (await collectMarkdownFiles(root)).sort();
  const anchorCache = new Map();
  const issues = [];

  async function readCached(file) {
    if (!anchorCache.has(file)) {
      try {
        const content = await readFile(file, "utf8");
        anchorCache.set(file, { exists: true, anchors: extractAnchors(content) });
      } catch {
        anchorCache.set(file, { exists: false, anchors: new Set() });
      }
    }
    return anchorCache.get(file);
  }

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relFile = path.relative(root, file);
    let inFence = false;
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const cleaned = line.replace(/`[^`]*`/g, "");
      for (const match of cleaned.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']+["'])?\)/g)) {
        const raw = match[1].startsWith("<") && match[1].endsWith(">") ? match[1].slice(1, -1) : match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("#") || raw.includes("<") || raw.includes(">")) continue;
        let decoded;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          issues.push(`${relFile}:${index + 1} 链接编码不合法：${raw}`);
          continue;
        }
        const [withoutFragment, fragment] = decoded.split("#", 2);
        const localPath = withoutFragment.split("?", 1)[0];
        const target = localPath ? path.resolve(path.dirname(file), localPath) : file;
        try {
          await access(target);
        } catch {
          issues.push(`${relFile}:${index + 1} 目标文件不存在：${raw}`);
          continue;
        }
        if (fragment && target.endsWith(".md")) {
          const info = await readCached(target);
          if (!info.anchors.has(fragment.toLowerCase()) && !info.anchors.has(fragment)) {
            issues.push(`${relFile}:${index + 1} 标题锚点不存在：${raw}`);
          }
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    checkedFiles: files.length,
    issues,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || ".";
  const result = await checkMarkdownLinks(dir);
  if (result.valid) {
    console.log(`Markdown 相对链接检查通过：共检查 ${result.checkedFiles} 份文档`);
  } else {
    console.error(`Markdown 相对链接检查发现 ${result.issues.length} 处问题：`);
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exit(1);
  }
}
