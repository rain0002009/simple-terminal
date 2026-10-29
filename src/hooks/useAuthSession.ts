import { useEffect, useState } from 'react'
import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import { JMS_SESSION_STORAGE_KEY } from '../features/koko/constants'
import type { JmsSessionCredentials } from '../features/koko/types'
import { getUserProfile } from '../lib/api/profile'
import {
  clearJmsSessionCredentials,
  registerUnauthorizedHandler,
  setJmsSessionCredentials,
} from '../lib/http/authTokenStore'

type LoginFormValues = {
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
}

type UseAuthSessionResult = {
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
  authToken: string
  authUserName: string
  authExpiresAt: string
  loginLoading: boolean
  authError: string
  handleLogin: (values: LoginFormValues) => Promise<boolean>
  clearAuthError: () => void
}

const buildDisplayName = (name?: string, username?: string): string => {
  const trimmedName = name?.trim()
  const trimmedUsername = username?.trim()
  if (trimmedName && trimmedUsername && trimmedName !== trimmedUsername) return `${trimmedName}（${trimmedUsername}）`
  return trimmedName || trimmedUsername || 'JumpServer 用户'
}

const parseExpiresAt = (expiresAt: string): Date | null => {
  const date = new Date(expiresAt)
  return Number.isNaN(date.getTime()) ? null : date
}

const isExpired = (expiresAt: string): boolean => {
  const date = parseExpiresAt(expiresAt)
  return !date || date.getTime() <= Date.now()
}

const formatExpiresAtDisplay = (expiresAt: string): string => {
  const date = parseExpiresAt(expiresAt)
  return date ? date.toLocaleString('zh-CN', { hour12: false }) : ''
}

export const useAuthSession = (): UseAuthSessionResult => {
  const [savedCredentials = { jmsSessionId: '', csrfToken: '', expiresAt: '' }, setSavedCredentials] = useLocalStorageState<JmsSessionCredentials>(
    JMS_SESSION_STORAGE_KEY,
    {
      defaultValue: { jmsSessionId: '', csrfToken: '', expiresAt: '' },
    },
  )
  const savedSessionId = savedCredentials.jmsSessionId ?? ''
  const savedCsrfToken = savedCredentials.csrfToken ?? ''
  const savedExpiresAt = savedCredentials.expiresAt ?? ''
  const savedIsValid = Boolean(savedSessionId && savedCsrfToken && savedExpiresAt && !isExpired(savedExpiresAt))
  const [jmsSessionId, setJmsSessionId] = useState(savedIsValid ? savedSessionId : '')
  const [csrfToken, setCsrfToken] = useState(savedIsValid ? savedCsrfToken : '')
  const [expiresAt, setExpiresAt] = useState(savedIsValid ? savedExpiresAt : '')
  const [authToken, setAuthTokenState] = useState(savedIsValid ? 'jms-session' : '')
  const [authUserName, setAuthUserName] = useState(savedIsValid ? 'jms_sessionid 已配置' : '')
  const [authExpiresAt, setAuthExpiresAt] = useState(savedIsValid ? formatExpiresAtDisplay(savedExpiresAt) : '')
  const [loginLoading, setLoginLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    setJmsSessionCredentials({ jmsSessionId, csrfToken, expiresAt })
  }, [csrfToken, expiresAt, jmsSessionId])

  useEffect(() => {
    setSavedCredentials({ jmsSessionId, csrfToken, expiresAt })
  }, [csrfToken, expiresAt, jmsSessionId, setSavedCredentials])

  useEffect(() => {
    if (!savedSessionId || savedIsValid) return
    clearJmsSessionCredentials()
    setSavedCredentials({ jmsSessionId: '', csrfToken: '', expiresAt: '' })
  }, [savedIsValid, savedSessionId, setSavedCredentials])

  const clearAuthSession = useMemoizedFn((errorMessage = '') => {
    clearJmsSessionCredentials()
    setAuthError(errorMessage)
    setAuthTokenState('')
    setAuthUserName('')
    setAuthExpiresAt('')
    setJmsSessionId('')
    setCsrfToken('')
    setExpiresAt('')
  })

  useEffect(() => registerUnauthorizedHandler(() => {
    clearAuthSession()
  }), [clearAuthSession])

  const handleLogin = useMemoizedFn(async (values: LoginFormValues): Promise<boolean> => {
    const nextJmsSessionId = values.jmsSessionId.trim()
    const nextCsrfToken = values.csrfToken.trim()
    const nextExpiresAt = values.expiresAt.trim()

    setLoginLoading(true)
    setAuthError('')

    try {
      if (!nextJmsSessionId) throw new Error('请输入 jms_sessionid。')
      if (!nextCsrfToken) throw new Error('请输入 jms_csrftoken。')
      if (isExpired(nextExpiresAt)) throw new Error('请选择晚于当前时间的失效时间。')
      setJmsSessionCredentials({ jmsSessionId: nextJmsSessionId, csrfToken: nextCsrfToken, expiresAt: nextExpiresAt })
      const profile = await getUserProfile()
      setJmsSessionId(nextJmsSessionId)
      setCsrfToken(nextCsrfToken)
      setExpiresAt(nextExpiresAt)
      setAuthTokenState('jms-session')
      setAuthUserName(buildDisplayName(profile.name, profile.username))
      setAuthExpiresAt(formatExpiresAtDisplay(nextExpiresAt))
      return true
    } catch (error) {
      clearAuthSession(error instanceof Error ? error.message : 'jms_sessionid 校验失败。')
      return false
    } finally {
      setLoginLoading(false)
    }
  })

  const clearAuthError = useMemoizedFn(() => {
    setAuthError('')
  })

  return {
    jmsSessionId,
    csrfToken,
    expiresAt,
    authToken,
    authUserName,
    authExpiresAt,
    loginLoading,
    authError,
    handleLogin,
    clearAuthError,
  }
}
