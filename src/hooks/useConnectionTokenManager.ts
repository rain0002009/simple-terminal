import { useEffect, useRef, useState } from 'react'
import { useMemoizedFn } from 'ahooks'
import type { AssetOption, ConnectMethodRecord } from '../features/koko/types'
import { buildSocketUrl } from '../features/koko/utils'
import { getAssetConnectionDefaults, getMyFavoriteGrantedAssets, getMyGrantedAssets } from '../lib/api/assets'
import { getConnectMethods } from '../lib/api/connectMethods'
import { createConnectionToken } from '../lib/api/connectionTokens'
import { addFavoriteAsset, getFavoriteAssets, removeFavoriteAsset } from '../lib/api/favoriteAssets'
import { normalizeErrorMessage } from '../lib/http/normalizeError'

type UseConnectionTokenManagerOptions = {
  authToken: string
}

type UseConnectionTokenManagerResult = {
  assetOptions: AssetOption[]
  favoriteAssetOptions: AssetOption[]
  favoriteAssetIds: string[]
  selectedAssetId: string
  setSelectedAssetId: (id: string) => void
  assetsLoading: boolean
  assetsError: string
  favoriteAssetsLoading: boolean
  favoriteActionAssetId: string
  favoriteActionError: string
  isConnecting: boolean
  tokenActionError: string
  clearTokenActionError: () => void
  toggleFavoriteAsset: (assetId: string) => Promise<void>
  createTokenAndConnect: (assetId: string) => Promise<string | null>
}

export const useConnectionTokenManager = ({
  authToken,
}: UseConnectionTokenManagerOptions): UseConnectionTokenManagerResult => {
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([])
  const [favoriteAssetOptions, setFavoriteAssetOptions] = useState<AssetOption[]>([])
  const [favoriteRecordIdsByAssetId, setFavoriteRecordIdsByAssetId] = useState<Record<string, string>>({})
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState('')
  const [favoriteAssetsLoading, setFavoriteAssetsLoading] = useState(false)
  const [favoriteActionAssetId, setFavoriteActionAssetId] = useState('')
  const [favoriteActionError, setFavoriteActionError] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [tokenActionError, setTokenActionError] = useState('')
  const connectMethodsRef = useRef<ConnectMethodRecord[]>([])

  const favoriteAssetIds = Array.from(
    new Set([
      ...Object.keys(favoriteRecordIdsByAssetId),
      ...favoriteAssetOptions.map((item) => item.value),
    ]),
  )

  useEffect(() => {
    if (!authToken) {
      setAssetOptions([])
      setFavoriteAssetOptions([])
      setFavoriteRecordIdsByAssetId({})
      setSelectedAssetId('')
      setAssetsError('')
      setFavoriteActionError('')
      setTokenActionError('')
      connectMethodsRef.current = []
      return
    }

    setAssetsLoading(true)
    void getMyGrantedAssets()
      .then((assets) => {
        setAssetsError('')
        setAssetOptions(assets)
        setSelectedAssetId((current) => {
          if (assets.some((item) => item.value === current)) return current
          return assets[0]?.value ?? ''
        })
      })
      .catch((error: unknown) => {
        setAssetsError(normalizeErrorMessage(error))
      })
      .finally(() => setAssetsLoading(false))

    setFavoriteAssetsLoading(true)
    void Promise.allSettled([getFavoriteAssets(), getMyFavoriteGrantedAssets()])
      .then(([favoriteRecordsResult, favoriteAssetsResult]) => {
        const errorMessages: string[] = []

        if (favoriteRecordsResult.status === 'fulfilled') {
          setFavoriteRecordIdsByAssetId(
            Object.fromEntries(favoriteRecordsResult.value.map((item) => [item.assetId, item.id])),
          )
        } else {
          errorMessages.push(normalizeErrorMessage(favoriteRecordsResult.reason))
        }

        if (favoriteAssetsResult.status === 'fulfilled') {
          setFavoriteAssetOptions(favoriteAssetsResult.value)
        } else {
          setFavoriteAssetOptions([])
          errorMessages.push(normalizeErrorMessage(favoriteAssetsResult.reason))
        }

        setFavoriteActionError(errorMessages.join('；'))
      })
      .finally(() => setFavoriteAssetsLoading(false))

    void getConnectMethods()
      .then((methods) => {
        connectMethodsRef.current = methods
      })
      .catch(() => {
        // connect methods 非关键数据，缓存失败不影响连接
      })
  }, [authToken])

  const toggleFavoriteAsset = useMemoizedFn(async (assetId: string): Promise<void> => {
    if (!authToken) {
      setFavoriteActionError('请先配置 jms_sessionid 后再收藏资产。')
      return
    }

    if (!assetId || favoriteActionAssetId) return

    setFavoriteActionAssetId(assetId)
    setFavoriteActionError('')

    try {
      const favoriteId = favoriteRecordIdsByAssetId[assetId]
      if (favoriteId) {
        await removeFavoriteAsset(assetId)
        setFavoriteRecordIdsByAssetId((current) => {
          const next = { ...current }
          delete next[assetId]
          return next
        })
        setFavoriteAssetOptions((current) => current.filter((item) => item.value !== assetId))
        return
      }

      if (favoriteAssetOptions.some((item) => item.value === assetId)) {
        const favorites = await getFavoriteAssets()
        const matchedFavorite = favorites.find((item) => item.assetId === assetId)
        if (matchedFavorite) {
          await removeFavoriteAsset(assetId)
          setFavoriteRecordIdsByAssetId((current) => {
            const next = { ...current }
            delete next[assetId]
            return next
          })
          setFavoriteAssetOptions((current) => current.filter((item) => item.value !== assetId))
          return
        }

        setFavoriteActionError('未找到当前资产对应的收藏记录，无法取消收藏。')
        return
      }

      const created = await addFavoriteAsset(assetId)
      setFavoriteRecordIdsByAssetId((current) => ({
        ...current,
        [created.assetId]: created.id,
      }))
      setFavoriteAssetOptions((current) => {
        if (current.some((item) => item.value === created.assetId)) return current

        const createdAssetOption = assetOptions.find((item) => item.value === created.assetId)
        return createdAssetOption ? [...current, createdAssetOption] : current
      })
    } catch (error) {
      setFavoriteActionError(normalizeErrorMessage(error))
    } finally {
      setFavoriteActionAssetId('')
    }
  })

  const createTokenAndConnect = useMemoizedFn(async (assetId: string): Promise<string | null> => {
    if (!authToken) {
      setTokenActionError('请先配置 jms_sessionid 后再连接。')
      return null
    }

    setIsConnecting(true)
    setTokenActionError('')

    try {
      const defaults = await getAssetConnectionDefaults(assetId, connectMethodsRef.current)
      const created = await createConnectionToken(defaults)

      if (!created) {
        setTokenActionError('创建连接令牌失败。')
        return null
      }

      return buildSocketUrl(created.tokenId)
    } catch (error) {
      setTokenActionError(normalizeErrorMessage(error))
      return null
    } finally {
      setIsConnecting(false)
    }
  })

  const clearTokenActionError = useMemoizedFn(() => {
    setTokenActionError('')
  })

  return {
    assetOptions,
    favoriteAssetOptions,
    favoriteAssetIds,
    selectedAssetId,
    setSelectedAssetId,
    assetsLoading,
    assetsError,
    favoriteAssetsLoading,
    favoriteActionAssetId,
    favoriteActionError,
    isConnecting,
    tokenActionError,
    clearTokenActionError,
    toggleFavoriteAsset,
    createTokenAndConnect,
  }
}
