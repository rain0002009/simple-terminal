import type {
  AssetConnectionDefaults,
  ConnectionTokenApiRecord,
  ConnectionTokenRecord,
  PaginatedResponse,
} from '../../features/koko/types'
import { mapConnectionTokenRecord } from '../../features/koko/utils'
import { apiClient } from '../http/apiClient'

export const getConnectionTokens = async (): Promise<ConnectionTokenRecord[]> => {
  const response = await apiClient.get<PaginatedResponse<ConnectionTokenApiRecord>>(
    '/authentication/connection-token/',
    {
      params: { limit: 30 },
    },
  )

  return (response.data?.results ?? [])
    .map(mapConnectionTokenRecord)
    .filter((item): item is ConnectionTokenRecord => item !== null)
    .filter((item) => item.isValid)
}

export const createConnectionToken = async (
  defaults: AssetConnectionDefaults,
): Promise<ConnectionTokenRecord | null> => {
  const response = await apiClient.post<ConnectionTokenApiRecord>('/authentication/connection-token/', {
    asset: defaults.assetId,
    account: defaults.account,
    protocol: defaults.protocol,
    input_username: defaults.inputUsername,
    input_secret: '',
    connect_method: defaults.connectMethod,
    connect_options: {
      charset: 'default',
      disableautohash: false,
      token_reusable: false,
      resolution: 'auto',
      backspaceAsCtrlH: false,
      appletConnectMethod: 'web',
      virtualappConnectMethod: 'web',
      reusable: false,
      rdp_connection_speed: 'auto',
    },
  })

  return response.data ? mapConnectionTokenRecord(response.data) : null
}
