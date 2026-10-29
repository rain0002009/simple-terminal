import { useEffect } from 'react'
import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import {
  ACCESS_KEY_ID_COOKIE_NAME,
  ACCESS_KEY_SECRET_COOKIE_NAME,
  ACCESS_KEY_SETTINGS_STORAGE_KEY,
} from '../features/koko/constants'

type AccessKeySettings = {
  accessKeyId: string
  accessKeySecret: string
}

type UseAccessKeySettingsResult = {
  accessKeySettings: AccessKeySettings
  accessKeyConfigured: boolean
  updateAccessKeySettings: (settings: AccessKeySettings) => void
  clearAccessKeySettings: () => void
}

const createDefaultAccessKeySettings = (): AccessKeySettings => ({
  accessKeyId: '',
  accessKeySecret: '',
})

const writeCookie = (name: string, value: string) => {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${secure}`
}

const clearCookie = (name: string) => {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}

export const useAccessKeySettings = (): UseAccessKeySettingsResult => {
  const [accessKeySettings = createDefaultAccessKeySettings(), setAccessKeySettings] =
    useLocalStorageState<AccessKeySettings>(ACCESS_KEY_SETTINGS_STORAGE_KEY, {
      defaultValue: createDefaultAccessKeySettings(),
    })

  useEffect(() => {
    const accessKeyId = accessKeySettings.accessKeyId.trim()
    const accessKeySecret = accessKeySettings.accessKeySecret.trim()

    if (accessKeyId && accessKeySecret) {
      writeCookie(ACCESS_KEY_ID_COOKIE_NAME, accessKeyId)
      writeCookie(ACCESS_KEY_SECRET_COOKIE_NAME, accessKeySecret)
      return
    }

    clearCookie(ACCESS_KEY_ID_COOKIE_NAME)
    clearCookie(ACCESS_KEY_SECRET_COOKIE_NAME)
  }, [accessKeySettings.accessKeyId, accessKeySettings.accessKeySecret])

  const updateAccessKeySettings = useMemoizedFn((settings: AccessKeySettings) => {
    setAccessKeySettings({
      accessKeyId: settings.accessKeyId.trim(),
      accessKeySecret: settings.accessKeySecret.trim(),
    })
  })

  const clearAccessKeySettings = useMemoizedFn(() => {
    setAccessKeySettings(createDefaultAccessKeySettings())
  })

  return {
    accessKeySettings,
    accessKeyConfigured: Boolean(accessKeySettings.accessKeyId && accessKeySettings.accessKeySecret),
    updateAccessKeySettings,
    clearAccessKeySettings,
  }
}
