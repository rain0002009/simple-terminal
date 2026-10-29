import crypto from 'node:crypto'

const OBS_AUTH_SCHEME = 'OBS'
const OBS_BUCKET_NAME_PATTERN = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

export const formatObsHttpDate = (date = new Date()) => date.toUTCString()

export const buildObsBucketHost = ({ bucket, endpointHost }) => `${bucket}.${endpointHost}`

export const buildObsRequestPath = (encodedObjectPath) => `/${encodedObjectPath}`

export const buildObsCanonicalResource = ({ bucket, encodedObjectPath }) => `/${bucket}/${encodedObjectPath}`

const OBS_SUB_RESOURCES = new Set([
  'CDNNotifyConfiguration',
  'acl',
  'append',
  'attname',
  'backtosource',
  'cors',
  'customdomain',
  'delete',
  'deletebucket',
  'directcoldaccess',
  'encryption',
  'inventory',
  'length',
  'lifecycle',
  'location',
  'logging',
  'metadata',
  'modify',
  'name',
  'notification',
  'object-lock',
  'partNumber',
  'policy',
  'position',
  'quota',
  'rename',
  'replication',
  'response-cache-control',
  'response-content-disposition',
  'response-content-encoding',
  'response-content-language',
  'response-content-type',
  'response-expires',
  'restore',
  'retention',
  'storageClass',
  'storagePolicy',
  'storageinfo',
  'tagging',
  'torrent',
  'truncate',
  'uploadId',
  'uploads',
  'versionId',
  'versioning',
  'versions',
  'website',
  'x-image-process',
  'x-image-save-bucket',
  'x-image-save-object',
  'x-obs-security-token',
])

export const buildObsVirtualHostedUrl = ({ scheme, bucketHost, encodedObjectPath, port }) => {
  const pathname = buildObsRequestPath(encodedObjectPath)
  const isDefaultPort = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443)
  const authority = isDefaultPort ? bucketHost : `${bucketHost}:${port}`

  return `${scheme}://${authority}${pathname}`
}

export const decodeObsObjectPath = (encodedObjectPath) => encodedObjectPath.split('/').map((segment) => decodeURIComponent(segment)).join('/')

export const buildObsCanonicalizedResource = ({
  bucket,
  encodedObjectPath = '',
  query = {},
}) => {
  const base = buildObsCanonicalResource({ bucket, encodedObjectPath })
  const canonicalEntries = Object.entries(query)
    .filter(([key]) => OBS_SUB_RESOURCES.has(key))
    .sort(([left], [right]) => left.localeCompare(right, 'en'))

  if (canonicalEntries.length === 0) return base

  const queryText = canonicalEntries
    .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
    .join('&')

  return `${base}?${queryText}`
}

export const validateObsBucketName = (bucket) => {
  if (!OBS_BUCKET_NAME_PATTERN.test(bucket)) {
    return 'Bucket name must be 3-63 characters of lowercase letters, numbers, dots, or hyphens.'
  }

  if (bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.')) {
    return 'Bucket name contains an unsupported dot/hyphen combination.'
  }

  return ''
}

export const validateObsObjectKey = (objectKey) => {
  if (!objectKey) return 'Object key is required.'
  if (objectKey.startsWith('/')) return 'Object key must not start with a slash.'
  if (objectKey.split('/').some((segment) => segment === '..')) {
    return 'Object key must not contain parent-directory traversal segments.'
  }

  return ''
}

export const createObsAuthorizationHeader = ({
  accessKeyId,
  secretAccessKey,
  method,
  contentType,
  date = formatObsHttpDate(),
  canonicalResource,
}) => {
  const signingString = `${method.toUpperCase()}\n\n${contentType}\n${date}\n${canonicalResource}`
  const signature = crypto.createHmac('sha1', secretAccessKey).update(signingString).digest('base64')

  return {
    date,
    authorization: `${OBS_AUTH_SCHEME} ${accessKeyId}:${signature}`,
    signingString,
  }
}
