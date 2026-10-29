import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { parse as parseQueryString } from 'node:querystring'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getObsAccessKeyId, getObsSecretAccessKey } from './obs-config.mjs'
import { getHeaderValue } from './http-utils.mjs'
import {
  buildObsBucketHost,
  buildObsCanonicalizedResource,
  buildObsCanonicalResource,
  buildObsRequestPath,
  createObsAuthorizationHeader,
  decodeObsObjectPath,
  validateObsBucketName,
  validateObsObjectKey,
} from './obs-signature.mjs'

const parseBooleanSetting = (value, fallback) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return { value: fallback, error: '' }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return { value: true, error: '' }
  if (['0', 'false', 'no', 'off'].includes(normalized)) return { value: false, error: '' }
  return { value: fallback, error: 'OBS_TLS_REJECT_UNAUTHORIZED must be true or false.' }
}

export const createObsConfig = ({ upstreamProxy }) => {
  const scheme = String(process.env.OBS_SCHEME ?? 'https').trim().toLowerCase()
  const uploadProxy = String(process.env.OBS_UPLOAD_PROXY ?? upstreamProxy ?? '').trim()
  const caFile = String(process.env.OBS_CA_FILE ?? '').trim()
  const tlsSetting = parseBooleanSetting(process.env.OBS_TLS_REJECT_UNAUTHORIZED, false)
  let ca
  let caError = ''
  let httpsProxyAgent
  let proxyError = ''

  if (caFile) {
    try {
      ca = fs.readFileSync(caFile)
    } catch (error) {
      caError = `Unable to read OBS_CA_FILE: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (scheme === 'https' && uploadProxy) {
    try {
      httpsProxyAgent = new HttpsProxyAgent(uploadProxy)
    } catch (error) {
      proxyError = `Unable to create OBS HTTPS proxy agent: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  return {
    accessKeyId: getObsAccessKeyId(),
    secretAccessKey: getObsSecretAccessKey(),
    endpointHost: String(process.env.OBS_ENDPOINT_HOST ?? '').trim(),
    scheme,
    port: Number(process.env.OBS_PORT || (scheme === 'https' ? 443 : 80)),
    uploadProxy,
    httpsProxyAgent,
    tlsRejectUnauthorized: tlsSetting.value,
    ca,
    configError: tlsSetting.error || caError || proxyError,
  }
}

const normalizeRawUploadBody = (body) => {
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  return null
}

const parseMultipartUpload = ({ body, contentType }) => {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? ''
  if (!boundary || !body) return null

  const boundaryText = `--${boundary}`
  const raw = body.toString('latin1')
  const parts = raw.split(boundaryText).slice(1, -1)
  let fileBuffer = null
  let fileContentType = ''
  let fileName = ''
  let objectKey = ''

  for (const part of parts) {
    const normalizedPart = part.replace(/^\r\n/, '').replace(/\r\n$/, '')
    const headerEndIndex = normalizedPart.indexOf('\r\n\r\n')
    if (headerEndIndex < 0) continue

    const headersText = normalizedPart.slice(0, headerEndIndex)
    const payloadText = normalizedPart.slice(headerEndIndex + 4)
    const dispositionMatch = /name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headersText)
    if (!dispositionMatch) continue

    const fieldName = dispositionMatch[1]
    const candidateFileName = dispositionMatch[2] ?? ''
    const payloadStart = body.indexOf(Buffer.from(payloadText, 'latin1'))
    const payloadBuffer = payloadStart >= 0
      ? body.subarray(payloadStart, payloadStart + Buffer.byteLength(payloadText, 'latin1'))
      : Buffer.from(payloadText, 'latin1')

    if (fieldName === 'file') {
      fileBuffer = payloadBuffer
      fileName = candidateFileName
      const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headersText)
      fileContentType = contentTypeMatch?.[1]?.trim() ?? ''
      continue
    }

    if (fieldName === 'objectKey') {
      objectKey = payloadBuffer.toString('utf-8').trim()
    }
  }

  if (!fileBuffer) return null

  return { fileBuffer, fileContentType, fileName, objectKey }
}

const normalizeObsQueryValue = (value) => {
  if (Array.isArray(value)) return String(value[0] ?? '').trim()
  return String(value ?? '').trim()
}

