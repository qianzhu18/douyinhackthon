# 这一帧怎么说 · Vercel 源码

这是一个桌面端优先的视频语言学习应用：上传本地视频或打开实时摄像头、暂停任意画面，再由阶跃星辰视觉模型生成当前语言的学习浮窗。

当前仓库的 API 已整理为可独立部署的 Vercel + Supabase 后端：Supabase Auth 负责用户身份，Postgres 保存学习档案和用量窗口，Vercel Functions 只负责鉴权、额度控制和模型调用。前端可以独立迭代，只需逐步改为传递 Supabase access token。

## 正式部署架构

```
Browser ── Supabase Auth ──> Bearer access token
   │                                │
   └──────────────> Vercel API <────┘
                             │
              StepFun models │ Supabase Postgres
```

- `SUPABASE_SERVICE_ROLE_KEY` 只存在 Vercel 环境变量中，绝不进入浏览器代码。
- 画面仅在用户暂停时送往模型；原视频和摄像头流不会写入本项目数据库。
- 每个模型接口按用户、按日原子计数，超过配额返回 `429`。
- 画面识别默认使用 `step-1o-turbo-vision`；词汇详情、场景任务和评价默认使用更快的 `step-3.5-flash`。
- 现有共享体验码仅为迁移兼容层；生产环境应保持 `ALLOW_LEGACY_ACCESS_CODE=false`。

## 首次部署

1. 在 Supabase 创建项目，并在 SQL Editor 执行 [`supabase/migrations/20260726_initial.sql`](./supabase/migrations/20260726_initial.sql)。
2. 在 Supabase Auth 配置站点 URL、允许的 Redirect URL，并启用计划使用的登录方式（邮件验证码或 OAuth）。
3. 复制 `.env.example` 为 `.env.local`，填写 StepFun 与 Supabase 的环境变量。
4. 在 Vercel 配置同名 Production / Preview 环境变量并部署；Node.js 版本使用 20+。
5. 访问 `/api/health` 验证服务配置。生产环境不要设置 `HEALTHCHECK_DEBUG=true`。

## 前端对接契约

除临时兼容模式外，所有受保护请求都应发送：

```http
Authorization: Bearer <Supabase session.access_token>
```

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/auth` | `GET` | 校验当前登录会话 |
| `/api/me` | `GET` | 当前用户与学习设置 |
| `/api/settings` | `GET`, `PUT` | 目标语言与难度 |
| `/api/learning-state` | `GET`, `PUT` | 收藏、屏蔽概念与掌握度的跨端同步 |
| `/api/analyze` | `POST` | 暂停帧识别，默认每天 30 次 |
| `/api/detail` | `POST` | 单词详情，默认每天 100 次 |
| `/api/challenge` | `POST` | `generate` 场景任务或 `evaluate` 口语回答，默认每天 30 次 |
| `/api/health` | `GET` | 仅部署健康检查 |

`PUT /api/learning-state` 是幂等的增量 upsert：前端只上传新增或变更的项目，后端不会删除未传入的历史记录。

## 功能

- 视频只在浏览器本地播放，不上传到服务器
- 摄像头流只在浏览器实时预览，切换模式或离开页面时立即释放设备
- 点击画面或按空格暂停，发送压缩后的当前帧进行分析
- 先快速识别最多 5 个可见物品、人物、动作或场景表达
- 点击浮窗后再用轻量纯文本请求生成发音、例句和搭配，并在当前帧中缓存
- 英语、日语、韩语按当前选择单独生成，并按“暂停帧 + 语言 + 难度”缓存
- 支持 A1–A2、B1–B2、C1–C2 三档选词与例句难度
- 学习点使用统一英文 `concept` 标识，可加入跨语言全局黑名单并随时恢复
- 点击浮窗展开词性、读音、中文释义、画面例句和常用搭配
- 系统语音朗读、本地生词收藏、自定义进度与声音控制
- 阶跃星辰 API Key 仅存在 Vercel 服务端，不会发送到浏览器
- 共享体验码、学习难度、黑名单和生词本保存在浏览器 `localStorage`
- 图像在内存中处理，不写入磁盘

## 本地运行

本项目无运行时 npm 依赖。Vercel Function 需要通过 Vercel CLI 启动：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 STEPFUN_API_KEY 和 Supabase 配置
npx vercel dev
```

打开 CLI 输出的本地地址。只用 `python3 -m http.server` 可以预览页面，但 `/api/analyze` 不会运行。

## 部署到 Vercel

### 方法一：网页导入

1. 将本目录上传到一个 GitHub 仓库。
2. 在 Vercel 点击 **Add New → Project**。
3. 导入该仓库。
4. Framework Preset 选择 **Other**。
5. Build Command、Output Directory 保持为空。
6. 在 **Environment Variables** 中添加 `STEPFUN_API_KEY`。
7. 添加 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`。
8. 可选添加 `STEPFUN_VISION_MODEL`，默认值是 `step-1o-turbo-vision`。
9. 可选添加 `STEPFUN_TEXT_MODEL`；不设置时复用 `STEPFUN_VISION_MODEL` 的纯文本能力。
10. 可选添加 `STEPFUN_BASE_URL`。中国区默认是 `https://api.stepfun.com/v1`；国际区可设为 `https://api.stepfun.ai/v1`。
11. 点击 **Deploy**。

### 方法二：Vercel CLI

```bash
npx vercel
```

首次询问配置时：

- Set up and deploy：`Y`
- Link to existing project：按实际情况选择
- Directory：当前目录
- Modify settings：`N`

## 文件说明

- `index.html`：页面结构与产品文案
- `demo.css`：全部视觉和响应式样式
- `demo.js`：暂停学习、图签、语音、评分等交互
- `api/analyze.js`：Vercel 服务端视觉分析接口，带用户配额
- `api/detail.js`：词汇详情接口，带用户配额
- `api/me.js`、`api/settings.js`、`api/learning-state.js`：跨端用户学习档案 API
- `supabase/migrations/20260726_initial.sql`：数据库、RLS 与原子用量计数
- `cafe-scene.jpg`：演示场景图片
- `og.png`：分享预览图
- `vercel.json`：Vercel 路由与缓存配置

## 注意事项

- 单词朗读使用浏览器 Web Speech API。
- 摄像头模式需要浏览器授权，并且只能在 HTTPS 或 `localhost` 安全环境中使用。
- 部分不支持语音识别的浏览器会自动进入模拟演示流程。
- 单个视频限制为 500MB；发送给模型的当前帧会缩放到最长边 1024px 并压缩为 JPEG。
- 正式环境必须使用 Supabase 登录；体验码不是正式身份体系。
- 如绑定正式域名，建议将 `index.html` 中的 `og:image` 和
  `twitter:image` 更新为完整的正式域名地址。
