import axios from 'axios'
import { safeString } from '../../features/koko/utils'

const extractMessage = (payload: unknown): string => {
  if (typeof payload === 'string' && payload.trim()) return payload
  if (payload && typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>
    const detail = [candidate.detail, candidate.msg, candidate.message, candidate.error].find(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
    if (detail) return detail
  }
  return safeString(payload)
}

export const normalizeErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = extractMessage(error.response?.data)
    if (detail) return detail
    return error.message || '请求失败，请稍后重试。'
  }
  if (error instanceof Error) return error.message
  return safeString(error) || '请求失败，请稍后重试。'
}

export const normalizeError = (error: unknown): Error => {
  if (error instanceof Error && !axios.isAxiosError(error)) return error
  return new Error(normalizeErrorMessage(error))
}
