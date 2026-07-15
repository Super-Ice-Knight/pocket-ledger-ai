# AI 协同开发日志

这份日志只保留能说明需求判断、Prompt 设计、代码责任和 Debug 过程的证据。逐日开发流水见 `docs/DEV_LOG.md`。

## 1. 人机责任边界

| 参与者 | 主要责任 | 不越过的边界 |
|---|---|---|
| 人 | 确定产品目标、筛选功能、否决不合适方案、管理 Key、决定是否提交与部署 | 不把模型生成结果当作未经验证的事实或最终代码 |
| 开发 AI | 阅读任务与仓库、整理方案、实现代码、构造测试、分析日志、执行浏览器验收、维护文档 | 不自行扩大产品范围，不提交真实 Key，不以“能运行”代替验收 |
| 产品内模型 | 把单笔描述解析为结构化草稿；按统计数据生成财务点评 | 不直接写数据库，不编造缺失金额，不绕过用户确认 |
| 自动化验证 | pytest、TypeScript/Vite、Playwright、Git 差异与密钥扫描 | 只证明覆盖到的行为，不把单次线上延迟写成 SLA |

最终责任仍由项目作者承担：采纳 AI 代码前必须理解数据流、确认安全边界，并用可复现证据决定是否交付。

## 2. 工具链

- AI 协作：Codex / ChatGPT
- 前端：Vite、React、TypeScript、Tailwind CSS、Recharts、Phosphor Icons
- 后端：FastAPI、SQLite、Pydantic、httpx
- AI 接口：OpenAI 兼容 Chat Completions；当前线上主模型为 Groq `qwen/qwen3.6-27b`，代码支持可选备用 Provider
- 验证：pytest、TypeScript 构建、Playwright
- 版本与部署：Git、GitHub、Render、Vercel

## 3. 核心 Prompt

选拔指南要求展示 1 至 2 个成功用于解决复杂逻辑的 System Prompt 或对话。这里不再把产品内的 JSON 生成指令当作核心协作证据，而选择真正驱动项目规划与状态逻辑的两段用户 Prompt。

### Prompt 1：交付前自主规划

**用户原话**

> 我已经在本窗口完成了口袋记账 AI 版的主要开发、GitHub 推送、Render 后端部署和 Vercel 前端部署。不要重新接手项目，也不要重复解释技术栈；直接基于本对话已有上下文和当前仓库状态，做一次最终交付前的优化规划。
>
> 请进入计划模式，先不要改代码。
>
> 目标：
> 1. 根据选拔项目评分视角，审查当前项目还有哪些短时间内值得优化的点。
> 2. 优先考虑项目本身：前端质感、交互细节、AI 快记和 AI 财务点评逻辑、错误兜底、README、AI_LOG、DEFENSE_NOTES、演示流程。
> 3. 不要提出高风险大功能，比如登录、多用户、App、OCR、银行同步、复杂资产管理。
> 4. 每个建议都要说明：评分价值、实现成本、风险、是否建议现在做。
> 5. 最终给出最多 5 个可执行改动，并按优先级排序。
> 6. 给出你的验收标准：需要跑哪些测试、构建、浏览器检查、文档检查。
>
> 注意：
> - 这是交付前优化，不是重构。
> - 不要为了炫技改技术栈。
> - README 和 AI_LOG 必须保持真实、可答辩，不要写成宣传稿或聊天记录堆砌。
> - 如果发现已有功能逻辑不清楚，要优先补文档和答辩解释。

这段 Prompt 的质量不在于篇幅，而在于同时给出了项目阶段、评分视角、决策维度、数量上限、禁止事项和验收口径。AI 先在计划模式输出价值、成本与风险排序，用户确认后才进入实现。Prompt 中列举的高风险功能只用于限制范围，不是待开发清单。

