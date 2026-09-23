# RelyLess 开发文档

这里是 RelyLess 的社区开发入口。它说明项目为什么这样做、代码边界在哪里、什么改动适合进入项目，以及改动应如何被记录和审查。

## 建议阅读顺序

第一次贡献时：

1. [产品方向](product-direction.md)：确认改动是否符合 RelyLess 的目标与非目标。
2. [开发原则](development-principles.md)：了解隐私、交互、成本、兼容性和测试底线。
3. [架构概览](architecture.md)：找到改动所属的运行时边界和主要文件。
4. [贡献指南](../../CONTRIBUTING.md)：建立环境、提交 Issue、实现并验证。
5. [Pull Request 规则](pull-requests.md)：准备可审查的 PR。

使用 AI 编程工具时，同时阅读仓库根目录的 [`AGENTS.md`](../../AGENTS.md)。支持 Agent Skills 的工具可以加载 [`.agents/skills/relyless-development/SKILL.md`](../../.agents/skills/relyless-development/SKILL.md)。

## 文档地图

| 文档 | 负责回答 | 必须更新的时机 |
| --- | --- | --- |
| [产品方向](product-direction.md) | 我们要解决什么、不做什么 | 产品边界、默认体验或目标用户改变 |
| [开发原则](development-principles.md) | 实现时不能破坏哪些约束 | 新增跨模块约束或旧原则失效 |
| [架构概览](architecture.md) | 代码如何协作、数据流向哪里 | 模块边界、权限、存储或通信方式改变 |
| [PR 规则](pull-requests.md) | 什么样的改动可以合并 | 审查门槛、验证要求或合并策略改变 |
| [开发记录](records/README.md) | 一次重要实现发生了什么 | 完成跨模块、迁移、权限或发布风险改动 |
| [架构决策](decisions/README.md) | 为什么选择长期影响方案 | 做出难以回退、跨模块或影响隐私的决定 |
| [设计系统](../design-system.md) | UI 应如何呈现和交互 | token、组件语义或视觉规则改变 |
| [手动验证清单](../verification-checklist.md) | 浏览器里需要人工验证什么 | 用户可见流程、权限或浏览器行为改变 |

## 哪一份是事实来源

- **当前行为**：以代码、自动化检查和真实浏览器行为为准。
- **产品意图与工程约束**：以本目录文档为准。
- **视觉规则**：以 `docs/design-system.md` 为准；`extension/design.js` 是设计 token 的唯一代码源。
- **历史原因**：以已接受的 ADR、开发记录和相关 PR 为准。

发现文档与实现冲突时，不要默认修改文档去迎合偶然行为。先确认产品意图，再决定修代码还是修文档，并在同一个 PR 中完成。

## 记录什么

Git 提交和 PR 已经记录“改了哪些行”，开发记录不应重复流水账。只记录后续维护者无法从 diff 直接看出的内容：

- 目标、约束和明确排除项；
- 跨模块数据流或迁移策略；
- 浏览器权限、隐私、费用或兼容性风险；
- 被否决的方案及原因；
- 验证证据和遗留风险。

长期有效、会约束未来方案的决定写 ADR；一次实现过程与交付证据写开发记录。
