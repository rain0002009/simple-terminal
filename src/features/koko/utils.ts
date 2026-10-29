import type {
  AssetConnectionDefaults,
  AssetGranted,
  AssetOption,
  AssetPermedAccount,
  AssetPermedDetail,
  AssetPermedProtocol,
  ConnectMethodRecord,
  ConnectionTokenApiRecord,
  ConnectionTokenRecord,
  FavoriteAssetApiRecord,
  FavoriteAssetRecord,
  ProtocolMessage,
} from './types'
import { KOKO_WS_ENDPOINT } from './constants'

const textDecoder = new TextDecoder()

const RZ_WAITING_MARKER = 'rz waiting to receive.'
const ZMODEM_HEX_BURST_PATTERN = /\*{1,2}B[0-9a-f]{8,}/gi
const ZMODEM_HEX_BURST_SIGNATURE_PATTERN = /\*{1,2}B[0-9a-f]{8,}/i

export type TerminalDisplaySanitizeResult = {
  text: string
  carry: string
}

const isFilteredZmodemControlChar = (char: string): boolean => {
  const code = char.charCodeAt(0)
  return (
    (code >= 0x00 && code <= 0x07) ||
    code === 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1a) ||
    (code >= 0x1c && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xfffd
  )
}

const stripFilteredZmodemControlChars = (text: string): string =>
  Array.from(text)
    .filter((char) => !isFilteredZmodemControlChar(char))
    .join('')

const extractPartialMarkerSuffix = (text: string, marker: string): string => {
  const maxLength = Math.min(text.length, marker.length - 1)
  for (let length = maxLength; length >= 2; length -= 1) {
    const suffix = text.slice(-length)
    if (marker.startsWith(suffix.toLowerCase())) return suffix
  }
  return ''
}

const extractPartialZmodemBurstSuffix = (text: string): string => {
  const match = text.match(/(\*{1,2}B[0-9a-f]*|\*{1,2}B|\*{1,2}|\*)$/i)
  return match?.[0] ?? ''
}

const extractTerminalNoiseCarry = (text: string): string => {
  const partialWaitingMarker = extractPartialMarkerSuffix(text, RZ_WAITING_MARKER)
  const partialZmodemBurst = extractPartialZmodemBurstSuffix(text)

  if (partialWaitingMarker.length >= partialZmodemBurst.length) return partialWaitingMarker
  return partialZmodemBurst
}

export const sanitizeTerminalDisplayChunk = (
  chunk: string,
  carry = '',
): TerminalDisplaySanitizeResult => {
  const combined = `${carry}${chunk}`
  if (!combined) return { text: '', carry: '' }

  const nextCarry = extractTerminalNoiseCarry(combined)
  const stableText = nextCarry ? combined.slice(0, -nextCarry.length) : combined
  const hadZmodemSignature =
    stableText.toLowerCase().includes(RZ_WAITING_MARKER) ||
    ZMODEM_HEX_BURST_SIGNATURE_PATTERN.test(stableText)

  let sanitizedText = stableText
    .replace(/rz waiting to receive\.[^\r\n]*/gi, '')
    .replace(ZMODEM_HEX_BURST_PATTERN, '')

  if (hadZmodemSignature) {
    sanitizedText = stripFilteredZmodemControlChars(sanitizedText)
  }

  return {
    text: sanitizedText,
    carry: nextCarry,
  }
}

export const safeString = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const nowLabel = (): string =>
  new Date().toLocaleTimeString('zh-CN', { hour12: false })

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const resolvedEndpoint = trimTrailingSlash(KOKO_WS_ENDPOINT)

export const buildSocketUrl = (token: string): string =>
  `${resolvedEndpoint}/?disableautohash=false&token=${encodeURIComponent(token)}&_=${Date.now()}`

export const parseProtocolMessage = (raw: string): ProtocolMessage | null => {
  const text = raw.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.type !== 'string') return null
    return {
      id: typeof candidate.id === 'string' ? candidate.id : undefined,
      type: candidate.type,
      data: candidate.data,
      err: typeof candidate.err === 'string' ? candidate.err : undefined,
    }
  } catch {
    return null
  }
}

