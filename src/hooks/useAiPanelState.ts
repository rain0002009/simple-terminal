import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import {
  AI_PANEL_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
} from '../features/koko/constants'
import type { AiPanelSettings } from '../features/koko/types'

type UseAiPanelStateResult = {
  aiPanelSettings: AiPanelSettings
  updateAiPanelSettings: (patch: Partial<AiPanelSettings>) => void
}

const createDefaultAiPanelSettings = (): AiPanelSettings => ({
  baseUrl: DEFAULT_AI_BASE_URL,
  apiKey: '',
  model: DEFAULT_AI_MODEL,
  includeTerminalContext: true,
  includeEditorContext: true,
})

export const useAiPanelState = (): UseAiPanelStateResult => {
  const [aiPanelSettings = createDefaultAiPanelSettings(), setAiPanelSettings] =
    useLocalStorageState<AiPanelSettings>(AI_PANEL_SETTINGS_STORAGE_KEY, {
      defaultValue: createDefaultAiPanelSettings(),
    })

  const updateAiPanelSettings = useMemoizedFn((patch: Partial<AiPanelSettings>) => {
    setAiPanelSettings((current) => ({
      ...createDefaultAiPanelSettings(),
      ...(current ?? createDefaultAiPanelSettings()),
      ...patch,
    }))
  })

  return {
    aiPanelSettings,
    updateAiPanelSettings,
  }
}
