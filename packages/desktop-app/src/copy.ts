import type { PlatformChoice, RulePackManifest } from "./types";

export const APP_COPY = {
  brandName: "智枢",
  brandEn: "ZhiShu",
  nav: {
    projects: "我的项目",
    rules: "项目规则",
    assets: "插件与技能",
    tools: "AI 工具",
    sources: "来源管理",
    evolution: "规则进化",
  },
  actions: {
    addProject: "添加项目",
    manageRules: "管理规则",
    removeFromList: "移出列表",
    backToProjects: "返回项目列表",
    applyRecommendation: "套用检测推荐",
    chooseWorkspaceSource: "选择本地规则源",
    recoverInterrupted: "恢复中断事务",
    previewInstall: "安装规则",
    checkUpdate: "检查更新",
    previewUpdate: "查看变更",
    previewUninstall: "查看卸载范围",
    confirmInstall: "确认安装",
    confirmUpdate: "确认更新",
    confirmUninstall: "确认卸载",
    cancel: "返回",
    processing: "处理中…",
    refresh: "刷新",
    checkSoftwareUpdate: "检查软件版本",
    downloadUpdate: "下载新版",
    restartUpdate: "重启更新",
    retryUpdate: "重试更新",
    importProposal: "导入提案",
    manageWatchSources: "管理巡检源",
    scanOverrides: "扫描本地覆盖",
    watchDocs: "巡检官方文档",
    cancelWatch: "取消巡检",
    retryFailedSources: "重试失败源",
    reviewProposal: "查看审阅",
    rejectShort: "驳回",
    rejectProposal: "驳回提案",
    exportPatch: "导出补丁",
    recheckProposal: "重新检测",
    previewDelta: "查看变更",
    confirmWrite: "确认写入",
    saveConfig: "保存配置",
    addWatchSource: "添加巡检源",
    resetFilters: "重置筛选",
    goToProjects: "前往我的项目",
  },
  modes: {
    install: "配置与安装",
    update: "检查更新",
    uninstall: "卸载",
  },
  sources: {
    github: "智枢官方源",
    workspace: "本地目录源",
  },
  status: {
    healthy: "正常",
    updatable: "可更新",
    invalid: "异常·需处理",
    interrupted: "中断未完成",
    uninstalled: "未安装",
    unavailable: "不可用",
  },
  empty: {
    projects: "暂无已登记项目",
    searchProjects: "无匹配项目",
    selectProject: "请选择项目",
    noProjectOption: "请先在「我的项目」添加项目",
  },
} as const;

export interface PlatformMeta {
  id: PlatformChoice;
  name: string;
  tag: string;
}

export const PLATFORM_LIST: readonly PlatformMeta[] = [
  { id: "codex", name: "OpenAI Codex", tag: "AGENTS.md" },
  { id: "antigravity", name: "Antigravity", tag: "AGENTS.md" },
  { id: "trae", name: "TRAE", tag: "AGENTS.md" },
  { id: "cursor", name: "Cursor", tag: "AGENTS.md" },
  { id: "qoder", name: "Qoder", tag: "AGENTS.md" },
  { id: "workbuddy", name: "WorkBuddy", tag: "AGENTS.md" },
];

export const PLATFORM_NAME: Record<PlatformChoice, string> = {
  codex: "Codex",
  antigravity: "Antigravity",
  trae: "TRAE",
  cursor: "Cursor",
  qoder: "Qoder",
  workbuddy: "WorkBuddy",
};

export function formatPlatformList(targets: readonly string[]): string {
  return targets
    .map((target) => PLATFORM_NAME[target as PlatformChoice] ?? target)
    .join(" · ");
}

export const STACK_LABELS: Record<string, string> = {
  unity: "Unity",
  javascript: "JavaScript",
  typescript: "TypeScript",
  go: "Go",
  java: "Java",
  python: "Python",
};

export type RulePackGroupId = "base" | "product-ui" | "art-ta" | "unity-xr" | "fullstack" | "meta";

export interface RulePackMeta {
  id: string;
  name: string;
  group: RulePackGroupId;
  kind: "common" | "development" | "documentation";
  dependencies: readonly string[];
}