| 项目 | 证据 |
|---|---|
| 使用阶段 | 最终交付前审查与优化规划 |
| AI 负责 | 阅读当前仓库，排序风险，提出最多五项改动和完整验收标准 |
| 用户负责 | 设定评分视角、范围和停止条件，确认计划后决定是否执行 |
| 结果证据 | 后续整改收口至 [`38f91ab`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/38f91ab)，并形成发布检查表与独立 Agent 验收流程 |

### Prompt 2：点评调用与缓存决策

**用户原话**

> 不要每一次刷新都调用api，ai点评应该存起来，如果没有变动的话直接展示，避免每一次都调用，并且在用户不查看点评的时候不用去调用api，如果没有好的自动逻辑的话就改成手动，或者采用混合逻辑，你来给出一个最优的方案。

这段 Prompt 没有预设实现细节，但清楚指出了重复调用、结果持久化、用户访问时机和自动/手动取舍四个相互关联的问题，并把方案比较交给 AI。最终选择混合逻辑：页面只读取缓存，用户主动生成；账单变化后旧结果保留但标记过期。

| 项目 | 证据 |
|---|---|
| 使用阶段 | AI 财务点评成本与一致性优化 |
| AI 负责 | 比较自动、手动与混合方案，设计缓存指纹和 `missing/fresh/stale` 状态 |
| 用户负责 | 发现重复调用问题，明确“不查看不调用”和“数据不变直接展示”两个产品约束 |
| 结果证据 | [`f6322c8`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/f6322c8)：SQLite 点评缓存；测试保证 `GET` 不调用 Provider、数据变化后变为 `stale`、失败兜底不写缓存 |

## 4. 三条真实决策链

这里按“用户原话 → AI 判断 → 用户取舍 → 实现与验证”记录协作演进。以下原话由用户在原始表达基础上删改并确认，按用户原话收录。

### 决策链 1：从模式、Skill 到独立 Agent 验收

**用户原话**

> 在接下来的任务中，把判断何时使用计划模式和goal模式写进记忆里，基于效果做判断。去找对应的skill，对标的产品，调研市场找需要实现的功能，构成提示词和todolist，并审查，尝试构建loops。
>
> 评估一下我们目前的项目，和我们的目标相比，你自己判断一下我们的项目还能怎么推进，给自己列一个计划，然后自己执行，包括使用的工具也自己决策，你也要有自己的验收标准。
>
> 你觉得现在的项目可以提交了吗，还有没有优化空间，我觉得验收应该也是agent做，我要你模拟验收的话单开一个对话还是就在这里？
>
> 以上是测试的ai给出的建议，忽略一部分我们已经考虑到的，以及测试不需要太多，你自己决策一下把他给的几个可实现的需求实现一下就行。

**AI 判断与用户取舍**

模式和 Skill 不作为装饰：产品范围、技术路线和交付优先级存在分歧时先进入计划模式；目标明确的 Bug 直接进入测试与修复。TDD 用于金额、时间、缓存和请求竞态，Playwright 用于真实浏览器验收，复杂故障采用“复现 → 假设 → 修复 → 回归”的诊断循环。用户进一步要求用独立 Agent 验收，再由主任务按评分价值、成本和风险筛选建议，而不是照单全收。

**最终结果与证据**

形成“计划 → 用户确认 → 实现 → 自动化测试 → 浏览器检查 → 独立 Agent 验收 → 二次整改”的 Loop。当前验证为 `35` 项 pytest、`7` 项 Playwright 和 Vite 生产构建通过；对应测试见 [`backend/tests/test_api.py`](backend/tests/test_api.py) 与 [`frontend/tests`](frontend/tests)。

### 决策链 2：技术栈、数据库与视觉方向

**用户原话**

> Streamlit生成画面太低级了我觉得，调用本地的两个视觉设计skill来完成前端设计，技术栈上不要只用python这么局限，然后详细介绍一下数据库方案。
>
> 把画面做成左侧边框栏选择模块，点击跳转的模式，还有前端的页面改成大理石质感，西方雕塑艺术风格。

**AI 判断与用户取舍**

