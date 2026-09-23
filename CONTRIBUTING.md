# 为 RelyLess 贡献

感谢参与 RelyLess。贡献不限于代码：清晰的复现、浏览器兼容性证据、隐私审查、文档和可访问性修复同样重要。

## 开始之前

1. 阅读 [`docs/development/README.md`](docs/development/README.md)。
2. 用[产品方向](docs/development/product-direction.md)确认提案符合项目边界。
3. 搜索已有 Issue 和 PR，避免重复工作。
4. 高影响改动先开 Issue；判断标准见 [PR 规则](docs/development/pull-requests.md)。

安全漏洞不要公开提交复现细节；按照 [SECURITY.md](SECURITY.md) 使用 GitHub **Security → Report a vulnerability** 私下报告。

## 开发环境

要求：

- Node.js 20.11 或更高版本；
- Bun 1.4.0，与 CI 测试运行器保持一致；
- Chrome 或 Edge 116 及以上版本。

```bash
git clone https://github.com/rockythink/relyless.git
cd relyless
npm ci
npm run check
```

加载扩展：

1. 打开 `chrome://extensions` 或 `edge://extensions`；
2. 开启开发者模式；
3. 选择“加载已解压的扩展”，指向仓库中的 `extension/`；
4. 修改后在扩展管理页重新加载，并刷新测试网页。

使用订阅连接器时，按 README 安装 Native Messaging connector。普通 API 模式和大多数测试不需要 connector。

## 选择任务

适合作为首次贡献：

- 有明确复现步骤的 Bug；
- 文档与当前行为的偏差；
- 无障碍、键盘操作和错误文案；
- 不改变产品边界的测试或局部维护。

需要先讨论：新权限、新远程服务、新自动行为、大规模 UI、数据模型或存储迁移。Issue 应描述用户问题和约束，不只提出预选实现。

## 实现要求

- 遵循[开发原则](docs/development/development-principles.md)和[架构边界](docs/development/architecture.md)。
- 复用现有设置、消息、服务和设计 token；不要建立第二套约定。
- Bug 修复先获得最小复现，再修源头；适合时保留行为回归测试。
- 用户可见功能同步更新 README 或设置内“使用说明”。
- UI 改动同步检查 [`docs/design-system.md`](docs/design-system.md)。
- 权限、数据或第三方处理变化同步更新 `PRIVACY.md` 与 `PRIVACY.en.md`。
- 重要实现按需新增[开发记录](docs/development/records/README.md)或 [ADR](docs/development/decisions/README.md)。

## 验证

提交前必须运行：

```bash
npm run check
```

这会执行 JavaScript 语法检查和 Bun 测试。UI、权限、快捷键、网页注入或 connector 改动还应从 [`docs/verification-checklist.md`](docs/verification-checklist.md) 选择相关场景，在真实浏览器中验证。

请勿用测试替代真实表面验证：Popup、设置页和注入网页的改动需要截图或明确的操作结果。测试只保留会防止合理回归的断言。

## 提交 Pull Request

- 标题使用 `<type>: <简短结果>`；
- 保持单一问题和可审查范围；
- 完整填写 PR 模板，包括“不适用”的项目；
- 不提交 API Key、令牌、私人网页内容、URL、诊断日志或本机路径；
- 审查开始后若大幅改写方案，在 PR 中说明并请求重新审查。

完整合并要求见 [`docs/development/pull-requests.md`](docs/development/pull-requests.md)。

## 许可

提交贡献即表示你有权提交该内容，并同意你的贡献按仓库的 [Mozilla Public License 2.0](LICENSE) 发布。第三方代码、模型、字体、图标或数据必须保留来源和兼容许可；不确定时先在 Issue 中讨论。
