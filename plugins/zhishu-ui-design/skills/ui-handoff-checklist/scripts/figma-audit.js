// 通用 Figma 设计稿交付前结构与规范审计脚本（通过 Figma MCP `use_figma` 直接执行）
// 使用方式：将本脚本作为 `use_figma` 的 code 参数运行；可按项目需要微调顶部的 CONFIG 选项。

const CONFIG = {
  // 留空数组则检查全部页面；也可传入页面名称关键词（如 ["界面设计"]）只审计界面页
  designPageKeywords: ["界面", "UI", "Screen", "Design", "页面"],
  componentPageKeywords: ["组件", "Component", "Design System", "品牌", "Token"],
  requireSectionsOnDesignPages: true,
  requireBoundVariables: true,
  minArtboardSize: 320,
  forbiddenVerbRegex: /预览安装|预览更新|预览卸载|预览并|预览变更并应用/,
  placeholderRegex: /\b(?:TODO|FIXME|lorem|ipsum|placeholder)\b|待补充|占位/i,
};

function matchesAny(text, keywords) {
  const lower = String(text || "").toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function boxOverlaps(a, b, tolerance = 1) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > tolerance && oy > tolerance ? { ox: Math.round(ox), oy: Math.round(oy) } : null;
}

const errors = [];
const warnings = [];
const pageReports = [];

