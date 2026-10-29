import type { FC } from 'react'
import { useMemo, useState } from 'react'
import {
  AppstoreOutlined,
  SearchOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { Empty, Input, Modal, Space, Tag, Typography } from 'antd'
import type { CustomCommand } from '../features/koko/types'

const { Paragraph, Text } = Typography

type NativePaletteCommand = {
  id: string
  title: string
  description: string
  keywords: string[]
  onSelect: () => void
}

type CommandPaletteProps = {
  open: boolean
  activeTag: string
  customCommands: CustomCommand[]
  nativeCommands: NativePaletteCommand[]
  onCancel: () => void
  onOpenChange?: (open: boolean) => void
  onExecuteCustomCommand: (command: CustomCommand) => void
}

type PaletteItem = {
  id: string
  title: string
  description: string
  searchText: string
  type: 'native' | 'custom'
  tag: string
  onSelect: () => void
}

const normalizeSearchText = (value: string): string => value.trim().toLowerCase()

export const CommandPalette: FC<CommandPaletteProps> = ({
  open,
  activeTag,
  customCommands,
  nativeCommands,
  onCancel,
  onOpenChange,
  onExecuteCustomCommand,
}) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const normalizedActiveTag = normalizeSearchText(activeTag)

    const nativeItems = nativeCommands.map<PaletteItem>((command) => ({
      id: command.id,
      title: command.title,
      description: command.description,
      searchText: normalizeSearchText([command.title, command.description, ...command.keywords].join(' ')),
      type: 'native',
      tag: '',
      onSelect: command.onSelect,
    }))

    const matchingCustomItems = customCommands
      .filter((command) => normalizeSearchText(command.tag) === normalizedActiveTag && normalizedActiveTag)
      .map<PaletteItem>((command) => ({
        id: command.id,
        title: command.name,
        description: command.content,
        searchText: normalizeSearchText([command.name, command.content, command.tag].join(' ')),
        type: 'custom',
        tag: command.tag,
        onSelect: () => onExecuteCustomCommand(command),
      }))

    const otherCustomItems = customCommands
      .filter((command) => normalizeSearchText(command.tag) !== normalizedActiveTag || !normalizedActiveTag)
      .map<PaletteItem>((command) => ({
        id: command.id,
        title: command.name,
        description: command.content,
        searchText: normalizeSearchText([command.name, command.content, command.tag].join(' ')),
        type: 'custom',
        tag: command.tag,
        onSelect: () => onExecuteCustomCommand(command),
      }))

    return [...nativeItems, ...matchingCustomItems, ...otherCustomItems]
  }, [activeTag, customCommands, nativeCommands, onExecuteCustomCommand])

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return paletteItems
    return paletteItems.filter((item) => item.searchText.includes(normalizedQuery))
  }, [paletteItems, query])

  const safeSelectedIndex = filteredItems.length === 0 ? 0 : Math.min(selectedIndex, filteredItems.length - 1)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
    onOpenChange?.(nextOpen)
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (filteredItems.length ? (current + 1) % filteredItems.length : 0))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) =>
        filteredItems.length ? (current - 1 + filteredItems.length) % filteredItems.length : 0,
      )
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      filteredItems[safeSelectedIndex]?.onSelect()
    }
  }

  return (
    <Modal
      title="命令面板"
      open={open}
      onCancel={onCancel}
      afterOpenChange={handleOpenChange}
      footer={null}
      destroyOnHidden
      width={720}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Space className="w-full" direction="vertical" size="middle">
        <div>
          <Input
            autoFocus
            allowClear
            placeholder="输入命令名称、内容或标签，按 Enter 执行"
            prefix={<SearchOutlined />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Text type="secondary" className="text-[13px]">
              原生命令固定置顶；与当前终端标签匹配的自定义命令会优先显示。
            </Text>
            {activeTag ? <Tag color="blue">当前标签：{activeTag}</Tag> : <Tag>当前无标签</Tag>}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[rgba(100,116,139,0.28)] px-4 py-10">
            <Empty description="没有找到匹配的命令。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-auto pr-1">
            {filteredItems.map((item, index) => {
              const selected = index === safeSelectedIndex
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full cursor-pointer rounded-[10px] border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-[rgba(22,119,255,0.72)] bg-[rgba(22,119,255,0.12)]'
                      : 'border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] hover:border-[rgba(148,163,184,0.45)]'
                  }`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={item.onSelect}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Space size={6} wrap>
                        {item.type === 'native' ? <EditOutlined /> : <AppstoreOutlined />}
                        <Text strong className="text-[13px] leading-5">
                          {item.title}
                        </Text>
                        <Tag className="!mr-0 text-[11px] leading-4" color={item.type === 'native' ? 'gold' : 'blue'}>
                          {item.type === 'native' ? '原生命令' : '自定义命令'}
                        </Tag>
                        {item.tag ? <Tag className="!mr-0 text-[11px] leading-4">{item.tag}</Tag> : null}
                      </Space>
                      <Paragraph
                        className="!mb-0 !mt-1 text-[12px] leading-5"
                        ellipsis={{ rows: 1, expandable: false }}
                        type="secondary"
                      >
                        {item.description}
                      </Paragraph>
                    </div>
                    {selected ? <Text type="secondary" className="text-[12px] leading-5">Enter</Text> : null}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Space>
    </Modal>
  )
}
