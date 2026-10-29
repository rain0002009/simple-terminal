import { useEffect } from 'react'
import { useLatest, useLocalStorageState, useMemoizedFn } from 'ahooks'
import {
  SELECTED_TOKEN_KEY,
  TOKENS_STORAGE_KEY,
} from '../features/koko/constants'
import type { SavedToken } from '../features/koko/types'

type UseSavedTokensResult = {
  savedTokens: SavedToken[]
  selectedTokenId: string
  setSelectedTokenId: (id: string) => void
  persistTokens: (tokens: SavedToken[]) => void
  upsertSavedToken: (name: string, tokenId: string) => void
  addSavedToken: (name: string, tokenId: string) => void
  deleteSavedToken: (id: string) => void
}

export const useSavedTokens = (): UseSavedTokensResult => {
  const [savedTokens = [], setSavedTokens] = useLocalStorageState<SavedToken[]>(TOKENS_STORAGE_KEY, {
    defaultValue: [],
  })

  const [selectedTokenIdState = '', setSelectedTokenIdState] = useLocalStorageState<string>(SELECTED_TOKEN_KEY, {
    defaultValue: '',
  })

  const savedTokensRef = useLatest(savedTokens)
  const selectedTokenIdRef = useLatest(selectedTokenIdState)

  useEffect(() => {
    if (!savedTokens.length) {
      if (selectedTokenIdState) setSelectedTokenIdState('')
      return
    }

    if (!savedTokens.some((token) => token.id === selectedTokenIdState)) {
      setSelectedTokenIdState(savedTokens[0]?.id ?? '')
    }
  }, [savedTokens, selectedTokenIdState, setSelectedTokenIdState])

  const setSelectedTokenId = useMemoizedFn((id: string) => {
    setSelectedTokenIdState(id)
  })

  const persistTokens = useMemoizedFn((tokens: SavedToken[]) => {
    setSavedTokens(tokens)
  })

  const upsertSavedToken = useMemoizedFn((name: string, tokenId: string) => {
    const trimmedName = name.trim()
    const trimmedTokenId = tokenId.trim()
    if (!trimmedName || !trimmedTokenId) return

    const currentTokens = savedTokensRef.current
    const existing = currentTokens.find((item) => item.token === trimmedTokenId)
    const next = existing
      ? currentTokens.map((item) =>
            item.id === existing.id ? { ...item, name: trimmedName } : item,
        )
      : [...currentTokens, { id: trimmedTokenId, name: trimmedName, token: trimmedTokenId }]

    persistTokens(next)
    const activeId = existing?.id ?? next[next.length - 1]?.id ?? ''
    if (activeId) setSelectedTokenIdState(activeId)
  })

  const addSavedToken = useMemoizedFn((name: string, tokenId: string) => {
    const trimmedName = name.trim()
    const trimmedTokenId = tokenId.trim()
    if (!trimmedName || !trimmedTokenId) return

    const entry: SavedToken = { id: trimmedTokenId, name: trimmedName, token: trimmedTokenId }
    const next = [...savedTokensRef.current, entry]
    persistTokens(next)
    if (!selectedTokenIdRef.current) {
      setSelectedTokenIdState(entry.id)
    }
  })

  const deleteSavedToken = useMemoizedFn((id: string) => {
    const remaining = savedTokensRef.current.filter((token) => token.id !== id)
    persistTokens(remaining)
    if (selectedTokenIdRef.current === id) {
      setSelectedTokenIdState(remaining[0]?.id ?? '')
    }
  })

  return {
    savedTokens,
    selectedTokenId: selectedTokenIdState,
    setSelectedTokenId,
    persistTokens,
    upsertSavedToken,
    addSavedToken,
    deleteSavedToken,
  }
}
