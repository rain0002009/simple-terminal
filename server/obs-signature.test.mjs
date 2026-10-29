import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildObsBucketHost,
  buildObsCanonicalResource,
  buildObsCanonicalizedResource,
  buildObsRequestPath,
  buildObsVirtualHostedUrl,
  createObsAuthorizationHeader,
  decodeObsObjectPath,
  validateObsBucketName,
  validateObsObjectKey,
} from './obs-signature.mjs'

test('builds bucket host with bucket as virtual-host prefix', () => {
  assert.equal(
    buildObsBucketHost({ bucket: 'yizhan', endpointHost: 'obs.example.com' }),
    'yizhan.obs.example.com',
  )
})

test('builds virtual-host request path from object key', () => {
  assert.equal(buildObsRequestPath('deploy/pkg%20name.tar.gz'), '/deploy/pkg%20name.tar.gz')
})

test('builds canonical OBS resource with bucket in path', () => {
  assert.equal(buildObsCanonicalResource({ bucket: 'yizhan', encodedObjectPath: 'deploy/demo.tar.gz' }), '/yizhan/deploy/demo.tar.gz')
})

test('builds canonical OBS resource with sorted sub-resources', () => {
  assert.equal(
    buildObsCanonicalizedResource({
      bucket: 'yizhan',
      encodedObjectPath: '',
      query: {
        uploads: '',
        position: '10',
        ignored: 'value',
      },
    }),
    '/yizhan/?position=10&uploads',
  )
})

test('builds proxy absolute url with encoded object path', () => {
  assert.equal(
    buildObsVirtualHostedUrl({
      scheme: 'http',
      bucketHost: 'yizhan.obs.example.com',
      encodedObjectPath: 'deploy/pkg%20name.tar.gz',
      port: 80,
    }),
    'http://yizhan.obs.example.com/deploy/pkg%20name.tar.gz',
  )
})

test('decodes encoded object path for validation', () => {
  assert.equal(decodeObsObjectPath('deploy/pkg%20name.tar.gz'), 'deploy/pkg name.tar.gz')
})

test('creates deterministic OBS authorization header', () => {
  const result = createObsAuthorizationHeader({
    accessKeyId: 'demo-ak',
    secretAccessKey: 'demo-sk',
    method: 'PUT',
    contentType: 'application/gzip',
    date: 'Mon, 29 Jun 2026 10:00:00 GMT',
    canonicalResource: '/yizhan/deploy/demo.tar.gz',
  })

  assert.equal(result.signingString, 'PUT\n\napplication/gzip\nMon, 29 Jun 2026 10:00:00 GMT\n/yizhan/deploy/demo.tar.gz')
  assert.equal(result.authorization, 'OBS demo-ak:ua3GwSHd+3sLwU2o59ZIY4dnpDM=')
})

test('validates bucket and object key inputs', () => {
  assert.equal(validateObsBucketName('yizhan'), '')
  assert.match(validateObsBucketName('Bad_Bucket'), /Bucket name/)
  assert.equal(validateObsObjectKey('deploy/demo.tar.gz'), '')
  assert.equal(validateObsObjectKey('deploy/pkg name.tar.gz'), '')
  assert.match(validateObsObjectKey('../demo.tar.gz'), /parent-directory/)
})
