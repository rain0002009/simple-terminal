import test from 'node:test'
import assert from 'node:assert/strict'
import { signProxyHeaders } from './access-key-signature.mjs'

test('keeps existing auth headers untouched when access-key headers are absent', () => {
  const headers = {
    authorization: 'Bearer keep-me',
    date: 'Thu, 11 Jun 2026 08:00:00 GMT',
    'content-type': 'application/json',
  }

  const result = signProxyHeaders({
    headers,
    method: 'GET',
    pathWithQuery: '/api/v1/ops/job-executions/',
    orgId: 'org-id',
  })

  assert.deepEqual(result, headers)
})

test('signs job-executions requests with case-insensitive access-key headers', () => {
  const headers = {
    'X-KOKO-ACCESS-KEY-ID': 'demo-access-key',
    'X-KOKO-ACCESS-KEY-SECRET': 'demo-secret',
    Authorization: 'Bearer replace-me',
    Date: 'Thu, 11 Jun 2026 08:00:00 GMT',
    'content-type': 'application/json',
  }

  const result = signProxyHeaders({
    headers,
    method: 'POST',
    pathWithQuery: '/api/v1/ops/job-executions/?from=demo',
    orgId: 'org-id',
  })

  assert.equal(result['X-KOKO-ACCESS-KEY-ID'], undefined)
  assert.equal(result['X-KOKO-ACCESS-KEY-SECRET'], undefined)
  assert.equal(result.Authorization, undefined)
  assert.equal(result.Date, undefined)
  assert.equal(result['content-type'], 'application/json')
  assert.equal(result.accept, 'application/json')
  assert.equal(result['x-jms-org'], 'org-id')
  assert.match(
    String(result.authorization),
    /^Signature keyId="demo-access-key",algorithm="hmac-sha256",headers="\(request-target\) accept date x-jms-org",signature=".+"$/,
  )
})

test('drops raw access-key headers when signing input is incomplete', () => {
  const headers = {
    'X-KOKO-ACCESS-KEY-ID': 'demo-access-key',
    authorization: 'Bearer keep-me',
    'content-type': 'application/json',
  }

  const result = signProxyHeaders({
    headers,
    method: 'POST',
    pathWithQuery: '/api/v1/ops/job-executions/',
    orgId: 'org-id',
  })

  assert.deepEqual(result, {
    'X-KOKO-ACCESS-KEY-ID': 'demo-access-key',
    authorization: 'Bearer keep-me',
    'content-type': 'application/json',
  })
})
