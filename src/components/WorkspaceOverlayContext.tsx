import { createContext, useContext } from 'react'

export const WorkspaceOverlayContext = createContext<HTMLElement | null>(null)

export const useWorkspaceOverlayContainer = (): HTMLElement | false => {
  const container = useContext(WorkspaceOverlayContext)
  return container ?? false
}
