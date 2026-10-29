import type { FC, ReactNode } from 'react'
import { useState } from 'react'
import { Card, Empty, Layout, Tabs } from 'antd'
import { useMemoizedFn } from 'ahooks'
import { WorkspaceOverlayContext } from './WorkspaceOverlayContext'

const { Content } = Layout

type TerminalWorkspaceProps = {
  activeTabId: string
  aiPanel: ReactNode
  aiPanelVisible: boolean
  hosts: ReactNode
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  tabs: Array<{
    key: string
    label: ReactNode
    closable?: boolean
  }>
}

export const TerminalWorkspace: FC<TerminalWorkspaceProps> = ({
  activeTabId,
  aiPanel,
  aiPanelVisible,
  hosts,
  onTabChange,
  onTabClose,
  tabs,
}) => {
  const [workspaceRoot, setWorkspaceRoot] = useState<HTMLDivElement | null>(null)
  const hasAiPanel = Boolean(aiPanelVisible)
  const handleEdit = useMemoizedFn(
    (targetKey: string | React.MouseEvent | React.KeyboardEvent, action: 'add' | 'remove') => {
      if (action !== 'remove' || typeof targetKey !== 'string') return
      onTabClose(targetKey)
    },
  )

  return (
    <Content className="min-h-0 min-w-0 overflow-hidden bg-transparent">
      <WorkspaceOverlayContext.Provider value={workspaceRoot}>
        <div ref={setWorkspaceRoot} className="workspace-root-shell">
          <div className={`workspace-content-grid ${hasAiPanel ? '' : 'workspace-content-grid-panel-hidden'}`.trim()}>
            <Card className="terminal-pane" title="终端" styles={{ body: { padding: 10 } }}>
              {tabs.length > 0 ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <Tabs
                    activeKey={activeTabId}
                    className="terminal-tabs"
                    hideAdd
                    items={tabs}
                    onChange={onTabChange}
                    onEdit={handleEdit}
                    type="editable-card"
                  />
                  <div className="relative min-h-0 min-w-0 flex-1">{hosts}</div>
                </div>
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6">
                  <Empty
                    description="请选择连接令牌并建立连接，连接后会在这里打开独立终端标签页。"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                </div>
              )}
            </Card>

            {aiPanel ? <div className={aiPanelVisible ? '' : 'hidden'}>{aiPanel}</div> : null}
          </div>
        </div>
      </WorkspaceOverlayContext.Provider>
    </Content>
  )
}
