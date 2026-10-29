import { useEffect, useRef } from 'react'
import type { NotificationInstance } from 'antd/es/notification/interface'

type ErrorNotifications = {
  assetsError: string
  authError: string
  favoriteActionError: string
  tokenActionError: string
  terminalError: string
  notificationApi: NotificationInstance
}

export const useErrorNotifications = ({
  assetsError,
  authError,
  favoriteActionError,
  tokenActionError,
  terminalError,
  notificationApi,
}: ErrorNotifications): void => {
  const lastNotifiedErrorsRef = useRef({
    assetsError: '',
    authError: '',
    favoriteActionError: '',
    tokenActionError: '',
    terminalError: '',
  })

  useEffect(() => {
    if (!assetsError) {
      lastNotifiedErrorsRef.current.assetsError = ''
      return
    }
    if (lastNotifiedErrorsRef.current.assetsError === assetsError) return

    lastNotifiedErrorsRef.current.assetsError = assetsError
    notificationApi.error({
      key: 'assets-error',
      message: '资产加载失败',
      description: assetsError,
      placement: 'topRight',
    })
  }, [assetsError, notificationApi])

  useEffect(() => {
    if (!authError) {
      lastNotifiedErrorsRef.current.authError = ''
      return
    }
    if (lastNotifiedErrorsRef.current.authError === authError) return

    lastNotifiedErrorsRef.current.authError = authError
    notificationApi.error({
      key: 'auth-error',
      message: '认证失败',
      description: authError,
      placement: 'topRight',
    })
  }, [authError, notificationApi])

  useEffect(() => {
    if (!favoriteActionError) {
      lastNotifiedErrorsRef.current.favoriteActionError = ''
      return
    }
    if (lastNotifiedErrorsRef.current.favoriteActionError === favoriteActionError) return

    lastNotifiedErrorsRef.current.favoriteActionError = favoriteActionError
    notificationApi.error({
      key: 'favorite-action-error',
      message: '资产收藏操作失败',
      description: favoriteActionError,
      placement: 'topRight',
    })
  }, [favoriteActionError, notificationApi])

  useEffect(() => {
    if (!tokenActionError) {
      lastNotifiedErrorsRef.current.tokenActionError = ''
      return
    }
    if (lastNotifiedErrorsRef.current.tokenActionError === tokenActionError) return

    lastNotifiedErrorsRef.current.tokenActionError = tokenActionError
    notificationApi.error({
      key: 'token-action-error',
      message: '连接令牌操作失败',
      description: tokenActionError,
      placement: 'topRight',
    })
  }, [notificationApi, tokenActionError])

  useEffect(() => {
    if (!terminalError) {
      lastNotifiedErrorsRef.current.terminalError = ''
      return
    }
    if (lastNotifiedErrorsRef.current.terminalError === terminalError) return

    lastNotifiedErrorsRef.current.terminalError = terminalError
    notificationApi.error({
      key: 'terminal-error',
      message: '终端连接异常',
      description: terminalError,
      placement: 'topRight',
    })
  }, [notificationApi, terminalError])
}
