# Codex 适配器

Codex 规则入口适配器管理目标工程 `AGENTS.md` 中带边界标记的受控区块。智枢本身独立运行，不安装进 Codex。早期用于规则管理的旧版 Codex 插件包已退役；未来真正的开发 Skill 或能力插件需按独立资产交付。定位与资产划分见 [智枢产品需求文档](../../项目文档/产品文档/智枢-产品需求文档.md)。

`src/index.ts` 提供共享 `AGENTS.md` 的 `TargetAdapter` 实现：入口文件、区块边界、入口渲染及兼容平台列表。Codex、Qoder、Cursor、WorkBuddy 使用同一入口；核心层不保存任何平台专用规则正文。

适配器必须保留智枢受控区块之外的全部内容。当前与 Antigravity、TRAE、Qoder、Cursor、WorkBuddy 共用 `AGENTS.md` 入口（其中 Qoder、Cursor、WorkBuddy 的真实客户端加载仍待验收）；独立 Skill、岗位插件与 MCP 交付实现位于同目录 `user-assets.ts`。