export const RULEPACK_GROUPS: readonly { id: RulePackGroupId; title: string }[] = [
  { id: "base", title: "通用基准" },
  { id: "product-ui", title: "产品与 UI" },
  { id: "art-ta", title: "三维与 TA" },
  { id: "unity-xr", title: "Unity / XR 研发" },
  { id: "fullstack", title: "全栈软件研发" },
  { id: "meta", title: "规则库维护" },
];

export const RULEPACK_CATALOG: readonly RulePackMeta[] = [
  { id: "common", name: "通用工程规则", group: "base", kind: "common", dependencies: [] },
  { id: "xr-common", name: "XR 空间通用基准", group: "base", kind: "common", dependencies: ["common"] },
  { id: "product-pm", name: "产品经理规则", group: "product-ui", kind: "common", dependencies: ["common"] },
  { id: "ui-design", name: "UI 设计规则（含 XR）", group: "product-ui", kind: "common", dependencies: ["common", "project-docs/ui-design"] },
  { id: "project-docs/ui-design", name: "UI 设计文档规则", group: "product-ui", kind: "documentation", dependencies: ["common"] },
  { id: "3d-art", name: "三维美术规范（含图生 3D）", group: "art-ta", kind: "common", dependencies: ["common"] },
  { id: "ta-vfx-shader", name: "TA 特效与 Shader 规范", group: "art-ta", kind: "development", dependencies: ["common"] },
  { id: "unity", name: "Unity 开发规则", group: "unity-xr", kind: "development", dependencies: ["common"] },
  { id: "pico", name: "PICO Unity SDK 规则", group: "unity-xr", kind: "development", dependencies: ["common", "unity"] },
  { id: "project-docs/unity", name: "Unity 文档规则", group: "unity-xr", kind: "documentation", dependencies: ["common"] },
  { id: "javascript", name: "JavaScript 开发规则", group: "fullstack", kind: "development", dependencies: ["common"] },
  { id: "typescript", name: "TypeScript 开发规则", group: "fullstack", kind: "development", dependencies: ["common", "javascript"] },
  { id: "project-docs/js-ts", name: "JS/TS 文档规则", group: "fullstack", kind: "documentation", dependencies: ["common"] },
  { id: "go", name: "Go 开发规则", group: "fullstack", kind: "development", dependencies: ["common"] },
  { id: "project-docs/go", name: "Go 文档规则", group: "fullstack", kind: "documentation", dependencies: ["common"] },
  { id: "java", name: "Java 开发规则", group: "fullstack", kind: "development", dependencies: ["common"] },
  { id: "project-docs/java", name: "Java 文档规则", group: "fullstack", kind: "documentation", dependencies: ["common"] },
  { id: "python", name: "Python 开发规则", group: "fullstack", kind: "development", dependencies: ["common"] },
  { id: "project-docs/python", name: "Python 文档规则", group: "fullstack", kind: "documentation", dependencies: ["common"] },
  { id: "rule-authoring", name: "规则正文编写规范", group: "meta", kind: "common", dependencies: ["common"] },
];

export const RULEPACK_BY_ID: Record<string, RulePackMeta> = Object.fromEntries(
  RULEPACK_CATALOG.map((item) => [item.id, item]),
);

export function rulePackDisplayName(id: string): string {
  return RULEPACK_BY_ID[id]?.name ?? id;
}

/** 计算显式选中的规则包所触发的全部传递依赖（不含自身已显式勾选的项之外的依赖集合）。 */
export function resolveImplicitDependencies(
  selected: readonly string[],
  availableManifests?: readonly RulePackManifest[],
): Set<string> {
  const manifestDeps = new Map<string, readonly string[]>();
  for (const item of RULEPACK_CATALOG) manifestDeps.set(item.id, item.dependencies);
  if (availableManifests) {
    for (const manifest of availableManifests) manifestDeps.set(manifest.id, manifest.dependencies);
  }
  const selectedSet = new Set(selected);
  const implicit = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string, isRoot: boolean): void => {
    if (visiting.has(id)) return;
    visiting.add(id);
    if (!isRoot && !selectedSet.has(id)) implicit.add(id);
    for (const dep of manifestDeps.get(id) ?? []) visit(dep, false);
    visiting.delete(id);
  };

  for (const id of selected) visit(id, true);
  return implicit;
}
