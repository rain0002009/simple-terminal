import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyHttpProxy from '@fastify/http-proxy'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  ACCESS_KEY_ID_HEADER,
  ACCESS_KEY_SECRET_HEADER,
  createTaskLogWebSocketSignatureHeaders,
  signProxyHeaders,
} from './access-key-signature.mjs'
import { registerAiRoutes } from './ai-routes.mjs'
import { loadDotEnv } from './load-env.mjs'
import { getCookieValue, getHeaderValue } from './http-utils.mjs'
import { createObsConfig, registerObsRoutes } from './obs-routes.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')

const envFilePath = loadDotEnv([__dirname, path.resolve(__dirname, '..')])

const requiredEnvNames = ['TARGET_HTTP', 'TARGET_WS', 'TARGET_ORIGIN', 'ORG_ID']
const missingEnvNames = requiredEnvNames.filter((name) => !String(process.env[name] ?? '').trim())
if (missingEnvNames.length > 0) {
  console.error(
    `[koko] 缺少必填部署配置：${missingEnvNames.join(', ')}。请复制 .env.example 为 .env 并填写` +
      '（开发环境放在仓库根目录，生产环境放在 server/ 或仓库根目录）。',
  )
  process.exit(1)
}

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 8081)
const targetHttp = String(process.env.TARGET_HTTP).trim()
const targetWs = String(process.env.TARGET_WS).trim()
const targetOrigin = String(process.env.TARGET_ORIGIN).trim()
let targetHost = ''
try {
  targetHost = new URL(targetOrigin).host
} catch {
  console.error('[koko] TARGET_ORIGIN 不是合法 URL。')
  process.exit(1)
}
const upstreamProxy = process.env.UPSTREAM_PROXY?.trim() || undefined
const wsAgent = upstreamProxy ? new HttpsProxyAgent(upstreamProxy) : undefined
const orgId = String(process.env.ORG_ID).trim()
const obsConfig = createObsConfig({ upstreamProxy })
const ACCESS_KEY_ID_COOKIE_NAME = 'koko_access_key_id'
const ACCESS_KEY_SECRET_COOKIE_NAME = 'koko_access_key_secret'

const bodyLimitEnv = Number(process.env.BODY_LIMIT)
const bodyLimit = Number.isFinite(bodyLimitEnv) && bodyLimitEnv > 0 ? bodyLimitEnv : 1024 * 1024 * 1024

const app = Fastify({
  logger: true,
  bodyLimit,
})

if (obsConfig.scheme === 'https' && !obsConfig.tlsRejectUnauthorized) {
  app.log.warn('OBS TLS certificate verification is disabled. Configure OBS_CA_FILE and set OBS_TLS_REJECT_UNAUTHORIZED=true for production verification.')
}

app.addContentTypeParser(/^(?!application\/json(?:;|$))(?!application\/x-www-form-urlencoded(?:;|$))application\/.+/i, { parseAs: 'buffer' }, (_request, body, done) => {
  done(null, body)
})

app.addContentTypeParser('*', { parseAs: 'buffer' }, (request, body, done) => {
  if (request.url.startsWith('/obs/objects') || request.url.startsWith('/obs/')) {
    done(null, body)
    return
  }
  done(null, body)
})

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api')) return

  const accessKeyId = getHeaderValue(request.headers, ACCESS_KEY_ID_HEADER)
  const accessKeySecret = getHeaderValue(request.headers, ACCESS_KEY_SECRET_HEADER)
  const hasAccessKeyId = accessKeyId.length > 0
  const hasAccessKeySecret = accessKeySecret.length > 0

  if (hasAccessKeyId === hasAccessKeySecret) return

  reply.code(400).send({
    message: 'X-KOKO-ACCESS-KEY-ID and X-KOKO-ACCESS-KEY-SECRET must be provided together.',
  })
})

app.get('/config.json', async (_request, reply) => {
  reply.header('cache-control', 'no-store')
  return { orgId, host: targetHttp }
})

await app.register(fastifyHttpProxy, {
  upstream: targetHttp,
  prefix: '/api',
  rewritePrefix: '/api',
  replyOptions: {
    rewriteRequestHeaders: (request, headers) => ({
      ...signProxyHeaders({
        headers,
        method: request.method,
        pathWithQuery: request.raw.url ?? request.url,
        orgId,
      }),
      host: targetHost,
      origin: targetOrigin,
    }),
  },
  ...(upstreamProxy
    ? {
        undici: {
          proxy: upstreamProxy,
        },
      }
    : {}),
})

registerAiRoutes(app)
registerObsRoutes(app, obsConfig)

await app.register(fastifyHttpProxy, {
  upstream: targetHttp,
  wsUpstream: targetWs,
  websocket: true,
  prefix: '/koko/ws',
  rewritePrefix: '/koko/ws',
  wsClientOptions: {
    ...(wsAgent ? { agent: wsAgent } : {}),
    rewriteRequestHeaders: (headers, request) => {
      const cookie = request.headers.cookie

      return {
        ...headers,
        ...(cookie ? { cookie } : {}),
        host: targetHost,
        origin: targetOrigin,
      }
    },
  },
})

await app.register(fastifyHttpProxy, {
  upstream: targetHttp,
  wsUpstream: targetWs,
  websocket: true,
  prefix: '/task-log/ws',
  rewritePrefix: '/ws',
  wsClientOptions: {
    ...(wsAgent ? { agent: wsAgent } : {}),
    rewriteRequestHeaders: (headers, request) => {
      const accessKeyId = getCookieValue(request.headers.cookie, ACCESS_KEY_ID_COOKIE_NAME).trim() || obsConfig.accessKeyId
      const accessKeySecret = getCookieValue(request.headers.cookie, ACCESS_KEY_SECRET_COOKIE_NAME).trim() || obsConfig.secretAccessKey
      const signedHeaders = accessKeyId && accessKeySecret
        ? createTaskLogWebSocketSignatureHeaders({ accessKeyId, accessKeySecret })
        : {}
      const { cookie, ...restHeaders } = headers

      return {
        ...restHeaders,
        ...signedHeaders,
        host: targetHost,
        origin: targetOrigin,
      }
    },
  },
})

await app.register(fastifyStatic, {
  root: distDir,
  prefix: '/',
  index: ['index.html'],
})

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api') || request.url.startsWith('/koko/ws') || request.url.startsWith('/ai') || request.url.startsWith('/obs') || request.url.startsWith('/task-log')) {
    reply.code(404).send({ message: 'Not Found' })
    return
  }
  void reply.sendFile('index.html')
})

try {
  await app.listen({ host, port })
  app.log.info(
    {
      host,
      port,
      envFile: envFilePath || '(not found)',
      targetHttp,
      targetWs,
      targetOrigin,
      upstreamProxy: upstreamProxy || '(disabled)',
      obsScheme: obsConfig.scheme,
      obsEndpointHost: obsConfig.endpointHost,
      obsTlsRejectUnauthorized: obsConfig.tlsRejectUnauthorized,
    },
    'koko server started',
  )
} catch (error) {
  app.log.error(error, 'failed to start koko server')
  process.exit(1)
}
