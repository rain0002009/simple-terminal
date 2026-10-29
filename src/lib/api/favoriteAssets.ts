import type {
  FavoriteAssetApiRecord,
  FavoriteAssetRecord,
  PaginatedResponse,
} from '../../features/koko/types'
import { mapFavoriteAssetRecord } from '../../features/koko/utils'
import { apiClient } from '../http/apiClient'

type FavoriteAssetListResponse = PaginatedResponse<FavoriteAssetApiRecord> | FavoriteAssetApiRecord[]

const extractFavoriteAssetApiRecords = (
  response: FavoriteAssetListResponse | null | undefined,
): FavoriteAssetApiRecord[] => {
  if (!response) return []
  if (Array.isArray(response)) return response
  return response.results ?? []
}

export const getFavoriteAssets = async (): Promise<FavoriteAssetRecord[]> => {
  const response = await apiClient.get<FavoriteAssetListResponse>(
    '/assets/favorite-assets/',
    {
      params: { limit: 500 },
    },
  )

  return extractFavoriteAssetApiRecords(response.data)
    .map(mapFavoriteAssetRecord)
    .filter((item): item is FavoriteAssetRecord => item !== null)
}

export const addFavoriteAsset = async (assetId: string): Promise<FavoriteAssetRecord> => {
  const response = await apiClient.post<FavoriteAssetApiRecord>('/assets/favorite-assets/', {
    asset: assetId,
  })
  const record = response.data ? mapFavoriteAssetRecord(response.data) : null

  if (!record) throw new Error('收藏接口返回数据缺少收藏记录 ID。')
  return record
}

export const removeFavoriteAsset = async (assetId: string): Promise<void> => {
  await apiClient.delete('/assets/favorite-assets/', {
    params: { asset: assetId },
  })
}
