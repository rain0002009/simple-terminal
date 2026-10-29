import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import UnoCSS from 'unocss/vite'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ACCESS_KEY_ID_HEADER = 'x-koko-access-key-id'
const ACCESS_KEY_SECRET_HEADER = 'x-koko-access-key-secret'
const SIGNATURE_HEADERS = '(request-target) accept date x-jms-org'

const createAccessKeySignatureHeaders = ({
  accessKeyId,
  accessKeySecret,
  method,
  pathWithQuery,
  orgId,
}: {
  accessKeyId: string
  accessKeySecret: string
  method: string
  pathWithQuery: string
  orgId: string
}): Record<string, string> => {
  const date = new Date().toUTCString()
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${pathWithQuery}`,
    'accept: application/json',
    `date: ${date}`,
    `x-jms-org: ${orgId}`,
  ].join('\n')
  const signature = crypto.createHmac('sha256', accessKeySecret).update(signingString).digest('base64')

  return {
    accept: 'application/json',
    date,
    'x-jms-org': orgId,
    authorization:
      `Signature keyId="${accessKeyId}",algorithm="hmac-sha256",` +
      `headers="${SIGNATURE_HEADERS}",signature="${signature}"`,
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')

  const requiredEnvNames = ['TARGET_HTTP', 'TARGET_WS', 'TARGET_ORIGIN', 'ORG_ID']
  const missingEnvNames = requiredEnvNames.filter((name) => !String(env[name] ?? '').trim())
  if (missingEnvNames.length > 0) {
    throw new Error(
      `[koko] 缺少必填部署配置：${missingEnvNames.join(', ')}。请复制 .env.example 为 .env（仓库根目录）并填写。`,
    )
  }

  const targetHttp = String(env.TARGET_HTTP).trim()
  const targetWs = String(env.TARGET_WS).trim()
  const targetOrigin = String(env.TARGET_ORIGIN).trim()
  const orgId = String(env.ORG_ID).trim()
  let targetOriginHost = ''
  try {
    targetOriginHost = new URL(targetOrigin).host
  } catch {
    throw new Error('[koko] TARGET_ORIGIN 不是合法 URL。')
  }
  const devServerUrl = String(env.DEV_SERVER_URL ?? '').trim() || 'http://127.0.0.1:8081'

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      UnoCSS(),
      {
        name: 'koko-runtime-config',
        configureServer(server) {
          server.middlewares.use('/config.json', (_req, res) => {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(JSON.stringify({ orgId, host: targetHttp }))
          })
        },
      },
    ],
    server: {
      host: '0.0.0.0',
      proxy: {
        '/ai': {
          target: devServerUrl,
          changeOrigin: true,
        },
        '/obs': {
          target: devServerUrl,
          changeOrigin: true,
        },
        '/task-log': {
          target: devServerUrl,
          changeOrigin: true,
          ws: true,
        },
        '/logs': {
          target: devServerUrl,
          changeOrigin: true,
        },
        '/api': {
          target: targetHttp,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              proxyReq.setHeader('host', targetOriginHost)
              proxyReq.setHeader('origin', targetOrigin)
              proxyReq.removeHeader(ACCESS_KEY_ID_HEADER)
              proxyReq.removeHeader(ACCESS_KEY_SECRET_HEADER)
              proxyReq.removeHeader('authorization')
              proxyReq.removeHeader('date')

              const accessKeyId = String(req.headers[ACCESS_KEY_ID_HEADER] ?? '').trim()
              const accessKeySecret = String(req.headers[ACCESS_KEY_SECRET_HEADER] ?? '').trim()
              if (!accessKeyId || !accessKeySecret) return

              const signedHeaders = createAccessKeySignatureHeaders({
                accessKeyId,
                accessKeySecret,
                method: req.method ?? 'GET',
                pathWithQuery: req.url ?? '/api',
                orgId,
              })

              Object.entries(signedHeaders).forEach(([name, value]) => {
                proxyReq.setHeader(name, value)
              })
            })
          },
        },
        '/koko/ws': {
          target: targetWs,
          ws: true,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq) => {
              proxyReq.setHeader('host', targetOriginHost)
              proxyReq.setHeader('origin', targetOrigin)
            })
          },
        },
      },
    },
  }
})