用户否决仅按已有 Python 基础选择 Streamlit，要求技术路线同时满足产品完成度、可维护性和答辩理解。AI 对比后采用 React/TypeScript 与 FastAPI 前后端分离，SQLite 以本地数据库文件保存结构化流水；视觉迭代围绕独立页面导航、大理石材质、矿物配色和雕塑艺术元素展开，再由用户根据实际页面继续否决或确认。

**最终结果与证据**

六个主要页面通过桌面侧栏和手机底部导航切换，设置页拥有独立入口；金额与统计由 SQLite 持久化。最终界面与截图见 [`frontend/src/App.tsx`](frontend/src/App.tsx)、[`frontend/src/styles.css`](frontend/src/styles.css) 和 [`docs/assets`](docs/assets)。

### 决策链 3：AI 可靠性、延迟与点评逻辑

**用户原话**

> 我觉得可以再做一个备用apikey，如果说调用模型的时候遇到了错误，就尝试调用备用模型，这个要求你觉得合理吗？然后把设置里的api配置直接做成真实设置。
>
> 为什么线上部署之后对于ai的访问会超级慢，测试都是一万和四千的ms，ai快记更是直接卡到本地兜底，是线上部署的问题还是我的网络的问题？
>
> 现在的财务点评内部逻辑是不是根据权重计算结果给出内置的固定评价？我现在的设想是财务点评也走ai，并且内置好给ai的角色设定提示词，给出详细地分析和一句话分析，做两个板块调用的ai的api和ai分析里的一样。

关于点评调用时机与缓存的用户原话见核心 Prompt 2。

**AI 判断与用户取舍**

先实现主备 Provider 与真实设置，再通过服务端计时拆分浏览器、Render 和模型平台链路。实测 Agnes 与硅基流动在部署区域延迟过高后，用户没有接受继续放宽超时，而是迁移到 Groq。财务点评主路径扩展为带角色设定的结构化模型分析，同时保留确定性本地兜底，并用按需生成与 SQLite 缓存控制额度。

**最终结果与证据**

AI 快记支持主模型、可选备用和本地兜底，并展示真实来源；公开设置只读且不回显 Key。财务点评输出一句话结论、详细分析和行动建议，`GET` 只读缓存，用户主动操作才调用 Provider。证据见 [`backend/app/ai.py`](backend/app/ai.py)、[`backend/app/advice_cache.py`](backend/app/advice_cache.py)、提交 [`ab7e827`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/ab7e827) 与 [`f6322c8`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/f6322c8)。

## 5. 产品内运行时 Prompt

下面两段是当前代码实际发送给模型的实现契约，用于约束模型输出，但不作为本次评选要求中的“核心 Prompt”。

### 一句话记账解析

```text
你是记账系统的结构化解析器。只返回 JSON, 不要解释。
当前本地时间是 {Asia/Shanghai 当前时间}。遇到今天、昨天、前天等相对日期,
必须以当前本地时间换算。
字段: amount_cents(int), type(expense|income), category, account,
occurred_at(ISO), note, tags(array), confidence(0-1), missing_fields(array)。
金额必须转换为分。tags 用于用户自定义标签, 不确定则返回空数组。
```

模型结果还会经过分类与账户归一化、北京时间覆盖、Pydantic 校验和用户确认。对应代码见 [`backend/app/ai.py`](backend/app/ai.py)，测试见 [`backend/tests/test_api.py`](backend/tests/test_api.py)。

### AI 财务点评

```text
你是“口袋记账 AI 版”的个人财务分析师，服务对象是学生和年轻用户。
你要像一个克制但有判断力的预算教练：基于账单统计说清楚钱花在哪里、
预算风险在哪里、下一步怎么做。不要编造输入里没有的数字，不要提供投资建议，
不要使用空泛鸡汤。tone=sharp 时可以直接、有一点毒舌，但不能羞辱用户；
tone=warm 时温和具体。只返回 JSON，不要 Markdown。
字段必须是：headline(string, 28字以内，一句话结论),
detail(string, 120到220字，给出具体财务分析),
action_items(array, 2到3条，每条24字以内的行动建议)。
```

