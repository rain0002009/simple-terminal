import crypto from 'node:crypto'

export const ACCESS_KEY_ID_HEADER = 'x-koko-access-key-id'
export const ACCESS_KEY_SECRET_HEADER = 'x-koko-access-key-secret'

const SIGNATURE_HEADERS = '(request-target) accept date x-jms-org'
const ACCEPT_HEADER_VALUE = 'application/json'
const SIGNING_OVERRIDE_HEADERS = [ACCESS_KEY_ID_HEADER, ACCESS_KEY_SECRET_HEADER, 'authorization', 'date']
const TASK_LOG_WS_SIGNATURE_HEADERS = '(request-target) date'

export const formatHttpDate = () => new Date().toUTCString()

const normalizeHeaderValue = (value) => {
  if (Array.isArray(value)) return String(value[0] ?? '').trim()
  return String(value ?? '').trim()
}

const findHeaderValue = (headers, headerName) => {
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === headerName)
  return normalizeHeaderValue(match?.[1])
}

const hasHeader = (headers, headerName) => Object.keys(headers).some((name) => name.toLowerCase() === headerName)

const omitHeaders = (headers, headerNames) => {
  const blockedNames = new Set(headerNames)
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blockedNames.has(name.toLowerCase())))
}

const buildSigningString = ({ method, pathWithQuery, date, orgId }) => [
  `(request-target): ${method.toLowerCase()} ${pathWithQuery}`,
  `accept: ${ACCEPT_HEADER_VALUE}`,
  `date: ${date}`,
  `x-jms-org: ${orgId}`,
].join('\n')

export const createAccessKeySignatureHeaders = ({ accessKeyId, accessKeySecret, method, pathWithQuery, orgId }) => {
  const date = formatHttpDate()
  const signingString = buildSigningString({ method, pathWithQuery, date, orgId })
  const signature = crypto.createHmac('sha256', accessKeySecret).update(signingString).digest('base64')

  return {
    accept: ACCEPT_HEADER_VALUE,
    date,
    'x-jms-org': orgId,
    authorization:
      `Signature keyId="${accessKeyId}",algorithm="hmac-sha256",` +
      `headers="${SIGNATURE_HEADERS}",signature="${signature}"`,
  }
}

export const createTaskLogWebSocketSignatureHeaders = ({ accessKeyId, accessKeySecret }) => {
  const path = '/ws/ops/tasks/log/'
  const date = formatHttpDate()
  const signingString = `(request-target): get ${path}\ndate: ${date}`
  const signature = crypto.createHmac('sha256', accessKeySecret).update(signingString).digest('base64')

  return {
    date,
    authorization:
      `Signature keyId="${accessKeyId}",algorithm="hmac-sha256",` +
      `headers="${TASK_LOG_WS_SIGNATURE_HEADERS}",signature="${signature}"`,
  }
}

export const signProxyHeaders = ({ headers, method, pathWithQuery, orgId }) => {
  const accessKeyId = findHeaderValue(headers, ACCESS_KEY_ID_HEADER)
  const accessKeySecret = findHeaderValue(headers, ACCESS_KEY_SECRET_HEADER)
  const hasAccessKeyHeaders = hasHeader(headers, ACCESS_KEY_ID_HEADER) || hasHeader(headers, ACCESS_KEY_SECRET_HEADER)

  if (!hasAccessKeyHeaders) return { ...headers }

  if (!accessKeyId || !accessKeySecret) return { ...headers }

  const nextHeaders = omitHeaders(headers, SIGNING_OVERRIDE_HEADERS)

  return {
    ...nextHeaders,
    ...createAccessKeySignatureHeaders({ accessKeyId, accessKeySecret, method, pathWithQuery, orgId }),
  }
}
