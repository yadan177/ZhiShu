---
name: ta-unity-importer-gen
description: 用于编写可配置、非破坏性的 Unity Editor 资产导入校验脚本（AssetPostprocessor 或菜单批量体检窗口），自动检查模型面数/Scale/ReadWrite、贴图 POT/最大尺寸/压缩与 Mipmap、音频 Mono/LoadType/Vorbis 及命名目录规范。当 TA 需要把美术/音频规范固化为 Unity 自动化门禁时使用。
metadata:
  title: Unity 资产导入校验脚本生成
  version: "2.1.0"
  role: ta-vfx
  rulepacks:
    - common
    - ta-vfx-shader
    - unity
    - xr-common
---

# Unity 资产导入校验脚本生成

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ta-vfx-shader/其他规则/04-资产导入自动化校验与真机剖析规范.md`、`.agent-rules/unity/其他规则/11-扩展编辑器规则.md` 及 `.agent-rules/xr-common/其他规则/04-音频与XR空间音效规范.md`（若已安装）。
2. 检查目标 Unity 工程现有的 `Editor/` 目录、命名空间、Assembly Definition（`.asmdef`）和既有校验工具，避免与现有导入器重复冲突。
3. 明确门禁策略：**只告警报告（Report / Warning）**、**按目录白名单自动套用推荐导入参数**，还是**阻断构建（IPreprocessBuildWithReport）**——默认优先“可配置规则表 + 报告模式”，禁止未经授权静默改写全项目历史资产的 `.meta`！

## 2. 脚本设计原则

1. **规则数据化（ScriptableObject 配置）**：把各目录对应的最大贴图尺寸、压缩格式（如 Android/XR ASTC）、面数告警阈值、音频时长分档阈值与目录白名单放进 `ScriptableObject`，避免把数字写死在 C# 里。
2. **严格隔离 Editor 编译域**：脚本必须置于 `Editor/` 目录或 `Editor` `.asmdef` 内，严禁污染运行时程序集。
3. **覆盖三大资产类别的高频隐患**：
   - **Model (`ModelImporter`)**：检查 `isReadable` 误开、`importCameras` / `importLights` 误开、缩放异常、网格三角面数与骨骼权重提示。
   - **Texture (`TextureImporter`)**：检查 `isReadable` 误开、非 POT 尺寸提示、超过预算的最大分辨率、法线贴图类型标记、UI 贴图关闭 Mipmap 与 3D 贴图开启 Mipmap、平台压缩覆写。
   - **Audio (`AudioImporter`)**：检查长音频误设 `DecompressOnLoad + PCM`、3D 音效未勾选 `forceToMono`（按目录约定如 `Audio/SFX_3D/`）。
4. **提供清晰批量扫描与导出能力**：支持右键目录或菜单触发一键扫描，输出可定位资产（点击 Ping 高亮）的汇总列表与 CSV/JSON 报告，方便接入 CI。

## 3. 输出结构

- **一、工具架构与防误改设计说明**（脚本落位、配置表结构、默认非破坏模式）
- **二、完整 C# Editor 脚本代码**（配置 `ScriptableObject` + 校验扫描器 + 可选 `AssetPostprocessor` 钩子）
- **三、在 Unity 中的接入与验证步骤**

## 4. 交付自检与红线

- 禁止生成“一导入就无条件全盘改写所有历史资产并触发数千个 `.meta` 变更”的激进脚本；自动修复必须限定白名单目录并由人工/开关显式启用。
- 未在真实 Unity 编辑器编译运行时，明确标注“代码静态编写完成，待在目标 Unity 版本中编译并在测试目录验证”。
