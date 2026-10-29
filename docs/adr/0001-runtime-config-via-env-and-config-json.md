# 部署配置用 .env 单文件，运行期经 /config.json 下发前端

项目从"只服务本公司"转向供外部部署者自部署，且原公司已不存在、无兼容负担，因此公司内网地址全部从代码清除。我们决定：所有**部署配置**（JumpServer 连接目标、`ORG_ID`、OBS 端点与凭据等）集中在一份 `.env`（`server.mjs` 启动时读取，`vite dev` 经 `loadEnv` 读同一份）；前端产物一份通用，不烤入任何部署值，运行期 fetch `/config.json` 获取所需字段；缺必填配置时 `server.mjs` 启动即失败（fail-fast）。**协议常量**（`JMS-KOKO` 子协议、cookie 名、API 路径形状）不进配置。

## Considered Options

- **`VITE_*` 构建期注入**：拒绝——部署者改配置必须重新构建前端，一份 dist 无法多部署复用。
- **`config.json` 单文件**：机制可行，但选择了 `.env` 的部署心智；注意 server 目标 Node 16 无 `--env-file`，需自带解析。

## Consequences

- 发布产物（`dist/` + `server/`）下载后改 `.env` 重启即可完成部署，无需 Node 构建链。
- AI 上游与 API key 由**用户设置**（浏览器内设置抽屉）承担，不进部署配置；AI 默认值与系统提示词保持代码常量。
