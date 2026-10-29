export interface AppRuntimeConfig {
  orgId: string
  host: string
}

let currentConfig: AppRuntimeConfig | null = null

export const getAppConfig = (): AppRuntimeConfig | null => currentConfig

export async function loadAppConfig(): Promise<AppRuntimeConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' })
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(
      '未能获取 /config.json 部署配置（返回的可能不是 JSON）。请确认服务端 .env 已配置，并由 server.mjs（或 vite dev）提供服务。',
    )
  }

  const data = (await response.json()) as { orgId?: unknown; host?: unknown }
  const orgId = typeof data.orgId === 'string' ? data.orgId.trim() : ''
  if (!orgId) {
    throw new Error('/config.json 缺少 orgId。请在 .env 里配置 ORG_ID 后重启服务端。')
  }

  currentConfig = {
    orgId,
    host: typeof data.host === 'string' ? data.host.trim() : '',
  }
  return currentConfig
}
