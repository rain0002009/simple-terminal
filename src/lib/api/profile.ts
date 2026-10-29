import type { UserProfile } from '../../features/koko/types'
import { apiClient } from '../http/apiClient'

export const getUserProfile = async (): Promise<UserProfile> => {
  const response = await apiClient.get<UserProfile>('/users/profile/')
  return response.data ?? {}
}
