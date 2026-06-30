# 口袋记账 AI 版

一个面向学生日常消费场景的 AI 记账 Web 产品。系统支持一句话记账、预算看板、消费图表和 AI 财务建议，重点展示 Vibe Coding 下的需求拆解、AI 协作、代码解释能力和工程兜底。

## 核心亮点

- 一句话记账：输入“今天中午和室友吃疯狂星期四花了 50 块，微信付的”，系统解析金额、分类、账户、时间和备注。
- 用户确认入账：AI 只负责解析，不直接写数据库。
- SQLite 持久化：账单存在本地数据库文件中，刷新页面不会丢失。
- 金额精度处理：金额统一以“分”为整数存储，避免 `0.1 + 0.2` 这类浮点误差。
- 预算毒舌看板：根据本月消费和预算状态生成温和或直接的财务建议。
- 清冷银灰界面：避免常见蓝白卡片后台感，突出日常财务工具的精致感。

## 技术栈

- 前端：Vite、React、TypeScript、Tailwind CSS、Recharts、Phosphor Icons
- 后端：FastAPI、SQLite、Pydantic、httpx
- 测试：pytest
- AI：OpenAI 兼容 Chat Completions 接口；无 API Key 时自动使用本地规则解析，保证演示流程不断

## 目录结构

```text
backend/          FastAPI 后端、SQLite、AI 解析、测试
frontend/         React 前端应用
docs/             产品规格、设计系统、接口、部署和答辩文档
AI_LOG.md         AI 协同开发日志
README.md         项目入口
```

## 本地运行

### 1. 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\.env.example .env
python -m app.main
```

后端默认运行在：

```text
http://localhost:8000
```

接口文档：

```text
http://localhost:8000/docs
```

### 2. 前端

```powershell
cd frontend
npm install
npm run dev
```

前端默认运行在：

```text
http://localhost:5173
```

## 配置 AI 接口

复制 `.env.example` 为后端目录下的 `.env`，填入 OpenAI 兼容接口信息：

```env
OPENAI_COMPATIBLE_API_KEY=你的密钥
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_MODEL=你的模型名
```

如果不配置密钥，系统仍可运行，会使用本地规则解析常见中文记账句子。

## 测试

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
```

重点测试：

- 金额字符串转整数分
- AI 解析失败后的本地兜底
- 账单增删改查
- 预算统计和超支状态

## 演示流程

1. 打开首页查看本月收入、支出、预算剩余和 AI 建议。
2. 在“一句话记账”输入示例句子，点击解析。
3. 检查解析结果并确认入账。
4. 查看流水列表、分类图表和预算状态变化。
5. 演示手动录入，说明 AI 不可用时系统仍可使用。

## 答辩关注点

- 为什么用 SQLite：本地文件持久化、零数据库服务、适合单用户演示。
- 为什么金额存分：货币计算必须避免浮点误差。
- 为什么 AI 不直接入账：AI 输出需要用户确认，避免误记。
- API 失败怎么办：后端捕获异常，前端显示错误，手动记账和本地解析仍可用。
- 非法输入怎么办：前后端都有字段校验，缺金额或金额非法不会写入数据库。

