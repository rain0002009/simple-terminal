# AGENTS

## 作用范围
- 本文件适用于仓库根目录及其所有子目录。
- 仓库中当前未发现更细粒度的 agent 指令文件，如 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、`.github/copilot-instructions.md` 或 `opencode.json`。

## 仓库关键信息
- 这是一个单包前端仓库，使用 `pnpm`、Vite、React、TypeScript、UnoCSS。
- 尽量使用UnoCss，除非必要不要写内联样式。
- 优先使用ahooks的hooks方法。
- 根脚本只有：`pnpm dev`、`pnpm build`、`pnpm lint`、`pnpm preview`。
- `build` 的实际命令是 `tsc -b && vite build`；如果要做最接近 typecheck 的验证，以 `pnpm build` 为准。
- 未发现测试脚本，也未发现 Vitest / Jest / Playwright 等测试配置。
- 除非我有特别说明，否则不要运行build。
- 阅读 https://ant.design/llms-full.txt 并理解 Ant Design 组件库，在编写 Ant Design 代码时使用这些知识
- swagger.yaml是接口文档，其中有jumpserver相关的接口，也是本项目主要的接口文档

## 从哪里开始看代码
- 应用入口链路是：`index.html` → `src/main.tsx` → `src/App.tsx`。
- 当前界面已按三大区域拆分：
  - 顶部鉴权与令牌区：`src/components/TopAuthPanel.tsx`（含登录弹窗、连接令牌抽屉、创建令牌弹窗）
  - 左侧连接控制区：`src/components/LeftConnectionPanel.tsx`
  - 右侧终端工作区：`src/components/TerminalWorkspace.tsx`（含 rz 上传弹窗）
- `src/App.tsx` 是薄编排层，主要负责跨区数据交换、effects、API 协调与状态装配。

## 容易忽略的运行时事实
- xterm/WebSocket/ZMODEM 会话生命周期由 `src/hooks/useTerminalSession.ts` 统一持有。
- `src/App.tsx` 负责跨区域数据交换、API 编排、localStorage 持久化与通知去重，不承载终端/协议底层实现。
- WebSocket 连接走同源路径 `/koko/ws/terminal/`（由 `server.mjs` 或 vite dev 代理到 `TARGET_WS`），并带有 `JMS-KOKO` 子协议。
- 部署配置（连接目标、ORG_ID、OBS 密钥等）统一放在 `.env`（仓库根目录或 `server/`，见 `.env.example`）；前端构建产物不含配置，运行期从 `/config.json` 读取 `orgId`/`host`。协议常量仍写死在代码里，改配置不需要重新构建前端。
- Vite dev server 会读取仓库根目录的 `.env`，把 `/api` 代理到 `TARGET_HTTP`、`/koko/ws` 代理到 `TARGET_WS`；本地联调前先准备 `.env`（见 README 部署配置一节）。

## AI 面板当前架构（高频变更点）
- 右侧 AI 面板组件在 `src/components/AiAssistantPanel.tsx`，当前使用 `@assistant-ui/react` 的 `useExternalStoreRuntime`。
- `src/App.tsx` 现在是真正的 AI 会话编排层：
  - `tabAiSessions` 保存 `tabId -> AiSessionState`
  - 每个终端 tab 对应一个 AI session
  - 没有激活终端 tab 时，使用全局 session：`__global-ai-session__`
- `AiSessionState.messages` 现在使用 assistant-ui 原生 `ThreadMessage[]`，不要再引入另一套消息真相。
- `AiAssistantPanel.tsx` 负责当前 session 的视图和发送动作，但 session 的 source-of-truth 在 `App.tsx`，不是 panel 内部。
- `src/hooks/useTerminalSession.ts` 仍然只负责原始上下文来源（terminal transcript / remote editor），不要把 AI session 逻辑再塞回这个 hook。