const decodeObsQueryValue = (value) => {
  const normalized = normalizeObsQueryValue(value)
  if (!normalized) return ''

  try {
    return decodeURIComponent(normalized)
  } catch {
    return normalized
  }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getObsConfigError = (obsConfig) => {
  if (obsConfig.configError) return obsConfig.configError
  if (!obsConfig.accessKeyId || !obsConfig.secretAccessKey) return 'OBS access key config is required.'
  if (!obsConfig.endpointHost || !Number.isFinite(obsConfig.port) || obsConfig.port <= 0) return 'OBS endpoint configuration is invalid.'
  if (!['http', 'https'].includes(obsConfig.scheme)) return 'OBS_SCHEME must be http or https.'
  if (!obsConfig.uploadProxy) return 'OBS_UPLOAD_PROXY or UPSTREAM_PROXY is required for OBS upload.'
  if (!parseHttpProxyUrl(obsConfig.uploadProxy)) return 'OBS upload proxy must be a valid http:// URL.'
  if (obsConfig.scheme === 'https' && !obsConfig.httpsProxyAgent) return 'OBS HTTPS proxy agent is not available.'
  return ''
}

const parseHttpProxyUrl = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:') return null
    return { host: url.hostname, port: Number(url.port || 80) }
  } catch {
    return null
  }
}

const getObsObjectPathFromRawUrl = ({ rawUrl, bucket }) => {
  const pathWithoutQuery = String(rawUrl ?? '').split('?', 1)[0] ?? ''
  const routePrefixPattern = new RegExp(`^/obs/${escapeRegExp(encodeURIComponent(bucket))}/`)
  if (!routePrefixPattern.test(pathWithoutQuery)) return ''
  return pathWithoutQuery.replace(routePrefixPattern, '')
}

const buildObsListPath = (rawQuery) => {
  const query = new URLSearchParams()
  const prefix = normalizeObsQueryValue(rawQuery.prefix)
  const marker = normalizeObsQueryValue(rawQuery.marker)
  const maxKeys = normalizeObsQueryValue(rawQuery.maxKeys || rawQuery['max-keys'])
  if (prefix) query.set('prefix', prefix)
  if (marker) query.set('marker', marker)
  if (maxKeys) query.set('max-keys', maxKeys)
  query.set('delimiter', '/')
  const queryText = query.toString()
  return queryText ? `/?${queryText}` : '/'
}

const buildObsObjectOperationPath = (encodedObjectPath, operation) => {
  if (!encodedObjectPath) return '/'
  const requestPath = buildObsRequestPath(encodedObjectPath)
  return operation ? `${requestPath}?${operation}` : requestPath
}

const parseObsXmlObjectList = (xmlText) => {
  const contentsMatches = Array.from(xmlText.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g))
  const prefixMatches = Array.from(xmlText.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g))

  const folders = prefixMatches
    .map(([, rawPrefix]) => decodeXmlText(rawPrefix.match(/<Prefix>([\s\S]*?)<\/Prefix>/)?.[1] ?? ''))
    .filter((item) => item.length > 0)

  const objects = contentsMatches.map(([, rawContent]) => ({
    key: decodeXmlText(rawContent.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? ''),
    lastModified: decodeXmlText(rawContent.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? ''),
    etag: decodeXmlText(rawContent.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1] ?? ''),
    size: Number(decodeXmlText(rawContent.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] ?? '')) || 0,
    storageClass: decodeXmlText(rawContent.match(/<StorageClass>([\s\S]*?)<\/StorageClass>/)?.[1] ?? ''),
  }))

  return { folders, objects }
}

const decodeXmlText = (value) => value
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&')