统计数据和语气作为 `user` 消息发送。页面读取 SQLite 缓存，只有用户点击生成或重新分析才调用 Provider。对应代码见 [`backend/app/ai.py`](backend/app/ai.py) 与 [`backend/app/advice_cache.py`](backend/app/advice_cache.py)。

## 6. 采纳与拒绝

| 决策 | 结果 | 理由 |
|---|---|---|
| 前后端分离 | 采纳 | 交互、数据、AI 和数据库职责清楚 |
| SQLite | 采纳 | 单用户演示足够，文件持久化且易解释 |
| 金额保存整数分 | 采纳 | 避免 `0.1 + 0.2` 浮点误差 |
| 主模型 + 备用模型 | 采纳 | 外部 API 故障时仍可继续尝试 |
| 为了“有备用”保留已知慢接口 | 拒绝 | 串行超时会直接破坏快记体验 |
| 本地规则兜底 | 采纳 | 保证可解释性和演示连续性 |
| AI 自动入账 | 拒绝 | 模型可能出错，必须由用户确认 |
| Streamlit | 拒绝 | 无法达到目标产品质感 |
| 公开网页保存线上 Key | 拒绝 | 无登录环境不能允许访客修改密钥 |
| 把长 Prompt 当作质量保证 | 拒绝 | Prompt 只提供约束，结果仍需测试和浏览器证据 |
| 所有任务都先开计划模式 | 拒绝 | 明确、低风险的修复直接进入实现和验证更高效 |
| 为展示能力而堆叠 Skill | 拒绝 | 只使用与当前阶段匹配且能留下证据的方法 |
| 独立 Agent 做提交前验收 | 采纳 | 降低同一上下文的确认偏差，再由项目作者筛选整改项 |

## 7. 真实 Debug：Render 构建失败

### 现象

Render 首次部署在安装依赖阶段失败，关键日志为：

```text
Using Python version 3.14.3
Preparing metadata (pyproject.toml) ... error
pydantic-core
maturin failed
failed to create directory ... Read-only file system
metadata-generation-failed
```

### 排查

1. 先确认失败发生在构建阶段，不是 FastAPI 启动命令或端口错误。
2. 日志显示 `pydantic-core==2.27.2` 没有匹配 Python 3.14 的预编译 wheel，pip 转而尝试使用 Rust/maturin 构建。
3. Render 构建环境中的 Cargo 缓存目录只读，因此源码构建失败。
4. 本地已验证的运行版本是 Python 3.11，项目没有使用 3.14 特性。

### 修复

- 增加 `.python-version`，锁定 Python `3.11.9`。
- 在 `render.yaml` 中明确 `PYTHON_VERSION=3.11.9`。
- 保持现有 FastAPI/Pydantic 版本，不为绕过部署错误盲目升级整个依赖树。

### 回归

Render 使用 Python 3.11.9 后依赖安装成功，`/api/health` 返回 `{"ok": true}`，前端可以跨域读取统计和流水。

这次 Debug 的价值在于：AI 没有只给“升级 pip”这种表面建议，而是根据日志定位到 Python ABI、wheel 和 Rust 源码构建之间的关系。

## 8. 真实 Debug：线上 AI 从一分钟优化到秒级

### 现象

本地 Agnes 与硅基流动都曾成功返回模型结果，但部署到 Render Oregon 后，设置页测试出现 4–10 秒甚至更高延迟，AI 快记经常等待很久后进入本地兜底。仅凭“免费实例会休眠”无法解释服务已经唤醒后仍然缓慢。

### 诊断

