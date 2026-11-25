---
name: unity-test-authoring
description: 用于为 Unity 项目编写结构清晰、可稳定重复运行的 EditMode / PlayMode 单元测试与编辑器验证脚本（基于 Unity Test Framework / NUnit），覆盖纯 C# 核心逻辑、状态机、协议序列化、边界容错与轻量场景冒烟。当 Unity 研发需要补齐自动化测试或为关键 Bug 写回归测试时使用。
metadata:
  title: 单元测试与验证脚本编写
  version: "2.0.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
---

# 单元测试与验证脚本编写

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/unity/15-AI通用入口规则.md` 及代码编写与问题定位规则（若已安装）。
2. 检查 `Packages/manifest.json` 确认已安装的 `com.unity.test-framework` 版本，并查看项目现有的 `Tests/EditMode/`、`Tests/PlayMode/` 目录及 `.asmdef` 引用关系，**沿用现有测试组织方式，不擅自引入未授权 Mock 框架**。
3. 识别待测代码的可测试边界：优先将纯算法、状态流转、数据校验、协议解析与 `MonoBehaviour` 解耦，放入可极速运行的 **EditMode** 测试；仅涉及帧循环、物理、协程或 UI 事件的逻辑放入 **PlayMode** 测试。

## 2. 编写规范

1. **隔离程序集（`.asmdef`）**：
   - EditMode 测试程序集设置 `includePlatforms: ["Editor"]` 并引用 `nunit.framework.dll` 与 `UnityEngine.TestRunner` / `UnityEditor.TestRunner`；
   - PlayMode 测试程序集不限定仅 Editor，确保不在正式打包中污染业务代码。
2. **AAA 结构与高价值用例覆盖**：
   - 采用清晰的 `Arrange → Act → Assert` 结构，测试命名直观表达 `被测行为_前置条件_预期结果`；
   - 除正常路径外，重点覆盖：空输入/越界值、重复调用幂等、销毁/取消回调安全、配置损坏容错及已修复故障的防回归用例。
3. **测试隔离与零残留**：
   - 在 `[TearDown]` 中销毁测试创建的临时 `GameObject`、释放句柄、重置静态状态并清理临时文件，确保测试之间互不干扰、顺序无关；
   - 避免在单元测试中使用不可靠的真实公网请求或固定长 `WaitForSeconds`，改用接口注入桩（Fake/Stub）或确定性时钟。

## 3. 输出结构

- **一、测试分层方案**（EditMode vs PlayMode 划分、需补充的 `.asmdef` 引用）
- **二、完整测试代码**（含核心边界与回归用例）
- **三、在 Unity Test Runner 与 CLI 无头模式下的运行命令**
- **四、执行结果或未运行说明**（若本机未实际调用 Unity CLI 运行测试，必须明确声明“静态编写完成，待在 Unity Test Runner 中实测”）

## 4. 交付自检与红线

- 严禁伪造测试通过结果或省略失败断言来凑覆盖率。
- 不得把需要真实 XR 头显硬件传感器的测试硬塞进无头 CI 的 EditMode 用例里，应显式区分单元测试与真机集成测试边界。