for (const page of figma.root.children) {
  await page.loadAsync();
  const isDesignPage = matchesAny(page.name, CONFIG.designPageKeywords);
  const isComponentPage = matchesAny(page.name, CONFIG.componentPageKeywords);

  const sections = [];
  const orphanFrames = [];
  const artboards = [];
  const textViolations = [];
  const placeholders = [];
  const layoutIssues = [];
  const componentSetIssues = [];

  for (const top of page.children) {
    if (top.type === "SECTION") {
      sections.push({
        id: top.id,
        name: top.name,
        x: Math.round(top.x),
        y: Math.round(top.y),
        w: Math.round(top.width),
        h: Math.round(top.height),
        childCount: top.children.length,
      });
      for (const child of top.children) {
        if (child.type === "FRAME" && child.width >= CONFIG.minArtboardSize) {
          artboards.push({ node: child, section: top.name });
        }
      }
    } else if (top.type === "FRAME" && top.width >= CONFIG.minArtboardSize) {
      orphanFrames.push({ id: top.id, name: top.name, w: Math.round(top.width), h: Math.round(top.height) });
      artboards.push({ node: top, section: null });
    }
  }

  if (isDesignPage && CONFIG.requireSectionsOnDesignPages && orphanFrames.length > 0) {
    errors.push({
      code: "UNGROUPED_ARTBOARDS",
      page: page.name,
      message: `${orphanFrames.length} 张画板未归入模块 Section（禁止游离散放）`,
      items: orphanFrames,
    });
  }

  // 检查顶层 Section 互不重叠
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const ov = boxOverlaps(sections[i], sections[j]);
      if (ov) {
        errors.push({
          code: "SECTION_OVERLAP",
          page: page.name,
          message: `Section「${sections[i].name}」与「${sections[j].name}」重叠 (${ov.ox}x${ov.oy})`,
        });
      }
    }
  }

  // 检查同页画板是否互相重叠以及尺寸是否出现微小漂移（如 769 vs 771）
  const boardBoxes = [];
  const sizeBuckets = new Map();
  let pageInstances = 0;

  for (const { node: art, section } of artboards) {
    const ab = art.absoluteBoundingBox;
    if (ab) {
      boardBoxes.push({ id: art.id, name: art.name, x: ab.x, y: ab.y, w: ab.width, h: ab.height });
    }
    const sizeKey = `${Math.round(art.width)}x${Math.round(art.height)}`;
    sizeBuckets.set(sizeKey, (sizeBuckets.get(sizeKey) || 0) + 1);

    let boundVars = 0;
    let instances = 0;
    let overflowCount = 0;
    let parentClipCount = 0;

    function scan(node) {
      if (node.type === "INSTANCE") instances++;
      if (node.type === "TEXT") {
        const text = node.characters || "";
        if (CONFIG.forbiddenVerbRegex.test(text)) {
          textViolations.push({ board: art.name, id: node.id, text: text.slice(0, 80) });
        }
        if (CONFIG.placeholderRegex.test(text)) {
          placeholders.push({ board: art.name, id: node.id, text: text.slice(0, 80) });
        }
      }
      if ("fills" in node && Array.isArray(node.fills)) {
        for (const f of node.fills) if (f.boundVariables?.color) boundVars++;
      }
      if ("strokes" in node && Array.isArray(node.strokes)) {
        for (const st of node.strokes) if (st.boundVariables?.color) boundVars++;
      }
      if (node.boundVariables) {
        for (const k of Object.keys(node.boundVariables)) {
          if (k !== "fills" && k !== "strokes") boundVars++;
        }
      }
      if (node !== art && ab && node.absoluteBoundingBox) {
        const nb = node.absoluteBoundingBox;
        if (
          nb.x < ab.x - 2 ||
          nb.y < ab.y - 2 ||
          nb.x + nb.width > ab.x + ab.width + 2 ||
          nb.y + nb.height > ab.y + ab.height + 2
        ) {
          overflowCount++;
          if (layoutIssues.length < 20) {
            layoutIssues.push({ type: "artboardOverflow", board: art.name, id: node.id, name: node.name });
          }
        }
        const par = node.parent;
        if (par && par !== art && "clipsContent" in par && par.clipsContent && par.absoluteBoundingBox) {
          const pb = par.absoluteBoundingBox;
          if (nb.x + nb.width > pb.x + pb.width + 2 || nb.y + nb.height > pb.y + pb.height + 2) {
            parentClipCount++;
            if (layoutIssues.length < 20) {
              layoutIssues.push({ type: "parentClip", board: art.name, id: node.id, name: node.name, parent: par.name });
            }
          }
        }
      }
      if ("children" in node) {
        for (const ch of node.children) scan(ch);
      }
    }

    scan(art);
    pageInstances += instances;

    if (isDesignPage && CONFIG.requireBoundVariables && boundVars === 0) {
      errors.push({
        code: "UNBOUND_ARTBOARD",
        page: page.name,
        message: `画板「${art.name}」(${art.id}) 未绑定任何语义变量（boundVars = 0）`,
      });
    }
    if (overflowCount > 0 || parentClipCount > 0) {
      errors.push({
        code: "LAYOUT_CLIP_OR_OVERFLOW",
        page: page.name,
        message: `画板「${art.name}」存在越界或裁切（overflow=${overflowCount}, parentClip=${parentClipCount}）`,
      });
    }
  }

  for (let i = 0; i < boardBoxes.length; i++) {
    for (let j = i + 1; j < boardBoxes.length; j++) {
      const ov = boxOverlaps(boardBoxes[i], boardBoxes[j]);
      if (ov) {
        errors.push({
          code: "ARTBOARD_OVERLAP",
          page: page.name,
          message: `画板「${boardBoxes[i].name}」与「${boardBoxes[j].name}」重叠 (${ov.ox}x${ov.oy})`,
        });
      }
    }
  }

  if (isDesignPage && artboards.length > 0 && pageInstances === 0) {
    warnings.push({
      code: "ZERO_COMPONENT_INSTANCES",
      page: page.name,
      message: "界面页全部画板未使用任何主组件实例（INSTANCE = 0），请检查是否绕过组件库硬画",
    });
  }

  // 组件页检查主组件文字属性化
  if (isComponentPage) {
    for (const cs of page.findAll((n) => n.type === "COMPONENT_SET")) {
      const hasText = cs.findOne((n) => n.type === "TEXT") !== null;
      const defs = cs.componentPropertyDefinitions || {};
      const hasTextProp = Object.values(defs).some((d) => d.type === "TEXT");
      if (hasText && !hasTextProp) {
        componentSetIssues.push({ id: cs.id, name: cs.name, reason: "含文字节点但未暴露 TEXT 属性" });
        errors.push({
          code: "COMPONENT_MISSING_TEXT_PROP",
          page: page.name,
          message: `主组件集「${cs.name}」(${cs.id}) 包含文字但未暴露可覆写 TEXT 属性`,
        });
      }
    }
    for (const t of page.findAll((n) => n.type === "TEXT")) {
      if (CONFIG.forbiddenVerbRegex.test(t.characters || "")) {
        textViolations.push({ board: page.name, id: t.id, text: t.characters.slice(0, 80) });
      }
    }
  }

  if (textViolations.length > 0) {
    errors.push({
      code: "FORBIDDEN_ACTION_VERB",
      page: page.name,
      message: `发现 ${textViolations.length} 处禁用拼接动词文案`,
      items: textViolations.slice(0, 10),
    });
  }
  if (placeholders.length > 0) {
    errors.push({
      code: "PLACEHOLDER_TEXT",
      page: page.name,
      message: `发现 ${placeholders.length} 处占位文案未清理`,
      items: placeholders.slice(0, 10),
    });
  }

  pageReports.push({
    pageId: page.id,
    pageName: page.name,
    role: isDesignPage ? "design" : isComponentPage ? "components" : "other",
    sectionCount: sections.length,
    artboardCount: artboards.length,
    orphanArtboardCount: orphanFrames.length,
    sizeDistribution: Object.fromEntries(sizeBuckets),
    instanceCount: pageInstances,
    textViolationCount: textViolations.length,
    placeholderCount: placeholders.length,
    layoutIssueCount: layoutIssues.length,
    componentSetIssues,
  });
}

return {
  pass: errors.length === 0,
  errorCount: errors.length,
  warningCount: warnings.length,
  errors,
  warnings,
  pages: pageReports,
  requiredVisualChecks: [
    "已通过 get_screenshot 检查目标页面的整页俯瞰总览图（核对 Section 分区、行对齐与图层顺序）",
    "已通过 get_screenshot 检查每一张新增或大改画板的局部细节图（核对文字截断、状态对齐与视觉层级）",
  ],
};
