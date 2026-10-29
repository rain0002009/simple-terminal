import type {
  AssetConnectionDefaults,
  AssetGranted,
  AssetOption,
  AssetPermedDetail,
  ConnectMethodRecord,
  PaginatedResponse,
} from '../../features/koko/types'
import { buildAssetConnectionDefaults, buildAssetOption } from '../../features/koko/utils'
import { apiClient } from '../http/apiClient'

export const getGrantedAssets = async (): Promise<AssetOption[]> => {
  return getMyGrantedAssets()
}

export const getMyGrantedAssets = async (): Promise<AssetOption[]> => {
  const response = await apiClient.get<PaginatedResponse<AssetGranted>>('/perms/users/self/assets/', {
    params: { limit: 100 },
  })
  return (response.data?.results ?? [])
    .map(buildAssetOption)
    .filter((item): item is AssetOption => item !== null)
}

export const getMyFavoriteGrantedAssets = async (): Promise<AssetOption[]> => {
  const response = await apiClient.get<PaginatedResponse<AssetGranted>>(
    '/perms/users/self/nodes/favorite/assets/',
    {
      params: { limit: 500 },
    },
  )
  return (response.data?.results ?? [])
    .map(buildAssetOption)
    .filter((item): item is AssetOption => item !== null)
}

export const getMyGrantedAssetDetail = async (assetId: string): Promise<AssetPermedDetail> => {
  const response = await apiClient.get<AssetPermedDetail>(
    `/perms/users/self/assets/${encodeURIComponent(assetId)}/`,
  )
  return response.data ?? {}
}

export const getAssetConnectionDefaults = async (
  assetId: string,
  connectMethods: ConnectMethodRecord[],
): Promise<AssetConnectionDefaults> => {
  const detail = await getMyGrantedAssetDetail(assetId)
  return buildAssetConnectionDefaults(detail, connectMethods)
}