export const formatDateForInput = (date: Date): string => {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const buildDefaultExpiryDate = (): string => {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return formatDateForInput(date)
}

export const buildApiDateTime = (dateText: string): string => {
  const localDate = new Date(`${dateText}T23:59:59.999`)
  if (Number.isNaN(localDate.getTime())) return dateText
  return localDate.toISOString()
}

export const formatDisplayDate = (value: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export const buildAssetOption = (asset: AssetGranted): AssetOption | null => {
  if (!asset.id) return null
  const platformName = typeof asset.platform === 'string' ? asset.platform : asset.platform?.name
  const address = asset.address?.trim() || asset.ip?.trim()
  const name = asset.name?.trim() || asset.id
  const detail = [address, asset.display_name, asset.hostname, platformName, asset.comment]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join(' · ')
  return {
    value: asset.id,
    label: name,
    description: detail,
    address: address || name,
  }
}

export const mapFavoriteAssetRecord = (
  record: FavoriteAssetApiRecord,
): FavoriteAssetRecord | null => {
  const assetId = typeof record.asset === 'string' ? record.asset : record.asset?.id
  if (!assetId) return null

  return {
    id: record.id ?? assetId,
    assetId,
  }
}

export const mapConnectionTokenRecord = (
  record: ConnectionTokenApiRecord,
): ConnectionTokenRecord | null => {
  const assetId = typeof record.asset === 'string' ? record.asset : record.asset?.id
  if (!record.id || !assetId || !record.date_expired) return null

  const assetName = typeof record.asset === 'string' ? record.asset : record.asset?.name
  return {
    id: record.id,
    secret: record.value ?? record.secret ?? record.id,
    tokenId: record.id,
    assetId,
    assetName: record.asset_display?.trim() || assetName?.trim() || assetId,
    createdAt: record.date_created ?? '',
    expiresAt: record.date_expired,
    isValid: record.is_valid ?? !record.is_expired,
  }
}

const isConnectableAccount = (account: AssetPermedAccount): boolean =>
  account.actions?.includes('connect') ?? true

const pickPermedAccount = (accounts: AssetPermedAccount[]): AssetPermedAccount | null =>
  accounts.find((account) => isConnectableAccount(account) && account.has_secret !== false) ??
  accounts.find(isConnectableAccount) ??
  accounts[0] ??
  null

const pickPermedProtocol = (protocols: AssetPermedProtocol[]): AssetPermedProtocol | null =>
  protocols.find((protocol) => protocol.name === 'ssh') ?? protocols[0] ?? null

const pickConnectMethod = (
  protocolName: string,
  connectMethods: ConnectMethodRecord[],
): ConnectMethodRecord | null => {
  const matchedByProtocol = connectMethods.filter((method) => method.endpoint_protocol === protocolName)
  return (
    matchedByProtocol.find((method) => method.component === 'koko' && method.value === 'web_cli') ??
    matchedByProtocol.find((method) => method.component === 'koko') ??
    connectMethods.find((method) => method.value === 'web_cli') ??
    connectMethods.find((method) => method.component === 'koko') ??
    matchedByProtocol[0] ??
    connectMethods[0] ??
    null
  )
}

export const buildAssetConnectionDefaults = (
  asset: AssetPermedDetail,
  connectMethods: ConnectMethodRecord[],
): AssetConnectionDefaults => {
  const assetId = asset.id?.trim() ?? ''
  if (!assetId) throw new Error('资产详情缺少资产 ID。')

  const account = pickPermedAccount(asset.permed_accounts ?? [])
  const accountAlias = account?.alias?.trim() || account?.id?.trim() || account?.name?.trim() || ''
  if (!accountAlias) throw new Error('该资产没有可用的授权账号（permed_accounts 为空）。')

  const protocol = pickPermedProtocol(asset.permed_protocols ?? [])
  const protocolName = protocol?.name?.trim() || 'ssh'
  const connectMethod = pickConnectMethod(protocolName, connectMethods)
  const connectMethodValue = connectMethod?.value?.trim() || 'web_cli'

  return {
    assetId,
    account: accountAlias,
    inputUsername: account?.username?.trim() || account?.name?.trim() || '',
    protocol: protocolName,
    connectMethod: connectMethodValue,
  }
}

export const decodeFrameToString = async (frame: string | ArrayBuffer | Blob): Promise<string> => {
  if (typeof frame === 'string') return frame
  if (frame instanceof Blob) {
    return textDecoder.decode(new Uint8Array(await frame.arrayBuffer()))
  }
  return textDecoder.decode(new Uint8Array(frame))
}
