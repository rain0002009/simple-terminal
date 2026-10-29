import { fetch } from 'undici'

const normalizeAiBaseUrl = (value) => String(value ?? '').trim().replace(/\/+$/, '')

const parseProxyResponsePayload = async (response) => {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const normalizeModelListPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return []

  const { data } = payload
  if (!Array.isArray(data)) return []

  return Array.from(
    new Set(
      data
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          return typeof item.id === 'string' ? item.id.trim() : ''
        })
        .filter((item) => item.length > 0),
    ),
  )
}

export const registerAiRoutes = (app) => {
  app.post('/ai/chat/completions', async (request, reply) => {
    const normalizedBody = request.body && typeof request.body === 'object' ? request.body : {}

    const baseUrl = normalizeAiBaseUrl(normalizedBody.baseUrl)
    const apiKey = String(normalizedBody.apiKey ?? '').trim()
    const model = String(normalizedBody.model ?? '').trim()
    const messages = Array.isArray(normalizedBody.messages) ? normalizedBody.messages : []
    const temperature = typeof normalizedBody.temperature === 'number' ? normalizedBody.temperature : undefined

    if (!baseUrl || !apiKey || !model || messages.length === 0) {
      reply.code(400).send({
        message: 'baseUrl, apiKey, model and messages are required.',
      })
      return
    }

    let upstreamUrl
    try {
      upstreamUrl = new URL('chat/completions', `${baseUrl}/`).toString()
    } catch {
      reply.code(400).send({ message: 'Invalid AI baseUrl.' })
      return
    }

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          messages,
        }),
      })

      const payload = await parseProxyResponsePayload(upstreamResponse)
      const contentType = upstreamResponse.headers.get('content-type')
      if (contentType) reply.header('content-type', contentType)
      reply.code(upstreamResponse.status).send(payload)
    } catch (error) {
      request.log.error({ err: error }, 'ai chat completion proxy failed')
      reply.code(502).send({
        message: error instanceof Error ? error.message : 'AI upstream request failed.',
      })
    }
  })

  app.post('/ai/models', async (request, reply) => {
    const normalizedBody = request.body && typeof request.body === 'object' ? request.body : {}

    const baseUrl = normalizeAiBaseUrl(normalizedBody.baseUrl)
    const apiKey = String(normalizedBody.apiKey ?? '').trim()

    if (!baseUrl || !apiKey) {
      reply.code(400).send({
        message: 'baseUrl and apiKey are required.',
      })
      return
    }

    let upstreamUrl
    try {
      upstreamUrl = new URL('models', `${baseUrl}/`).toString()
    } catch {
      reply.code(400).send({ message: 'Invalid AI baseUrl.' })
      return
    }

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      const payload = await parseProxyResponsePayload(upstreamResponse)
      if (!upstreamResponse.ok) {
        const contentType = upstreamResponse.headers.get('content-type')
        if (contentType) reply.header('content-type', contentType)
        reply.code(upstreamResponse.status).send(payload)
        return
      }

      reply.send({
        models: normalizeModelListPayload(payload),
      })
    } catch (error) {
      request.log.error({ err: error }, 'ai models proxy failed')
      reply.code(502).send({
        message: error instanceof Error ? error.message : 'AI upstream request failed.',
      })
    }
  })
}
