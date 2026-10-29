# Koko Web Terminal

这是一个基于 **Vite + React + TypeScript + UnoCSS** 的单包前端项目，用于对接 JumpServer / Koko Web Terminal 相关能力。

## 项目结构

- `src/App.tsx`：应用编排层，负责跨区域状态、API 协调与本地持久化
- `src/components/TopAuthPanel.tsx`：顶部鉴权与令牌区
- `src/components/LeftConnectionPanel.tsx`：左侧连接控制区
- `src/components/TerminalWorkspace.tsx`：右侧终端工作区
- `src/hooks/useTerminalSession.ts`：统一管理 xterm / WebSocket / ZMODEM 会话生命周期
- `server/server.mjs`：独立部署时使用的 Fastify 转发服务

## 本地开发

安装依赖：

```bash
pnpm install
```

首次运行前，先复制 `.env.example` 为仓库根目录的 `.env` 并填写必填项（`vite dev` 的代理目标与 `/config.json` 都从它读取）。

启动开发环境：

```bash
pnpm dev
```

代码检查：

```bash
pnpm lint
```

## 开发代理说明

- `vite dev` 会读取仓库根目录的 `.env`，把 `/api` 代理到 `TARGET_HTTP`、把 `/koko/ws` 代理到 `TARGET_WS`
- `vite dev` 下，`/ai`、`/obs`、`/task-log`、`/logs` 会代理到 `DEV_SERVER_URL`（默认 `http://127.0.0.1:8081`，即本地 `server.mjs`）
- `vite dev` 还会提供 `/config.json`（部署配置），与生产环境 `server.mjs` 提供的接口一致

本地联调时请注意，前端默认依赖这层代理，不是直接请求上游地址。

## 独立 Fastify 服务部署

如果你希望把当前仓库构建后的静态资源和 API / WebSocket 转发一起部署，可以使用 `server/` 下的独立 Fastify 服务。

`server` 目录有独立的依赖定义，可在部署环境单独安装：

```bash
pnpm --dir server install
pnpm --dir server start
```

启动前请先准备 `.env`（见下文“部署配置”）：缺少必填配置时 `server.mjs` 会启动失败并列出缺失字段。

## 部署配置

所有部署配置都在一份 `.env` 中：开发环境放仓库根目录（`vite dev` 与 `server.mjs` 共用），生产环境放 `server/` 或仓库根目录。仓库只保留模板 `.env.example`，真实 `.env` 已被 git 忽略（其中含 OBS 密钥，切勿提交）。

前端构建产物不包含任何部署配置：运行时从 `/config.json` 读取（仅暴露 `orgId` 与 `host` 两个字段）；服务端启动时对必填项做 fail-fast 检查。

### 必填项

- `TARGET_HTTP`：JumpServer HTTP 上游地址，如 `https://jms.example.com`
- `TARGET_WS`：JumpServer WebSocket 上游地址，如 `wss://jms.example.com`
- `TARGET_ORIGIN`：转发时写入的 `origin`，并用于上游 `host` 请求头与 AK/AS 签名
- `ORG_ID`：JumpServer 组织 ID，以 `X-JMS-ORG` 请求头发送

### 可选项

- `HOST`：监听地址，默认 `0.0.0.0`
- `PORT`：监听端口，默认 `8081`
- `UPSTREAM_PROXY`：上游代理地址；留空表示不走代理（旧版公司代理默认值已移除）
- `BODY_LIMIT`：请求体大小上限（字节），默认 1GiB
- `DEV_SERVER_URL`：开发环境 `/ai`、`/obs`、`/task-log`、`/logs` 的代理目标，默认 `http://127.0.0.1:8081`
- `OBS_ENDPOINT_HOST`：OBS endpoint 域名（不含 scheme）；`/obs` 上传必须配置
- `OBS_ACCESS_KEY_ID`、`OBS_SECRET_ACCESS_KEY`：OBS 密钥（旧版硬编码在代码里的密钥已移除）；`/obs` 上传必须配置
- `OBS_SCHEME`：OBS 上游协议，默认 `https`
- `OBS_PORT`：OBS 上游端口，HTTPS 默认 `443`
- `OBS_UPLOAD_PROXY`：OBS 使用的 HTTP 代理，未配置时沿用 `UPSTREAM_PROXY`
- `OBS_CA_FILE`：可选，OBS 或内网代理 CA PEM 文件路径
- `OBS_TLS_REJECT_UNAUTHORIZED`：是否校验 OBS TLS 证书，默认 `false`；生产环境建议配置 `OBS_CA_FILE` 后设为 `true`