1. 先预热 Render，再分别测健康接口、设置接口、Provider 测试和真实快记。
2. 健康接口约 184 ms、设置接口约 192 ms，说明浏览器到 Render 和 FastAPI 基础响应正常。
3. `POST /api/settings/ai/test` 使用 FastAPI 内部 `perf_counter` 包围模型请求，因此返回的 `latency_ms` 不包含用户浏览器网络。
4. 实测 Agnes 在 45.2 秒后 `ReadTimeout`，硅基流动成功也需要 21.1 秒；一次真实快记等待 50.6 秒后才由备用模型返回。
5. 交换主备顺序仍不能稳定解决，原句重放曾耗时 64.9 秒并进入 `error_fallback`。根因是 Render Oregon 到两家亚洲 Provider 的链路和服务延迟，而不是前端渲染。

### 方案演进

- 第一阶段：Agnes 作为主模型，证明 OpenAI 兼容接口可接入。
- 第二阶段：硅基流动作为备用；通过 `/models` 将错误 ID `deepseekv4-flash` 修正为 `deepseek-ai/DeepSeek-V4-Flash`，证明主备切换有效。
- 第三阶段：部署后发现地理链路延迟，拒绝继续靠放宽超时掩盖问题。
- 第四阶段：迁移到 Groq。第一次把模型名写成 `qwen3.6-27b`，后端在 221 ms 返回 `HTTP 404 model_not_found`；错误是缺少命名空间，不是 Key 无效。修正为 `qwen/qwen3.6-27b` 后连接成功。
- 最终策略：线上只启用经过验证的 Groq 主模型，超时收紧为 10 秒；备用槽位保留在代码中，但未验证的慢 Provider 不进入公开演示关键链路。

### 最终回归

2026-07-13 在公开 Render 服务上复测：

- `/api/health`：170 ms。
- Groq 服务端 Provider 测试：917 ms。
- “今天中午咖啡花了24元，微信付的”：3.64 秒，返回 2400 分、`provider=primary`。
- “昨天兼职收入两千元，银行卡到账”：4.87 秒，返回 200000 分、收入、银行卡、`provider=primary`。
- 首轮月度点评验收连续进入 `error_fallback`。定位到长输出会触发 Qwen 推理或附带包装文本后，为 Groq Qwen 请求增加 `reasoning_effort=none`，并用 `json.JSONDecoder` 提取合法对象；部署回归后点评在 5.25 秒返回 `source=model, provider=primary` 和 3 条行动建议。

这个过程同时暴露了一个测试边界：连接测试只证明 HTTP 请求成功，真实快记还要通过 JSON 解析、字段归一化和 Pydantic 校验，因此两者都必须验收。

## 9. 最终优化中的问题发现

交付前审查没有继续堆功能，而是发现并修复了以下九类真实风险：

### 小数输入被清空

旧前端每次输入都立即转整数分。用户输入 `50.` 时正则暂时不完整，状态会被写成零，受控输入随即清空。修复后输入框独立保存原始文本，允许 `50.`、`50.0`、`50.05`，提交时才转换为整数分。

### 歧义输入不能靠本地规则猜测

旧本地兜底直接读取句子中的第一个数字，`7月11日买了3杯咖啡，微信花了50元` 会误识别成 7 元。第一轮按“明确货币单位 → 金额语境 → 唯一数字”建立优先级后，进一步用异常输入审查发现：多个金额、外币、千位分隔符、冲突收支词和无法确定年份的日期仍不能安全自动入账。

最终本地兜底遵循保守原则：

1. 带“元、块、¥”的明确金额。
2. “花了、收入、报销、共、合计”等金额语境。
3. 去掉日期、时间和计量数量后，仅剩一个无歧义数字。
4. 多个金额不做相抵或任选一个，返回 `missing_fields=["amount_cents"]`。
5. 外币不按人民币记入，带千位分隔符的金额不截断为尾部数字，两者都要求用户确认。
6. `7月11日`、星期等无法由本地规则唯一确定的日期标记为缺失，不把当前时间伪装成已识别结果。
7. 同一句同时出现收入与支出语义时标记收支类型缺失；AI 未识别分类时前端留空，用户可以明确选择“其他”后保存。

中文数字仍主要交给模型理解：真实线上模型已正确把“两千元”转换为 `200000` 分；本地确定性兜底只承诺阿拉伯数字，不能确认时宁可阻止保存，也不伪造结果。

