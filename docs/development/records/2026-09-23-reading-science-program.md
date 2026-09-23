# 开发记录：阅读科学增强计划（P1–P6）

- 日期：2026-09-23
- 状态：已交付（等待上游合并）
- 相关 Issue：#20
- 相关 PR：#11、#12、#13、#14、#15、#16、#18、#19
- 相关 ADR：无

## 背景

扩展已有义项级渐退状态机、SRS、追问+本地记忆、Jev 路由、多 Key 轮询、用量统计与本地 MiniLM 领域分类。在此资产上梳理出 18 项「小建议」，按共享基础设施分为 5 个工作流，分 6 个阶段交付。关键架构发现：`senseKey = hash(wordId + ':' + senseLabel)`，义项身份绑定在模型随手写的 label 字符串上——这是义项聚类（#1）与持久释义缓存（#11）共同的痛点与支点。

## 目标

- 义项跨措辞归并，渐退/SRS/缓存不再因 label 漂移而分裂；
- 用量统计从 `chars/4` 粗估升级为 tokenizer 计数；
- 简短查词可显式选择本机 Gemini Nano；不支持或输出无效时回落已配置的就绪服务；
- 保留主动回忆遮罩、查词历史与词族支持；不实现滚动/悬停推断、被动读完判定或能力评分；
- 成本可控：默认仅会话释义/译文缓存，跨会话需单独同意；服务故障转移与月度预算；
- 体验补全：设置页低置信领域候选、固定术语建议、默认关闭的键盘导航、订阅通道多轮追问；
- Windows 上订阅连接器可用（PATHEXT/ComSpec/原生 codex exe）。

## 非目标

- 不做 #5「订阅连接器泛化」（Claude Code / Gemini CLI 协议适配）——三通道抽象已存在，剩余为协议适配，另开讨论；
- Nano 不做全局透明的第 0 层——它是显式可选的 `local` 通道，选后仅覆盖 brief 查词，其余路径回落；把 Nano 作为所有用户的默认前置层留待后续评估；
- 不引入新的学习评分或游戏化机制（产品红线）；
- grok/antigravity 订阅不实现追问多轮。

## 实现边界

- **本地推理层**：`classifier-worker.js` 共享 MiniLM worker 同时服务领域分类与句向量/token 计数；`onlyIfWarm` 保证推理层绝不因辅助任务冷启动。
- **义项聚类**：`resolveSenseKey` 三级——label 精确复用 → 模型已热时 label+原句 embedding 余弦 ≥0.86 复用 → hash 兜底；仅同 wordId+domain 内合并，防跨语境误并；`migrateSense` 容忍缺省，schema 不升版本。
- **缓存**：`persistent-cache.js` 按任务、内容、上下文、服务和模型生成哈希键；默认写入会话存储，只有在“数据与隐私”中明确开启后才使用 `persistentGlossCache`/`persistentTranslationCache` 本机持久键。旧版未经同意的持久条目在启动时清除。
- **故障转移**：`fallbackServiceId` 单跳 + 5 分钟冷却；`classifyFailure` 把认证/限流/网络/瞬时/5xx 归类为可转移。
- **本机模型**：`providerKind:'local'`；`dispatchSettings` 把所有非 Nano 路径回落到「激活 API 服务（就绪时）→ 首个就绪服务 → 已登录订阅」，缓存键按回落后服务计算，行为与直选一致；Nano 输出仍过 `normalizeAssistanceResult` 全套校验。
- **订阅多轮**：Codex `convThreads` 按 conversationId 保留 thread（30min TTL、50 条 LRU、失败弃 thread 重建）；首轮携带完整 setup，后续只发 question；`status.features` 做能力协商，旧连接器提示升级。
- **主动导航与按需模式**：`]`/`[` 键盘导航默认关闭；“仅在需要时”不主动扫描句子或记录被动阅读事件，选中完整句子后的解构仍可请求。

## 数据、权限与费用

- 会话缓存默认存放模型生成的帮助与译文；跨会话持久化单独同意后才写入，保留期最多 30 天并可单独清理；无痕不读写。缓存值可能包含敏感内容，哈希键不保证匿名。
- 义项 embedding（384 维向量）存词条内，一词最多 8 义项；
- `prevHelpAt` 记录明确求助时间，不保留滚动、悬停或被动读完字段；
- Nano 通道不向任何服务器发送文本，但选择 `local` 后非 brief 请求回落远程/订阅服务——已在两份隐私文档明确披露；
- 月度预算为本地计数对比，不拦截已发请求；
- 订阅追问首轮把选文上下文发给连接器 thread，与 API 追问内容边界一致。

## 风险与回滚

- **义项误并**：阈值 0.86 起调、仅同域同词内合并、保留 canonical label；回滚方式——删除 sense 的 embedding 字段即退化为现状 hash。
- **Nano 输出质量**：仅 brief 提示接 Nano，输出走与远端相同的归一化校验；任何失败回落远端并记 `LOCAL_FALLBACK`。
- **缓存膨胀/陈旧**：跨会话缓存需同意，30 天过期与 500/1500 条容量限制；关闭同意或 `MEMORY_CLEAR` 删除持久结果。
- **故障转移误切**：仅明确失败类触发、单跳、冷却期；无 fallback 时原样报错。
- **连接器旧版**：`features` 协商失败时提示升级或改用 API 服务，不静默降级。
- **整体回滚**：六个阶段为堆叠 PR，任一阶段可独立 revert。

## 验证证据

- 自动检查：顺序合并演练 `npm run check` 为 450 通过 / 0 失败；九个开放 PR 的 Check 工作流均需在最终提交上成功。
- 连接器测试覆盖多轮 thread 复用/TTL/LRU/失败重建和 Windows PATHEXT/ComSpec 探测矩阵；Windows 行为在 macOS 下模拟，未在 Windows 真机运行。
- 浏览器验证：干净 Chromium 配置加载最终扩展，确认跨会话缓存默认关闭、键盘导航默认关闭、服务页预算与并发入口、无页面错误；另验证缓存清理与低置信领域设置提示。
- Gemini Nano 可用设备下载/实际生成、Windows 真机连接器、真实订阅多轮与远程模型调用均未实测；合并后仍需对应环境确认。

## 后续事项

- #5 订阅连接器泛化（Claude Code / Gemini CLI）待另开讨论；
- Nano 是否升级为全局第 0 层（所有 routine 提示先试本机）待评估；
- `conversationStop` 目前只停页面侧，已发出的连接器轮次会完成但结果被丢弃——如需真正取消需扩展连接器协议；
- grok/antigravity 的多轮支持待协议确认。
