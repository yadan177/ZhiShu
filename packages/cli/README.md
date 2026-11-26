# 智枢 CLI（zhishu）

`zhishu`（`2.1.0`）是 **智枢（ZhiShu）** 的命令行工具，负责为多技术栈 / 多岗位项目检测、安装、检查、差异更新、中断恢复和安全卸载共享 AI 工程规则，并提供 `zhishu evolve` 规则自动进化子命令与智枢桌面端协同。规则正文固定在各项目 Git 的 `.agent-rules/` 与共享 `AGENTS.md` 受控区块中，不绑定单一编辑器。完整产品定位见 [智枢产品需求文档](../../项目文档/产品文档/智枢-产品需求文档.md)。

环境要求：Node.js 22 或更高版本，以及访问 GitHub Release 的网络。

## 首次安装与校验

```bash
npm install -g zhishu
zhishu detect /absolute/path/to/project
zhishu init /absolute/path/to/project --targets codex,antigravity,trae --rulepacks common,typescript,ui-design
zhishu validate /absolute/path/to/project
```

`init` 从正式 GitHub Release 下载规则包并校验 SHA-256（或通过 `--source-workspace` 指定本地规则仓库），生成 `.agent-rules/`、`agent-rules.yaml`、`.agent-rules.lock.json` 与 `AGENTS.md` 受控入口；遇到未知文件碰撞或受管漂移立即停止，不静默覆盖。

## 审查更新、中断恢复与卸载

```bash
zhishu check /absolute/path/to/project
zhishu diff /absolute/path/to/project
zhishu update /absolute/path/to/project --apply
zhishu recover /absolute/path/to/project --apply
zhishu uninstall /absolute/path/to/project --details
zhishu uninstall /absolute/path/to/project --apply
```

`check`、`diff` 与不带 `--apply` 的 `update` / `uninstall` / `recover` 均只读预览；`.agent-rules/overrides.md` 与项目非受管文件始终保留。

## 规则自动进化（`zhishu evolve`）

```bash
# 投递脱敏原子提案至本机智枢桌面端「规则进化」收件箱
zhishu evolve capture \
  --title "规范标题" \
  --target-kind rule \
  --target-path "rulepacks/common/entry.md" \
  --anchor "## 工作准则" \
  --op add-item \
  --after "- 脱敏后的原子增量条款" \
  --evidence "会话纠偏依据"

# 查看待审列表、跨项目只读扫描、预览增量 Diff、显式批准原子写入与导出补丁
zhishu evolve list --status pending
zhishu evolve scan-overrides /path/to/project-a /path/to/project-b --source-workspace /path/to/ZhiShu
zhishu evolve preview <proposal-id> --source-workspace /path/to/ZhiShu
zhishu evolve apply <proposal-id> --source-workspace /path/to/ZhiShu --apply
zhishu evolve export <proposal-id> --out /tmp/evolution.patch
```

完整说明见 [安装与更新指南](../../项目文档/技术文档/安装与更新指南.md)。源码与问题反馈：[ZhiShu](https://github.com/yadan177/ZhiShu)。
