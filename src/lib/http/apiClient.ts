import axios, { AxiosHeaders } from 'axios'
import { API_BASE } from '../../features/koko/constants'
import { getAppConfig } from '../appConfig'
import { getJmsSessionCredentials, handleUnauthorized } from './authTokenStore'
import { normalizeError } from './normalizeError'

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

apiClient.interceptors.request.use((config) => {
  const headers = AxiosHeaders.from(config.headers)
  const orgId = getAppConfig()?.orgId
  if (orgId) headers.set('X-JMS-ORG', orgId)
  const csrfToken = getJmsSessionCredentials().csrfToken
  if (csrfToken) headers.set('X-CSRFToken', csrfToken)

  config.headers = headers
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      handleUnauthorized()
    }

    return Promise.reject(normalizeError(error))
  },
)