## OBS 管理接口说明

独立 Fastify 服务同时提供了一组内部 OBS 管理接口，供前端弹窗和命令行工具调用。

当前默认行为：

- 默认 Bucket 可传 `yizhan`，前端里也会以它作为默认值
- OBS 请求会通过服务端转发，不需要客户端自己计算华为云签名
- 默认通过 HTTP 代理建立 HTTPS CONNECT 隧道访问 OBS，避免明文 HTTP 代理转发大文件时连接被重置
- 上传接口支持 `multipart/form-data`，也支持直接发送原始二进制 body

### 命令行上传示例

#### 方式一：使用 `multipart/form-data` 上传（推荐）

上传到 Bucket 根目录：

```bash
curl -X POST 'http://localhost:8081/obs/objects?bucket=yizhan' \
  -F 'objectKey=new.jpeg' \
  -F 'file=@./new.jpeg'
```

上传到某个目录：

```bash
curl -X POST 'http://localhost:8081/obs/objects?bucket=yizhan' \
  -F 'objectKey=images/banner/new.jpeg' \
  -F 'file=@./new.jpeg'
```

#### 方式二：直接发送原始文件 body

```bash
curl -X POST 'http://localhost:8081/obs/objects?bucket=yizhan&key=images/banner/new.jpeg' \
  -H 'Content-Type: image/jpeg' \
  --data-binary '@./new.jpeg'
```

### 其他常用命令行示例

列出某个 Bucket 当前目录对象：

```bash
curl 'http://localhost:8081/obs/objects?bucket=yizhan'
```

列出某个目录下的对象和子目录：

```bash
curl 'http://localhost:8081/obs/objects?bucket=yizhan&prefix=images/banner/'
```

查看对象元数据：

```bash
curl 'http://localhost:8081/obs/objects/images/banner/new.jpeg?bucket=yizhan'
```

读取对象内容（可用于图片预览或下载）：

```bash
curl 'http://localhost:8081/obs/object-content/images/banner/new.jpeg?bucket=yizhan' --output ./downloaded-new.jpeg
```

删除对象：

```bash
curl -X DELETE 'http://localhost:8081/obs/objects/images/banner/new.jpeg?bucket=yizhan'
```

> 提示：如果你在本地通过 `pnpm dev` 调试前端，请确保 Vite dev server 已经重启过，这样 `/obs` 代理配置才会生效。

## Access Key 转发调用说明

独立 Fastify 服务支持外部项目通过以下两个请求头访问 `/api` 下的接口：

- `X-KOKO-ACCESS-KEY-ID`
- `X-KOKO-ACCESS-KEY-SECRET`

服务端会在转发前移除这两个原始请求头，并转换为 JumpServer 所需的签名鉴权头。

注意：

- 这两个 Access Key 请求头必须同时提供
- 如果只传其中一个，服务端会直接返回 `400`
- 如果完全不传，则保持原有鉴权头透传逻辑不变

### `/api/v1/ops/job-executions/` curl 示例

下面示例演示如何通过独立 Fastify 服务调用 `job-executions` 接口：

```bash
curl -X POST 'http://localhost:8081/api/v1/ops/job-executions/' \
  -H 'Content-Type: application/json' \
  -H 'X-KOKO-ACCESS-KEY-ID: <your-access-key-id>' \
  -H 'X-KOKO-ACCESS-KEY-SECRET: <your-access-key-secret>' \
  --data-raw '{}'
```

请将示例中的请求体替换为你的 JumpServer 环境实际要求的字段。