### 公开设置可被覆盖

旧线上设置接口没有登录保护，任何人都可以修改模型配置。新增 `RUNTIME_AI_SETTINGS_WRITABLE`：本地默认可写，Render 演示环境关闭写入，Key 只通过服务器环境变量配置。测试保证只读环境返回 `403`，公开响应不包含 Key。

### 页面加载重复消耗点评额度

旧前端在首次打开、切换月份或切换语气时直接调用模型，即使账单没有变化也会重复生成；用户新增流水后反而不会自动更新，成本和数据一致性都不理想。

我们比较了“数据改变就自动生成”与“完全手动”，最终采用可解释的混合手动策略：前端只在用户进入点评所在页面时读取 SQLite 缓存；`GET` 永不调用模型，`POST` 只在点击按钮后生成。后端用统计、语气、模型配置和 Prompt 版本的指纹标记 `fresh/stale/missing`；旧点评不删除，但数据变化后明确提示需要重新分析。

### 长设置页的侧栏断层

设置页内容超过一屏时，右侧工作区继续延伸，左侧侧栏却因 `height: calc(100dvh - 32px)` 在一屏后结束，形成明显的材质断层。第一次修改虽然让底板与工作区等高，但浏览器几何测量发现内部 `sticky` 没有生效；继续检查计算样式后，定位到外层 `overflow: hidden` 创建了不滚动的裁切容器。最终改为“等高材质底板 + 独立吸附内层”，并用 `overflow: clip` 保留背景裁切而不破坏吸附。

这个问题不是靠目测“差不多”验收：长设置页测得左右高度差为 `0px`，滚动到文档底部时吸附内层仍在视口内；`1280px`、`1024px`和 `390px` 三档宽度都无横向溢出。

### 基础需求与界面文案复核

最终验收不是继续添加大功能，而是重新逐项对照选拔指南。审查发现已有“按日期分组”仍不能覆盖明确要求的“按周流水与基础统计”，因此先写一个周边界行为测试：指定周只允许周一到周日的记录进入统计。测试最初因 `/api/stats/weekly` 不存在返回 `404`，随后补齐日期范围查询、周统计接口和前端月/周切换，跨月周也按完整七天计算。

同一轮还区分了两种文案责任：界面面向记账用户，只说明能做什么和当前状态；README、AI_LOG、DEFENSE_NOTES 才解释 SQLite、Provider、缓存和故障恢复。快记主提示因此从开发过程式描述收敛为“AI 解析语义，手动确认入账”，并逐页移除对普通用户无帮助的工程术语。

首次推送后的线上浏览器验收又发现一个本地低延迟下不明显的竞态：进入周视图后立刻切换周次，两个统计请求可能乱序返回，造成周期标签已经更新、金额却短暂属于上一周。修复使用递增请求序号，只允许最后一次周查询更新统计、流水、错误和加载状态；随后用线上慢链路重复快速切周验证日期与金额一致。

### 交易时间必须成为可编辑的业务字段

原始任务要求用户能够输入时间，但旧表单虽然在数据结构中保存 `occurred_at`，界面没有可见编辑入口；同时 Render 服务器时区可能是 UTC，直接使用无时区 `datetime.now()` 会让“今天”及月末、周末边界发生偏移。

最终方案不是只补一个日期控件，而是统一整条时间链：后端用 `ZoneInfo("Asia/Shanghai")` 归一为带 `+08:00` 的 ISO 8601；查询和统计先转换成北京时间日期；前端用专门函数在 API 时间与 `datetime-local` 之间转换，不用会隐式转 UTC 的 `toISOString()` 保存表单值。新建默认当前北京时间，AI 推断时间和已有流水时间都进入同一个可编辑字段。

行为测试从 `2026-06-30T16:30:00Z` 创建交易，确认其保存为 `2026-07-01T00:30:00+08:00`，随后把同一笔账移动到下一周和下个月，验证旧周期减少、新周期增加。Windows 首轮测试还暴露 `zoneinfo` 缺少 IANA 数据，因而将 `tzdata` 明确加入运行依赖。