## AI 请求与上下文管理
- 前端统一请求 `/ai/chat/completions`，不要在浏览器里直连第三方 AI 地址。
- 生产环境由 `server/server.mjs` 提供 `/ai/chat/completions`；开发环境 `vite.config.ts` 把 `/ai` 代理到 `DEV_SERVER_URL`（默认 `http://127.0.0.1:8081`，即本地 `server.mjs`）。
- OpenAI 兼容 base URL 必须保留 `/v1` 之类路径前缀，拼接方式必须是：
  - `new URL('chat/completions', `${baseUrl}/`)`
  - 不能写成 `new URL('/chat/completions', ...)`，否则会把 `/v1` 吃掉。
- 当前 AI 面板不再向普通用户暴露“附加系统提示词”和 “Temperature”；产品心智参考 opencode：显式暴露 model / agent 选择，隐式保留多层 system/instructions 能力。
- 终端 / 编辑器上下文开关现在在发送按钮旁边，不在“当前上下文”块里；“当前上下文”块已移除。
- `AiSessionState.summary` 已升级成结构化 session memory，不再只是上下文原样镜像。后续若继续迭代 compact/summary，优先沿这个字段扩展。

## AI 常见故障快速定位
- **点击发送没有任何网络请求**：先看是否存在 `activeAiSession`。当前实现已支持无终端 tab 的全局 AI session，不应再因为没有资产/tab 而完全不发请求。
- **返回 HTML 而不是模型结果**：通常是发布环境没有正确承接 `/ai/chat/completions`，或代理打到了静态站点 fallback。当前前端会明确提示“AI 代理返回了 HTML 页面...”。
- **`detail: Method Not Allowed`**：优先怀疑请求实际打到了错误路径，或服务端错误拼接了 OpenAI 兼容 URL（尤其是 `/v1` 被吃掉）。
- **`fetch is not defined`**：目标机 Node 版本较老。当前 `server/server.mjs` 已显式从 `undici` 引入 `fetch`，且 `server/package.json` 依赖 `undici@5.x` 以兼容 Node 16.16。
- **AI 报错信息过于模糊**：看 `AiAssistantPanel.tsx` 里的 `extractProxyErrorMessage` 与 `MessagePrimitive.Error`。当前已支持透传 `error.message` / `detail` / `msg` / `message`。

## 部署与发布注意事项
- 这个项目的生产形态是：`server/server.mjs` 同时托管 `../dist`、代理 `/api`、代理 `/koko/ws`、提供 `/ai/chat/completions`。不是“单纯静态站点 + 另一个无关服务”。
- 远端目录结构必须保留 `dist/` 和 `server/` 为兄弟目录，否则 `server.mjs` 找不到静态产物。
- 部署后不能只用 `/` 做健康检查；这只能证明首页能打开，不能证明 `/ai/chat/completions` 已上线。
- 更可靠的健康检查应直接验证 `/ai/chat/completions` 返回 JSON（例如缺参数时报 `baseUrl, apiKey, model and messages are required.`）。
- 若远端运行 `pnpm --dir server install --prod`，记得把锁文件策略想清楚；否则依赖解析不够稳定。

## 不要误判的目录
- `dist/` 是构建产物，不是源码入口。
- `public/` 当前只有静态图标资源。

## 修改前的默认判断
- 如果要理解功能或改动行为，优先读 `src/App.tsx`，再决定是否需要重构拆分。
- 如果要验证修改，默认先跑 `pnpm lint`；涉及类型风险时再跑 `pnpm tsc`。

## App.tsx 轻量化规则
- 不要在 `src/App.tsx` 新增重型 UI 细节或终端协议实现。
- 新增界面优先落在对应区域组件（Top/Left/Right），`App.tsx` 仅做状态与回调装配。
- 不要把 `useTerminalSession` 的职责（xterm、WebSocket、ZMODEM 生命周期）上移到 UI 组件或 `App.tsx`。

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `github.com/rain0002009/koko`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
