# 架构决策记录

ADR（Architecture Decision Record）保存会长期约束后续实现的决定及其理由。

## 何时写 ADR

- 新增浏览器权限、持久数据类别或远程数据接收方；
- 改变默认自动行为、隐私边界或产品非目标；
- 改变 service worker、content script、offscreen document 或 connector 的职责；
- 选择新的运行时依赖、协议、存储 schema 或迁移策略；
- 采用一个需要多个后续 PR 执行的架构方向。

局部实现细节和容易回退的选择放在 PR 描述，不写 ADR。

## 编号与状态

复制 [`0000-template.md`](0000-template.md)，使用下一个四位编号和短标题，例如 `0002-session-cache-boundary.md`。

状态只使用：

- `proposed`：讨论中，不能作为实现依据；
- `accepted`：当前有效；
- `superseded`：已被另一 ADR 取代，并链接替代项；
- `rejected`：讨论后未采用，保留原因。

接受后的 ADR 不重写历史理由。情况变化时新增 ADR，并把旧记录标记为 `superseded`。