### 草稿和异步请求都需要“新旧”边界

AI 解析成功后继续修改原始描述，旧界面仍可提交上一次草稿。这不是模型准确率问题，而是前端状态关联错误。修复后记录 `parsedSourceText`：当前文本与解析来源不一致时显示“描述已修改，请重新解析”，保留旧草稿供对照但禁止写入；重新解析后才恢复确认。编辑模式同时增加取消操作，恢复新的空白草稿和当前交易时间，不写数据库。

月度请求也补上与周度相同的递增请求号。自动化测试故意让旧月份延迟并返回错误、新月份先成功，确认旧响应、旧错误和旧 `finally` 都不能覆盖最新页面。

### 输入与启动数据边界

交易接口将 0 元与异常大额统一视为非法：AI 草稿仍允许用 0 表示“金额未识别”，但创建和更新只接受 `1–9,999,999,999` 分，SQLite 触发器为已有数据库补上同样保护。演示数据改由 `SEED_DEMO_DATA` 显式开启，并用 `demo_seed_completed` 记录首次初始化，避免用户删空账本后重启又出现八条样例。

Provider 调用新增结构化安全日志，记录主/备槽位、模型、耗时、HTTP 状态、异常类型和请求追踪 ID；测试确认日志不包含 API Key 和完整账单原文。

## 10. 协作证据索引

这张索引只关联仓库中真实存在的提交、实现和验证，不补写不存在的聊天记录。

