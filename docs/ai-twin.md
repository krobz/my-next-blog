# Ask krob · AI Twin 架构

博客首页内嵌的 agent：回答关于 krob 的问题，只依据博客自身内容，过程可见、成本可控。

## 请求链路

```
首页输入框 ──► POST /api/chat
                 │
                 ├─ 防护：配置检查 → 每日预算 → 单 IP 限流（Upstash Redis）
                 ├─ 校验：问题 ≤ 500 字符，历史 ≤ 12 条 / 16k 字符
                 │
                 ├─ Agent 循环（streamText，最多 5 步）
                 │    instructions = 规则 + 个人资料（静态前缀，命中 prompt cache）
                 │    tools        = searchPosts / getPost / showPosts / showTimeline
                 │
                 ├─ onEnd：按 token 用量累计当日花费
                 └─ UI message stream ──► 前端：执行轨迹 + 文字 + 卡片
```

## 知识库

- 来源：contentlayer 已生成的 `allBlogs`、`allAuthors`，外加 `data/profile.ts`（时间线、技能）。
- 处理：清洗 MDX → 按 `##`–`####` 标题切块（≤ 1600 字符）→ 内存 BM25 索引（标题、标签加权，中文按双字切分）。
- 冷启动时构建一次，常驻函数内存。文章量小，**不需要向量数据库**。

## 工具

| 工具                        | 作用               | 前端呈现            |
| --------------------------- | ------------------ | ------------------- |
| `searchPosts(query, tag?)`  | BM25 检索文章片段  | 轨迹一行            |
| `getPost(slug, section?)`   | 读取全文或指定章节 | 轨迹一行 + 来源链接 |
| `showPosts(slugs? \| tag?)` | 返回文章元数据     | 文章卡片            |
| `showTimeline(focus?)`      | 返回经历时间线     | 时间线组件          |

## 防护

| 层       | 规则                                           | 失败返回 |
| -------- | ---------------------------------------------- | -------- |
| 配置     | 生产环境必须有 OpenAI key 和 Redis             | 503      |
| 每日预算 | 当日累计花费 ≥ `ASK_DAILY_BUDGET_USD`          | 503      |
| 限流     | 每 IP 每分钟 5 次、每天 30 次                  | 429      |
| 输入     | 问题长度、历史条数与总长度                     | 400      |
| 输出     | `maxOutputTokens`、最多 5 步                   | —        |
| 内容     | 只依据资料与工具结果；工具结果视为数据而非指令 | 拒答     |
| 兜底     | OpenAI 后台设置硬性消费上限                    | —        |

## 代码位置

```
lib/ai/config.ts      模型、限额、价格（环境变量）
lib/ai/knowledge.ts   内容清洗、切块、BM25、资料读取
lib/ai/prompt.ts      system instructions
lib/ai/tools.ts       工具定义
lib/ai/guard.ts       限流与预算
lib/ai/types.ts       前后端共享的消息类型
app/api/chat/route.ts API 路由
components/ask/*      首页输入框、对话、轨迹、卡片、时间线
data/profile.ts       结构化经历与技能
```

## 环境变量

见 `.env.example` 的 “Ask krob” 一节。本地开发没有 Redis 时跳过限流和预算，生产环境缺失则拒绝服务。

默认模型为 `gpt-6-luna`，通过 OpenAI Responses API 调用，保留 `reasoning: 'low'`。标准输入和输出价格分别为每百万 token **$0.10 / $0.50**，来源：[OpenAI 模型与价格文档](https://developers.openai.com/api/docs/models/gpt-6-luna)。对应环境变量为 `OPENAI_MODEL`、`OPENAI_INPUT_USD_PER_1M`、`OPENAI_OUTPUT_USD_PER_1M`；切换模型时一起更新。预算估算按标准输入价格计算，未单独区分缓存价格。

本地 key 放在已被 Git 忽略的 `.env.local`；Vercel 配置 `OPENAI_API_KEY` 和 Redis 的 REST URL/token，并使用 Node.js 22.x。Redis 支持 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`，也支持 `KV_REST_API_URL` / `KV_REST_API_TOKEN`。

每日预算在请求开始前检查，并在各步骤完成后累计用量。多个并发请求可能同时通过检查，因此 `ASK_DAILY_BUDGET_USD` 是应用侧熔断阈值，不是严格的并发消费硬上限，也不等同于 OpenAI 账单金额。

## 路线图

- **v2**：意图路由（nano 模型过滤无关问题）、引用校验、Under-the-hood 完整轨迹（每步耗时 / token / 费用）、评测集接入 CI、Vercel BotID。
- **v3**：浏览器端工具（导航、高亮段落）、⌘K 合并搜索与提问、MCP Server、技术博文。
