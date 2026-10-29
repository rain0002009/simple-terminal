import { CSRF_COOKIE_NAME, JMS_SESSION_COOKIE_NAME } from '../../features/koko/constants'
import type { JmsSessionCredentials } from '../../features/koko/types'

let jmsSessionCredentials: JmsSessionCredentials = { jmsSessionId: '', csrfToken: '', expiresAt: '' }
let unauthorizedHandler: (() => void) | null = null
let unauthorizedHandled = false

const writeCookie = (name: string, value: string, expiresAt: string): void => {
  if (typeof document === 'undefined') return
  const expires = new Date(expiresAt)
  if (!value || Number.isNaN(expires.getTime())) {
    clearCookie(name)
    return
  }
  const secureFlag = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Expires=${expires.toUTCString()}; SameSite=Lax${secureFlag}`
}

const clearCookie = (name: string): void => {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`
}

export const setJmsSessionCredentials = (credentials: JmsSessionCredentials): void => {
  jmsSessionCredentials = {
    jmsSessionId: credentials.jmsSessionId.trim(),
    csrfToken: credentials.csrfToken.trim(),
    expiresAt: credentials.expiresAt,
  }
  if (jmsSessionCredentials.jmsSessionId && jmsSessionCredentials.csrfToken && jmsSessionCredentials.expiresAt) {
    unauthorizedHandled = false
    writeCookie(JMS_SESSION_COOKIE_NAME, jmsSessionCredentials.jmsSessionId, jmsSessionCredentials.expiresAt)
    writeCookie(CSRF_COOKIE_NAME, jmsSessionCredentials.csrfToken, jmsSessionCredentials.expiresAt)
  } else {
    clearCookie(JMS_SESSION_COOKIE_NAME)
    clearCookie(CSRF_COOKIE_NAME)
  }
}

export const getJmsSessionCredentials = (): JmsSessionCredentials => jmsSessionCredentials

export const clearJmsSessionCredentials = (): void => {
  jmsSessionCredentials = { jmsSessionId: '', csrfToken: '', expiresAt: '' }
  clearCookie(JMS_SESSION_COOKIE_NAME)
  clearCookie(CSRF_COOKIE_NAME)
}

export const registerUnauthorizedHandler = (handler: () => void): (() => void) => {
  unauthorizedHandler = handler

  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null
    }
  }
}

export const handleUnauthorized = (): void => {
  if (unauthorizedHandled) return

  unauthorizedHandled = true
  clearJmsSessionCredentials()
  unauthorizedHandler?.()
}
