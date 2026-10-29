import { useLocalStorageState, useMemoizedFn } from 'ahooks'
import { CUSTOM_COMMANDS_STORAGE_KEY } from '../features/koko/constants'
import type { CustomCommand } from '../features/koko/types'

type UseCustomCommandsResult = {
  customCommands: CustomCommand[]
  addCustomCommand: (command: Omit<CustomCommand, 'id'>) => void
  updateCustomCommand: (command: CustomCommand) => void
  deleteCustomCommand: (id: string) => void
}

const createCommandId = (): string =>
  `custom-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useCustomCommands = (): UseCustomCommandsResult => {
  const [customCommands = [], setCustomCommands] = useLocalStorageState<CustomCommand[]>(
    CUSTOM_COMMANDS_STORAGE_KEY,
    {
      defaultValue: [],
    },
  )

  const addCustomCommand = useMemoizedFn((command: Omit<CustomCommand, 'id'>) => {
    const nextCommand: CustomCommand = {
      id: createCommandId(),
      name: command.name.trim(),
      content: command.content,
      tag: command.tag.trim(),
    }

    if (!nextCommand.name || !nextCommand.content.trim()) return
    setCustomCommands((current) => [...(current ?? []), nextCommand])
  })

  const updateCustomCommand = useMemoizedFn((command: CustomCommand) => {
    const nextCommand: CustomCommand = {
      ...command,
      name: command.name.trim(),
      tag: command.tag.trim(),
    }

    if (!nextCommand.name || !nextCommand.content.trim()) return
    setCustomCommands((current) =>
      (current ?? []).map((item) => (item.id === nextCommand.id ? nextCommand : item)),
    )
  })

  const deleteCustomCommand = useMemoizedFn((id: string) => {
    setCustomCommands((current) => (current ?? []).filter((item) => item.id !== id))
  })

  return {
    customCommands,
    addCustomCommand,
    updateCustomCommand,
    deleteCustomCommand,
  }
}
