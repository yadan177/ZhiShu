---
name: unity-code-review
description: 用于按 Unity C# 工程规范审查脚本变更，重点排查每帧热路径 GC 分配、生命周期与事件解绑泄漏、异步/协程销毁安全、资源加载句柄释放、网络与安全隐患及代码结构耦合。当 Unity 研发提交 PR 自检、代码评审或审查复杂组件脚本时使用。
metadata:
  title: Unity 代码规范审查
  version: "2.1.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
    - xr-common
---

# Unity 代码规范审查

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/unity/15-AI通用入口规则.md`，并按改动模块读取 `.agent-rules/unity/其他规则/` 中对应专题（代码编写、性能优化、UGUI/UI Toolkit、资源管理、网络、安全）。
2. 先核对目标项目的实际事实：Unity 版本、渲染管线、已安装的资源框架（Addressables / YooAssets / Resources）、异步方案（Coroutine / UniTask / async-await）及代码命名约定，**严禁按默认模板误判项目既有框架**。

## 2. 六维重点审查项

1. **热路径零 GC 与性能底线**：
   - 检查 `Update` / `LateUpdate` / `FixedUpdate` 及高频回调中是否存在 `LINQ`、字符串拼接、装箱（Boxing）、`GetComponent` / `FindObjectOfType`、`Camera.main` 反复查表（旧版本）、`new WaitForSeconds`、非 `NonAlloc` 物理查询或每帧 `Material` 实例化泄漏。
2. **生命周期与事件订阅防泄漏**：
   - 检查 `OnEnable`/`OnDisable` 或 `Awake`/`OnDestroy` 是否成对注册与注销事件、委托与输入回调；检查静态事件与单例是否意外持有已销毁场景对象的引用。
3. **异步、协程与对象销毁安全**：
   - 检查 `async`/`await`（含 `UniTask`）与协程在 `GameObject` 销毁、场景切换或网络取消时是否携带 `CancellationToken` 或存活检查，避免 `MissingReferenceException` 与幽灵回调；禁止静默吞掉 `async void` 异常。
4. **资源与网络边界安全**：
   - 检查 Addressables / AssetBundle 句柄是否在对称生命周期中 `Release`；检查运行时是否违规同步阻塞主线程（如随意 `WaitForCompletion()`）；
   - 检查网络请求超时/取消与跨端契约对齐（参考 `.agent-rules/common/03-跨端接口契约与联调规范.md`）。
5. **UI 与音频高频隐患**：
   - UGUI 检查静/动 Canvas 分离、非交互元素关闭 `Raycast Target`、避免每帧重建 Layout；音频检查是否走对象池与并发限制。
6. **版本控制与 `.meta` 卫生**：提醒核对新增/重命名脚本是否连带提交 `.meta` 且无误改无关场景。

## 3. 输出结构

- **一、审查结论摘要**（通过 / 建议修复后合入 / 阻断）
- **二、分级问题表**：`严重度（P0 阻断 / P1 高 / P2 建议） | 文件:行号 | 问题类别 | 风险与触发条件 | 具体修复代码建议`
- **三、已验证项与未在 Unity 编辑器实测的边界说明**

## 4. 交付自检与红线

- 每条意见必须基于真实读取到的代码行，严禁捏造未读文件或猜测未安装的第三方包 API。
- 明确区分必改缺陷（崩溃、泄漏、死锁、明显 GC 卡顿）与可延后重构建议，不做脱离当前任务的大范围重写要求。
