import assert from 'node:assert/strict'
import test from 'node:test'
import { createObsConfig } from './obs-routes.mjs'

const OBS_ENV_NAMES = [
  'OBS_SCHEME',
  'OBS_PORT',
  'OBS_UPLOAD_PROXY',
  'OBS_CA_FILE',
  'OBS_TLS_REJECT_UNAUTHORIZED',
]

const withCleanObsEnvironment = (callback) => {
  const originalValues = Object.fromEntries(OBS_ENV_NAMES.map((name) => [name, process.env[name]]))
  OBS_ENV_NAMES.forEach((name) => delete process.env[name])

  try {
    callback()
  } finally {
    OBS_ENV_NAMES.forEach((name) => {
      const originalValue = originalValues[name]
      if (originalValue === undefined) {
        delete process.env[name]
        return
      }
      process.env[name] = originalValue
    })
  }
}

test('defaults OBS requests to HTTPS through a CONNECT proxy agent', () => {
  withCleanObsEnvironment(() => {
    const config = createObsConfig({ upstreamProxy: 'http://proxy.example.com:8080' })

    assert.equal(config.scheme, 'https')
    assert.equal(config.port, 443)
    assert.equal(config.uploadProxy, 'http://proxy.example.com:8080')
    assert.equal(config.httpsProxyAgent?.constructor?.name, 'HttpsProxyAgent')
    assert.equal(config.tlsRejectUnauthorized, false)
    assert.equal(config.configError, '')
  })
})

test('supports strict OBS TLS verification and reports invalid boolean settings', () => {
  withCleanObsEnvironment(() => {
    process.env.OBS_TLS_REJECT_UNAUTHORIZED = 'true'
    const strictConfig = createObsConfig({ upstreamProxy: 'http://proxy.example.com:8080' })
    assert.equal(strictConfig.tlsRejectUnauthorized, true)
    assert.equal(strictConfig.configError, '')

    process.env.OBS_TLS_REJECT_UNAUTHORIZED = 'sometimes'
    const invalidConfig = createObsConfig({ upstreamProxy: 'http://proxy.example.com:8080' })
    assert.match(invalidConfig.configError, /must be true or false/)
  })
})