const buildObsMetadataRecord = (headers) => Object.fromEntries(
  Object.entries(headers)
    .filter(([name]) => name.toLowerCase().startsWith('x-obs-meta-'))
    .map(([name, value]) => [name, Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')]),
)

const readNodeResponseBody = async (response) => {
  const chunks = []
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const buildObsAbsoluteUrl = ({ obsConfig, bucketHost, path }) => {
  const isDefaultPort = (obsConfig.scheme === 'http' && obsConfig.port === 80)
    || (obsConfig.scheme === 'https' && obsConfig.port === 443)
  const authority = isDefaultPort ? bucketHost : `${bucketHost}:${obsConfig.port}`
  return `${obsConfig.scheme}://${authority}${path}`
}

const createObsUpstreamRequest = ({ obsConfig, bucketHost, method, path, headers, onResponse }) => {
  if (obsConfig.scheme === 'https') {
    return https.request({
      hostname: bucketHost,
      port: obsConfig.port,
      method,
      path,
      headers,
      agent: obsConfig.httpsProxyAgent,
      rejectUnauthorized: obsConfig.tlsRejectUnauthorized,
      ...(obsConfig.ca ? { ca: obsConfig.ca } : {}),
    }, onResponse)
  }

  const proxyTarget = parseHttpProxyUrl(obsConfig.uploadProxy)
  if (!proxyTarget) throw new Error('OBS upload proxy must be a valid http:// URL.')

  return http.request({
    host: proxyTarget.host,
    port: proxyTarget.port,
    method,
    path: buildObsAbsoluteUrl({ obsConfig, bucketHost, path }),
    headers,
  }, onResponse)
}

const proxyObsUpload = async ({ bucket, bucketHost, encodedObjectPath, contentType, body, obsConfig }) => {
  const canonicalResource = buildObsCanonicalResource({ bucket, encodedObjectPath })
  const signedHeaders = createObsAuthorizationHeader({
    accessKeyId: obsConfig.accessKeyId,
    secretAccessKey: obsConfig.secretAccessKey,
    method: 'PUT',
    contentType,
    canonicalResource,
  })

  const requestHeaders = {
    host: bucketHost,
    date: signedHeaders.date,
    'content-type': contentType,
    'content-length': String(body.length),
    authorization: signedHeaders.authorization,
  }
  const requestPath = buildObsRequestPath(encodedObjectPath)

  return new Promise((resolve, reject) => {
    const upstreamRequest = createObsUpstreamRequest({
      obsConfig,
      bucketHost,
      method: 'PUT',
      path: requestPath,
      headers: requestHeaders,
      onResponse: async (upstreamResponse) => {
        try {
          const responseBody = await readNodeResponseBody(upstreamResponse)
          resolve({ statusCode: upstreamResponse.statusCode ?? 502, headers: upstreamResponse.headers, body: responseBody })
        } catch (error) {
          reject(error)
        }
      },
    })
    upstreamRequest.on('error', reject)
    upstreamRequest.end(body)
  })
}

const proxyObsRequest = async ({ bucket, bucketHost, method, path, encodedObjectPath = '', canonicalQuery = {}, contentType = '', body, obsConfig }) => {
  const canonicalResource = buildObsCanonicalizedResource({ bucket, encodedObjectPath, query: canonicalQuery })
  const signedHeaders = createObsAuthorizationHeader({
    accessKeyId: obsConfig.accessKeyId,
    secretAccessKey: obsConfig.secretAccessKey,
    method,
    contentType,
    canonicalResource,
  })

  const requestHeaders = {
    host: bucketHost,
    date: signedHeaders.date,
    authorization: signedHeaders.authorization,
  }
  if (contentType) requestHeaders['content-type'] = contentType
  if (body) requestHeaders['content-length'] = String(body.length)

  return new Promise((resolve, reject) => {
    const upstreamRequest = createObsUpstreamRequest({
      obsConfig,
      bucketHost,
      method,
      path,
      headers: requestHeaders,
      onResponse: async (upstreamResponse) => {
        try {
          const responseBody = await readNodeResponseBody(upstreamResponse)
          resolve({ statusCode: upstreamResponse.statusCode ?? 502, headers: upstreamResponse.headers, body: responseBody })
        } catch (error) {
          reject(error)
        }
      },
    })
    upstreamRequest.on('error', reject)
    if (body) {
      upstreamRequest.end(body)
      return
    }
    upstreamRequest.end()
  })
}

export const registerObsRoutes = (app, obsConfig) => {
  app.put('/obs/:bucket/*', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const params = request.params && typeof request.params === 'object' ? request.params : {}
    const bucket = String(params.bucket ?? '').trim()
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const encodedObjectPath = getObsObjectPathFromRawUrl({ rawUrl: request.raw.url, bucket })
    const objectKey = decodeObsObjectPath(encodedObjectPath)
    const objectKeyError = validateObsObjectKey(objectKey)
    if (objectKeyError) return reply.code(400).send({ message: objectKeyError })

    const rawBody = normalizeRawUploadBody(request.body)
    if (!rawBody) return reply.code(400).send({ message: 'Upload body is required.' })

    const contentType = getHeaderValue(request.headers, 'content-type') || 'application/octet-stream'
    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })

    try {
      const upstreamResponse = await proxyObsUpload({ bucket, bucketHost, encodedObjectPath, contentType, body: rawBody, obsConfig })
      const upstreamContentType = Array.isArray(upstreamResponse.headers['content-type'])
        ? upstreamResponse.headers['content-type'][0]
        : upstreamResponse.headers['content-type']
      if (upstreamContentType) reply.header('content-type', upstreamContentType)
      ;['etag', 'x-obs-request-id', 'x-obs-id-2'].forEach((headerName) => {
        const headerValue = upstreamResponse.headers[headerName]
        const normalizedValue = Array.isArray(headerValue) ? headerValue[0] : headerValue
        if (normalizedValue) reply.header(headerName, normalizedValue)
      })
      reply.code(upstreamResponse.statusCode).send(upstreamResponse.body)
    } catch (error) {
      request.log.error({ err: error }, 'obs upload proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS upload request failed.' })
    }
  })

  app.get('/obs/objects', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const bucket = String(request.query?.bucket ?? '').trim()
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })
    const rawQuery = request.query && typeof request.query === 'object' ? request.query : {}
    const requestPath = buildObsListPath(rawQuery)
    const parsedQuery = parseQueryString(requestPath.split('?', 2)[1] ?? '')
    const canonicalQuery = Object.fromEntries(Object.entries(parsedQuery).map(([key, value]) => [key, normalizeObsQueryValue(value)]))

    try {
      const upstreamResponse = await proxyObsRequest({ bucket, bucketHost, method: 'GET', path: requestPath, canonicalQuery, obsConfig })
      const xmlText = upstreamResponse.body.toString('utf-8')
      if (upstreamResponse.statusCode >= 400) return reply.code(upstreamResponse.statusCode).send({ message: xmlText || 'OBS list request failed.' })
      reply.send({ bucket, prefix: normalizeObsQueryValue(rawQuery.prefix).replace(/\/+$/, ''), ...parseObsXmlObjectList(xmlText) })
    } catch (error) {
      request.log.error({ err: error }, 'obs object list proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS object list request failed.' })
    }
  })

  app.get('/obs/objects/*', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const bucket = String(request.query?.bucket ?? '').trim()
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const encodedObjectPath = String(request.params?.['*'] ?? '')
    const objectKey = decodeObsObjectPath(encodedObjectPath)
    const objectKeyError = validateObsObjectKey(objectKey)
    if (objectKeyError) return reply.code(400).send({ message: objectKeyError })

    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })

    try {
      const upstreamResponse = await proxyObsRequest({ bucket, bucketHost, method: 'HEAD', path: buildObsObjectOperationPath(encodedObjectPath), encodedObjectPath, obsConfig })
      if (upstreamResponse.statusCode >= 400) return reply.code(upstreamResponse.statusCode).send({ message: upstreamResponse.body.toString('utf-8') || 'OBS object detail request failed.' })
      reply.send({
        bucket,
        object: {
          key: objectKey,
          size: normalizeObsQueryValue(upstreamResponse.headers['content-length']) || '0',
          contentType: normalizeObsQueryValue(upstreamResponse.headers['content-type']),
          lastModified: normalizeObsQueryValue(upstreamResponse.headers['last-modified']),
          etag: normalizeObsQueryValue(upstreamResponse.headers.etag),
          metadata: buildObsMetadataRecord(upstreamResponse.headers),
        },
      })
    } catch (error) {
      request.log.error({ err: error }, 'obs object detail proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS object detail request failed.' })
    }
  })

  app.get('/obs/object-content/*', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const bucket = String(request.query?.bucket ?? '').trim()
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const encodedObjectPath = String(request.params?.['*'] ?? '')
    const objectKey = decodeObsObjectPath(encodedObjectPath)
    const objectKeyError = validateObsObjectKey(objectKey)
    if (objectKeyError) return reply.code(400).send({ message: objectKeyError })

    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })

    try {
      const upstreamResponse = await proxyObsRequest({ bucket, bucketHost, method: 'GET', path: buildObsObjectOperationPath(encodedObjectPath), encodedObjectPath, obsConfig })
      if (upstreamResponse.statusCode >= 400) return reply.code(upstreamResponse.statusCode).send({ message: upstreamResponse.body.toString('utf-8') || 'OBS object content request failed.' })
      const contentType = normalizeObsQueryValue(upstreamResponse.headers['content-type'])
      if (contentType) reply.header('content-type', contentType)
      ;['content-length', 'etag', 'last-modified', 'cache-control'].forEach((headerName) => {
        const headerValue = normalizeObsQueryValue(upstreamResponse.headers[headerName])
        if (headerValue) reply.header(headerName, headerValue)
      })
      reply.code(upstreamResponse.statusCode).send(upstreamResponse.body)
    } catch (error) {
      request.log.error({ err: error }, 'obs object content proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS object content request failed.' })
    }
  })

  app.post('/obs/objects', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const bucket = String(request.query?.bucket ?? '').trim()
    const contentType = getHeaderValue(request.headers, 'content-type') || 'application/octet-stream'
    const multipartPayload = contentType.toLowerCase().startsWith('multipart/form-data')
      ? parseMultipartUpload({ body: normalizeRawUploadBody(request.body), contentType })
      : null
    const objectKey = decodeObsQueryValue(request.query?.key) || multipartPayload?.objectKey?.trim() || multipartPayload?.fileName?.trim() || ''
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const objectKeyError = validateObsObjectKey(objectKey)
    if (objectKeyError) return reply.code(400).send({ message: objectKeyError })

    const rawBody = multipartPayload?.fileBuffer ?? normalizeRawUploadBody(request.body)
    if (!rawBody) return reply.code(400).send({ message: 'Upload body is required.' })

    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })
    const encodedObjectPath = objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    const uploadContentType = multipartPayload?.fileContentType || contentType

    try {
      const upstreamResponse = await proxyObsUpload({ bucket, bucketHost, encodedObjectPath, contentType: uploadContentType, body: rawBody, obsConfig })
      if (upstreamResponse.statusCode >= 400) return reply.code(upstreamResponse.statusCode).send({ message: upstreamResponse.body.toString('utf-8') || 'OBS upload request failed.' })
      reply.code(200).send({
        bucket,
        key: objectKey,
        etag: normalizeObsQueryValue(upstreamResponse.headers.etag),
        requestId: normalizeObsQueryValue(upstreamResponse.headers['x-obs-request-id']),
      })
    } catch (error) {
      request.log.error({ err: error }, 'obs object create proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS upload request failed.' })
    }
  })

  app.delete('/obs/objects/*', async (request, reply) => {
    const configError = getObsConfigError(obsConfig)
    if (configError) return reply.code(500).send({ message: configError })

    const bucket = String(request.query?.bucket ?? '').trim()
    const bucketError = validateObsBucketName(bucket)
    if (bucketError) return reply.code(400).send({ message: bucketError })

    const encodedObjectPath = String(request.params?.['*'] ?? '')
    const objectKey = decodeObsObjectPath(encodedObjectPath)
    const objectKeyError = validateObsObjectKey(objectKey)
    if (objectKeyError) return reply.code(400).send({ message: objectKeyError })

    const bucketHost = buildObsBucketHost({ bucket, endpointHost: obsConfig.endpointHost })

    try {
      const upstreamResponse = await proxyObsRequest({ bucket, bucketHost, method: 'DELETE', path: buildObsObjectOperationPath(encodedObjectPath), encodedObjectPath, obsConfig })
      if (upstreamResponse.statusCode >= 400) return reply.code(upstreamResponse.statusCode).send({ message: upstreamResponse.body.toString('utf-8') || 'OBS delete request failed.' })
      reply.send({ bucket, key: objectKey, success: true })
    } catch (error) {
      request.log.error({ err: error }, 'obs object delete proxy failed')
      reply.code(502).send({ message: error instanceof Error ? error.message : 'OBS delete request failed.' })
    }
  })
}