| 提交 | 协作阶段与判断 | 代码/文档落点 | 验证证据 |
|---|---|---|---|
| [`5551644`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/5551644) | 从 Render 构建日志定位 Python 3.14 与 `pydantic-core` wheel 不匹配，而不是盲目升级依赖 | [`.python-version`](.python-version)、[`render.yaml`](render.yaml)、[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Render 3.11.9 构建成功，`/api/health` 恢复 200 |
| [`ab7e827`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/ab7e827) / [`e64e1d0`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/e64e1d0) | 处理 Groq Qwen 推理包装文本与结构化 JSON，并把线上 Provider 迁移口径同步到交付文档 | [`backend/app/ai.py`](backend/app/ai.py)、[`backend/tests/test_api.py`](backend/tests/test_api.py)、本日志与部署文档 | 包装 JSON 解码、主模型结构化快记和点评回归 |
| [`f6322c8`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/f6322c8) | 拒绝“页面加载就调用模型”，改为手动生成与 SQLite 指纹缓存 | [`backend/app/advice_cache.py`](backend/app/advice_cache.py)、[`backend/app/main.py`](backend/app/main.py)、[`frontend/src/App.tsx`](frontend/src/App.tsx) | `GET` 不调用 Provider，`POST` 后为 `fresh`，数据变化后为 `stale` |
| [`1074da3`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/1074da3) | 重新对照任务书后补齐周一至周日流水与统计，而不是把日期分组冒充周统计 | [`backend/app/stats.py`](backend/app/stats.py)、[`backend/app/repository.py`](backend/app/repository.py)、[`backend/app/main.py`](backend/app/main.py) | [`backend/tests/test_api.py`](backend/tests/test_api.py) 覆盖跨月周和边界外记录 |
| [`2667b4c`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/2667b4c) | 浏览器快速切周发现旧响应覆盖新页面，增加周请求序列保护 | [`frontend/src/App.tsx`](frontend/src/App.tsx) | 当时以延迟请求浏览器复现与回归；`38f91ab` 又为同类月度竞态增加 Playwright 自动化 |
| [`38f91ab`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/38f91ab) | 收口可编辑时间、北京时间、金额边界、旧草稿失效、月请求竞态、演示数据和安全日志 | [`backend/app/business_time.py`](backend/app/business_time.py)、[`backend/app/money.py`](backend/app/money.py)、[`frontend/src/businessTime.ts`](frontend/src/businessTime.ts)、[`frontend/src/App.tsx`](frontend/src/App.tsx) | 29 项 pytest、5 项 Playwright、Vite 生产构建和密钥扫描通过 |
| [`1f60c36`](https://github.com/Super-Ice-Knight/pocket-ledger-ai/commit/1f60c36) | 根据异常输入审查继续收紧本地兜底，并允许用户显式确认“其他”分类 | [`backend/app/ai.py`](backend/app/ai.py)、[`backend/app/money.py`](backend/app/money.py)、[`frontend/src/App.tsx`](frontend/src/App.tsx) | 35 项 pytest、7 项 Playwright、Vite 生产构建与 `git diff --check` 通过 |

## 11. 验收证据

- 后端：35 项 pytest 行为测试通过，覆盖金额边界、北京时间跨日、编辑后跨周/跨月统计、演示数据单次初始化、月份与日期范围校验、AI 缺失字段重算、安全日志及歧义输入。
- 前端：7 项 Playwright 测试与 TypeScript/Vite 生产构建通过。
- 金额：浏览器输入 `50.` 保留文本并提示补全；输入 `12.60` 后实际提交 `1260` 分。
- 时间：`datetime-local` 与 `+08:00` 双向转换不偏移；AI 时间可修改后提交，编辑流水可跨周期移动。
- 草稿状态：修改解析来源文本后确认按钮禁用；重新解析后恢复，取消编辑不产生更新请求。
- 主备机制：早期本机实测 Agnes 失败后由硅基流动返回结构化结果；最终线上因延迟审查改为 Groq 单主模型，Provider 测试 917 ms。
- 中文金额：线上模型实测“两千元”解析为 200000 分；本地确定性兜底仍只承诺阿拉伯数字。
- 歧义输入：多个金额、外币、千位分隔符、明确但未解析的日期及收支冲突均进入人工确认；用户可显式选择“其他”分类后保存。
- 双模型失败：测试确认依次尝试主、备接口后返回 `source=error_fallback`。
- 安全：设置状态和接口测试不回显真实 Key，公开只读模式禁止写入。
- 响应式：`1440×900` 与 `390×844` 无横向溢出；手机首屏可看到快记输入和解析按钮。
- 交互：删除操作必须经过确认对话框，取消不会修改数据。
- 点评缓存：行为测试确认 `GET` 不会调用 Provider，`POST` 生成后可重启读取，新增流水后返回 `stale` 且不增加模型调用次数。
- 缓存界面：隔离浏览器验收覆盖 `missing → fresh → stale`；整页刷新后直接展示 SQLite 结果，`390×844` 无横向溢出。
- 应用外壳：长设置页左右容器高度差为 `0px`，页面底部侧栏导航仍可见；`1280/1024/390px` 无横向溢出。
- 月/周流水：桌面与手机均可切换周期；周度收入、支出、净额和笔数与同一日期范围内的明细一致，`390×844` 金额不换行。
- 请求竞态：延迟可控的浏览器测试确认旧月份失败不会覆盖新月份成功结果；周度保护保持不回归。
- 文案：手机首屏完整显示“AI 解析语义，手动确认入账”，页面说明不再承担部署与 Debug 说明。

在线入口：

- https://pocket-ledger-ai.vercel.app/
- https://pocket-ledger-ai.onrender.com/
- https://github.com/Super-Ice-Knight/pocket-ledger-ai

## 12. 协作能力总结

AI 在这个项目中负责读取任务、提出方案、生成与修改代码、构造测试、分析日志和执行浏览器回归。我负责判断产品方向、否决不符合目标的方案、确认实现边界、检查来源标记，并要求每项核心能力能够在答辩中解释。

协作重点不是写出更长的 Prompt，而是形成循环：

```text
任务要求 → 仓库审查 → 风险排序 → 单项测试 → 最小实现
→ 浏览器验证 → 发现新问题 → 文档沉淀 → 再验收
```

这个循环让 AI 输出不再是一次性抽奖，而是可以复现、检查和修正的工程过程。
