import type { SmartEndpointResponse } from '../../features/koko/types'
import { apiClient } from '../http/apiClient'

export const getSmartEndpoint = async (token: string, protocol = 'https'): Promise<SmartEndpointResponse> => {
  const response = await apiClient.get<SmartEndpointResponse>('/terminal/endpoints/smart/', {
    params: { protocol, token },
  })

  return response.data ?? {}
}