---
name: ui-design-system-setup
description: 用于建立或梳理统一的设计语言、语义化设计令牌（颜色/字阶/间距/圆角/阴影/层级）、图标规范与可复用核心组件变体规范。当用户从零搭建设计系统、统一多页视觉风格、整理 CSS/Figma Variables 令牌或梳理组件规范时使用；不用于编写具体业务接口逻辑。
metadata:
  title: 视觉风格与设计系统搭建
  version: "2.0.0"
  role: ui-design
  rulepacks:
    - common
    - ui-design
    - project-docs/ui-design
---

# 视觉风格与设计系统搭建

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ui-design/其他规则/03-视觉设计规则.md` 与 `04-设计系统规则.md`（若已安装）。
2. 检查现有代码库样式方案（如 CSS 变量、Tailwind、Design Tokens JSON、Unity USS/UGUI 主题）与既有 Figma 文件，沿用已有技术栈与命名习惯，不擅自引入未授权前端框架。
3. 核对产品品牌色、明暗主题范围（浅色 / 深色 / XR 透视高对比）及图标与字体商用授权情况。

## 2. 执行步骤

1. **定义两层设计令牌体系**：
   - **基础色板与标尺（Primitive Tokens）**：中性灰阶、品牌色阶、功能语义原色（成功/警告/危险/信息）、4px 或 8px 基准间距标尺、字阶与行高、圆角与阴影阶梯。
   - **语义令牌（Semantic Tokens）**：按用途命名（如 `--surface-page`、`--surface-card`、`--text-primary`、`--border-subtle`、`--accent-primary`），禁止业务组件直接硬编码裸十六进制色值。
2. **核验可读性与无障碍对比度**：正文与背景对比度满足 WCAG AA（≥ 4.5:1），大号标题与图标/控件边框 ≥ 3:1；状态表达不单独依赖颜色，配合图标或清晰标签文字。
3. **建立核心原子组件矩阵**：梳理按钮（主/次/幽灵/危险/图标按钮）、徽章、输入框、自定义下拉框、卡片、Tab、胶囊筛选、抽屉、弹窗与提示条的尺寸、内边距及完整状态（Default / Hover / Active / Focus / Disabled）。
4. **规范图标与品牌图形容器**：明确线性/面性图标统一规格、视光学对齐、尺寸档位（16 / 20 / 24px）以及第三方品牌 Logo 容器规范（如白底圆角容器保持对比清晰）。

## 3. 输出结构

- **一、设计定位与视觉基调摘要**（关键词 + 禁止倾向）
- **二、语义化设计令牌表**（同时给出 Figma Variable 命名与代码 Token 映射，如 CSS Variables）
- **三、核心组件变体与状态规格表**
- **四、字体、图标与资产合规核对清单**

## 4. 交付自检与红线

- 令牌数量克制、语义清晰，避免制造 30 个几乎肉眼无法区分的灰色或圆角值。
- 所有推荐字体与图标库必须确认商用许可合规，严禁默认推荐无商用授权字体。
- 若存在 Figma MCP 且用户要求同步，必须遵循“先立变量与带 `Text Property` 的母组件 → 再用 `createInstance()` 与语义变量装配页面 → 同模块归入 `Section` 排布”的顺序，交付前运行 `ui-handoff-checklist` 配套的 `figma-audit.js` 并做整页与局部双视角截图验收；无 Figma 时以标准 Token 清单与样式代码交付。
