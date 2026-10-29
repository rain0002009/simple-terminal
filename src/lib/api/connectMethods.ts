import type { ConnectMethodRecord, PaginatedResponse } from '../../features/koko/types'
import { apiClient } from '../http/apiClient'

export const getConnectMethods = async (): Promise<ConnectMethodRecord[]> => {
  const response = await apiClient.get<PaginatedResponse<ConnectMethodRecord>>(
    '/terminal/components/connect-methods/',
    {
      params: { limit: 100 },
    },
  )

  return response.data?.results ?? []
}
