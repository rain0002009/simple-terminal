import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider, Layout, theme } from 'antd'
import { useMemoizedFn } from 'ahooks'
import { AiAssistantPanel } from './components/AiAssistantPanel'
import { CommandPalette } from './components/CommandPalette'
import { CustomCommandManagerModal } from './components/CustomCommandManagerModal'
import { AccessKeyConfigModal } from './components/AccessKeyConfigModal'
import { LeftConnectionPanel } from './components/LeftConnectionPanel'
import { ObsManagerModal } from './components/ObsManagerModal'
import { TaskLogPage } from './components/TaskLogPage'
import { TaskLogModal } from './components/TaskLogModal'
import { TerminalSessionHost } from './components/TerminalSessionHost'
import { TerminalWorkspace } from './components/TerminalWorkspace'
import { TopAuthPanel } from './components/TopAuthPanel'
import type {
  AiSessionState,
  CustomCommand,
  TerminalAiContextSnapshot,
  TerminalAiSourceSnapshot,
  TerminalSessionHandlers,
  TerminalSessionSnapshot,
  TerminalTab,
} from './features/koko/types'
import { useAuthSession } from './hooks/useAuthSession'
import { useConnectionTokenManager } from './hooks/useConnectionTokenManager'
import { useCustomCommands } from './hooks/useCustomCommands'
import { useErrorNotifications } from './hooks/useErrorNotifications'
import { useAiPanelState } from './hooks/useAiPanelState'
import { useAccessKeySettings } from './hooks/useAccessKeySettings'

const { Content } = Layout

const createIdleSnapshot = (): TerminalSessionSnapshot => ({
  phase: 'idle',
  statusText: '选择资产后点击连接',
  errorText: '',
  closeText: '',
  sessionId: '',
  isBusy: false,
})

const createAiSession = (tab: TerminalTab): AiSessionState => ({
  id: `ai-session-${tab.id}`,
  tabId: tab.id,
  title: tab.title,
  summary: '',
  status: 'idle',
  errorText: '',
  messages: [],
  updatedAt: Date.now(),
})

const GLOBAL_AI_SESSION_TAB_ID = '__global-ai-session__'

const parseTaskLogRoute = (pathname: string): string | null => {
  const match = pathname.match(/^\/log\/([^/?#]+)\/?$/)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

const createGlobalAiSession = (): AiSessionState => ({
  id: GLOBAL_AI_SESSION_TAB_ID,
  tabId: GLOBAL_AI_SESSION_TAB_ID,
  title: '全局 AI 会话',
  summary: '',
  status: 'idle',
  errorText: '',
  messages: [],
  updatedAt: Date.now(),
})

const AppInner: FC = () => {
  const { notification } = AntdApp.useApp()
  const sessionHandlersRef = useRef<Record<string, TerminalSessionHandlers>>({})
  const pendingConnectUrlRef = useRef<Map<string, string>>(new Map())

  const {
    jmsSessionId,
    csrfToken,
    expiresAt,
    authToken,
    authUserName,
    authExpiresAt,
    loginLoading,
    authError,
    handleLogin,
    clearAuthError,
  } = useAuthSession()

  const {
    assetOptions,
    favoriteAssetOptions,
    favoriteAssetIds,
    selectedAssetId,
    setSelectedAssetId,
    assetsLoading,
    assetsError,
    favoriteAssetsLoading,
    favoriteActionAssetId,
    favoriteActionError,
    createTokenAndConnect,
    isConnecting,
    tokenActionError,
    toggleFavoriteAsset,
  } = useConnectionTokenManager({ authToken })

  const {
    customCommands,
    addCustomCommand,
    updateCustomCommand,
    deleteCustomCommand,
  } = useCustomCommands()

  const {
    aiPanelSettings,
    updateAiPanelSettings,
  } = useAiPanelState()

  const {
    accessKeySettings,
    accessKeyConfigured,
    updateAccessKeySettings,
    clearAccessKeySettings,
  } = useAccessKeySettings()

  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const [tabSnapshots, setTabSnapshots] = useState<Record<string, TerminalSessionSnapshot>>({})
  const [tabAiSnapshots, setTabAiSnapshots] = useState<Record<string, TerminalAiSourceSnapshot>>({})
  const [tabAiSessions, setTabAiSessions] = useState<Record<string, AiSessionState>>({})
  const [aiPanelVisible, setAiPanelVisible] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [customCommandManagerOpen, setCustomCommandManagerOpen] = useState(false)
  const [obsManagerOpen, setObsManagerOpen] = useState(false)
  const [taskLogOpen, setTaskLogOpen] = useState(false)
  const [accessKeyConfigOpen, setAccessKeyConfigOpen] = useState(false)
  const [pendingPaletteAction, setPendingPaletteAction] = useState<'open-remote-file' | 'open-custom-command-manager' | 'open-obs-manager' | 'open-task-log' | null>(null)
  const taskLogRouteTaskId = parseTaskLogRoute(window.location.pathname)

  const activeTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, terminalTabs],
  )

  const activeSnapshot = activeTab ? (tabSnapshots[activeTab.id] ?? createIdleSnapshot()) : createIdleSnapshot()

  const activeAiContext = useMemo<TerminalAiContextSnapshot | null>(() => {
    if (!activeTab) return null
    const source = tabAiSnapshots[activeTab.id]
    const snapshot = tabSnapshots[activeTab.id] ?? createIdleSnapshot()
    if (!source) {
      return {
        tabId: activeTab.id,
        tabTitle: activeTab.title,
        tabTag: activeTab.tag,
        phase: snapshot.phase,
        statusText: snapshot.statusText,
        sessionId: snapshot.sessionId,
        terminalTranscriptTail: '',
        remoteEditor: {
          visible: false,
          filePath: '',
          content: '',
          isDirty: false,
          isLoading: false,
          isSaving: false,
          errorText: '',
        },
      }
    }

    return {
      tabId: activeTab.id,
      tabTitle: activeTab.title,
      tabTag: activeTab.tag,
      phase: snapshot.phase,
      statusText: snapshot.statusText,
      sessionId: snapshot.sessionId,
      ...source,
    }
  }, [activeTab, tabAiSnapshots, tabSnapshots])

  const activeAiSession = useMemo<AiSessionState | null>(() => {
    if (!activeTab) {
      return tabAiSessions[GLOBAL_AI_SESSION_TAB_ID] ?? createGlobalAiSession()
    }
    return tabAiSessions[activeTab.id] ?? createAiSession(activeTab)
  }, [activeTab, tabAiSessions])

  const selectedAssetName = useMemo(
    () =>
      assetOptions.find((item) => item.value === selectedAssetId)?.label ??
      favoriteAssetOptions.find((item) => item.value === selectedAssetId)?.label ??
      '',
    [assetOptions, favoriteAssetOptions, selectedAssetId],
  )

  const selectedAssetAddress = useMemo(
    () =>
      assetOptions.find((item) => item.value === selectedAssetId)?.address ??
      favoriteAssetOptions.find((item) => item.value === selectedAssetId)?.address ??
      '',
    [assetOptions, favoriteAssetOptions, selectedAssetId],
  )

  const tagOptions = useMemo(
    () =>
      Array.from(new Set(terminalTabs.map((item) => item.tag.trim()).filter((item) => item.length > 0)))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .map((item) => ({ label: item, value: item })),
    [terminalTabs],
  )

  const activeSessionHandlers = activeTabId ? sessionHandlersRef.current[activeTabId] : undefined

  useErrorNotifications({
    assetsError,
    authError,
    favoriteActionError,
    notificationApi: notification,
    tokenActionError,
    terminalError: activeSnapshot.errorText,
  })

  const removeTabArtifacts = useMemoizedFn((tabId: string) => {
    delete sessionHandlersRef.current[tabId]
    pendingConnectUrlRef.current.delete(tabId)
    setTabSnapshots((current) => {
      if (!(tabId in current)) return current
      const next = { ...current }
      delete next[tabId]
      return next
    })
    setTabAiSnapshots((current) => {
      if (!(tabId in current)) return current
      const next = { ...current }
      delete next[tabId]
      return next
    })
    setTabAiSessions((current) => {
      if (!(tabId in current)) return current
      const next = { ...current }
      delete next[tabId]
      return next
    })
  })

  const handleAiSessionChange = useMemoizedFn((session: AiSessionState) => {
    setTabAiSessions((current) => ({
      ...current,
      [session.tabId]: session,
    }))
  })

  const handleSnapshotChange = useMemoizedFn((tabId: string, snapshot: TerminalSessionSnapshot) => {
    setTabSnapshots((current) => {
      const previous = current[tabId]
      if (
        previous &&
        previous.phase === snapshot.phase &&
        previous.statusText === snapshot.statusText &&
        previous.errorText === snapshot.errorText &&
        previous.closeText === snapshot.closeText &&
        previous.sessionId === snapshot.sessionId &&
        previous.isBusy === snapshot.isBusy
      ) {
        return current
      }

      return { ...current, [tabId]: snapshot }
    })
  })

  const handleHandlersReady = useMemoizedFn(
    (tabId: string, handlers: TerminalSessionHandlers) => {
      sessionHandlersRef.current[tabId] = handlers

      const pendingUrl = pendingConnectUrlRef.current.get(tabId)
      if (pendingUrl) {
        pendingConnectUrlRef.current.delete(tabId)
        handlers.connectToUrl(pendingUrl)
      }
    },
  )

  const handleAiContextSnapshotChange = useMemoizedFn((tabId: string, snapshot: TerminalAiSourceSnapshot) => {
    setTabAiSnapshots((current) => {
      const previous = current[tabId]
      if (
        previous &&
        previous.terminalTranscriptTail === snapshot.terminalTranscriptTail &&
        previous.remoteEditor.visible === snapshot.remoteEditor.visible &&
        previous.remoteEditor.filePath === snapshot.remoteEditor.filePath &&
        previous.remoteEditor.content === snapshot.remoteEditor.content &&
        previous.remoteEditor.isDirty === snapshot.remoteEditor.isDirty &&
        previous.remoteEditor.isLoading === snapshot.remoteEditor.isLoading &&
        previous.remoteEditor.isSaving === snapshot.remoteEditor.isSaving &&
        previous.remoteEditor.errorText === snapshot.remoteEditor.errorText
      ) {
        return current
      }

      return { ...current, [tabId]: snapshot }
    })
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return

      const lowerKey = event.key.toLowerCase()
      if (lowerKey === 'p') {
        event.preventDefault()
        event.stopPropagation()
        setCommandPaletteOpen(true)
        return
      }

      if (lowerKey !== 'i') return

      event.preventDefault()
      event.stopPropagation()
      setAiPanelVisible((current) => !current)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const finalizeRemoveTab = useMemoizedFn(
    (tabId: string) => {
      removeTabArtifacts(tabId)
      setTerminalTabs((current) => {
        const index = current.findIndex((tab) => tab.id === tabId)
        if (index < 0) return current

        const next = current.filter((tab) => tab.id !== tabId)
        setActiveTabId((currentActive) => {
          if (currentActive !== tabId) return currentActive
          const fallback = next[index] ?? next[index - 1] ?? next[0] ?? null
          return fallback?.id ?? ''
        })
        return next
      })
    },
  )

  const handleCloseTab = useMemoizedFn(
    (tabId: string) => {
      sessionHandlersRef.current[tabId]?.disconnect()
      finalizeRemoveTab(tabId)
    },
  )

  const handleDisconnectActiveTab = useMemoizedFn(() => {
    if (!activeTabId) return
    sessionHandlersRef.current[activeTabId]?.disconnect()
  })

  const handleConnect = useMemoizedFn(async () => {
    if (!selectedAssetId || isConnecting) return

    const socketUrl = await createTokenAndConnect(selectedAssetId)
    if (!socketUrl) return

    const nextTab: TerminalTab = {
      id: `terminal-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: selectedAssetAddress || selectedAssetName || '终端',
      tag: selectedAssetName || '终端',
    }

    setTerminalTabs((current) => [...current, nextTab])
    setTabSnapshots((current) => ({ ...current, [nextTab.id]: createIdleSnapshot() }))
    setTabAiSessions((current) => ({ ...current, [nextTab.id]: createAiSession(nextTab) }))
    setActiveTabId(nextTab.id)
    pendingConnectUrlRef.current.set(nextTab.id, socketUrl)
  })

  const handleOpenRemoteFile = useMemoizedFn(() => {
    if (!activeSessionHandlers) {
      notification.error({
        key: 'command-palette-open-remote-file-missing-tab',
        message: '无法打开远端文件',
        description: '请先连接并激活一个终端标签页，然后再使用该命令。',
        placement: 'topRight',
      })
      return
    }

    setPendingPaletteAction('open-remote-file')
    setCommandPaletteOpen(false)
  })

  const handleOpenCustomCommandManager = useMemoizedFn(() => {
    setPendingPaletteAction('open-custom-command-manager')
    setCommandPaletteOpen(false)
  })

  const handleOpenObsManager = useMemoizedFn(() => {
    setPendingPaletteAction('open-obs-manager')
    setCommandPaletteOpen(false)
  })

  const handleOpenTaskLog = useMemoizedFn(() => {
    setPendingPaletteAction('open-task-log')
    setCommandPaletteOpen(false)
  })

  const handleCommandPaletteOpenChange = useMemoizedFn(
    (open: boolean) => {
      if (open || !pendingPaletteAction) return

      if (pendingPaletteAction === 'open-remote-file') {
        activeSessionHandlers?.openRemotePathModal()
      }

      if (pendingPaletteAction === 'open-custom-command-manager') {
        setCustomCommandManagerOpen(true)
      }

      if (pendingPaletteAction === 'open-obs-manager') {
        setObsManagerOpen(true)
      }

      if (pendingPaletteAction === 'open-task-log') {
        setTaskLogOpen(true)
      }

      setPendingPaletteAction(null)
    },
  )

  const handleExecuteCustomCommand = useMemoizedFn(
    (command: CustomCommand) => {
      if (!activeSessionHandlers) {
        notification.error({
          key: `custom-command-no-tab-${command.id}`,
          message: '无法执行自定义命令',
          description: '请先连接并激活一个终端标签页，再执行该命令。',
          placement: 'topRight',
        })
        return
      }

      const success = activeSessionHandlers.insertCommandText(command.content)
      if (!success) {
        notification.error({
          key: `custom-command-send-failed-${command.id}`,
          message: '自定义命令填入失败',
          description: '当前终端尚未就绪，或连接已经断开。',
          placement: 'topRight',
        })
        return
      }

      setCommandPaletteOpen(false)
      notification.success({
        key: `custom-command-filled-${command.id}`,
        message: '命令已填入终端',
        description: `已填入自定义命令：${command.name}`,
        placement: 'topRight',
      })
    },
  )

  const nativePaletteCommands = useMemo(
    () => [
      {
        id: 'open-remote-file',
        title: '打开远端文件',
        description: '打开当前终端对应的远端文件编辑流程。',
        keywords: ['ctrl+p', 'file', 'editor', 'remote', 'path'],
        onSelect: handleOpenRemoteFile,
      },
      {
        id: 'manage-custom-commands',
        title: '管理自定义命令',
        description: '添加、编辑、删除本地持久化的自定义命令。',
        keywords: ['custom', 'command', 'manage', 'crud'],
        onSelect: handleOpenCustomCommandManager,
      },
      {
        id: 'manage-obs',
        title: 'OBS 管理',
        description: '浏览对象、检查元数据，并上传覆盖或删除 OBS 文件。',
        keywords: ['obs', 'bucket', 'object', 'upload', 'delete', 'storage'],
        onSelect: handleOpenObsManager,
      },
      {
        id: 'query-task-log',
        title: '查询任务日志',
        description: '输入任务 ID，通过服务端代理连接上游任务日志流并实时查看输出。',
        keywords: ['task', 'log', 'ops', 'websocket', 'job', 'execution'],
        onSelect: handleOpenTaskLog,
      },
    ],
    [handleOpenCustomCommandManager, handleOpenObsManager, handleOpenRemoteFile, handleOpenTaskLog],
  )

  const tabs = terminalTabs.map((tab) => ({
    key: tab.id,
    label: tab.title,
    closable: true,
  }))

  const hosts = terminalTabs.map((tab) => (
    <TerminalSessionHost
      key={tab.id}
      active={tab.id === activeTabId}
      notificationApi={notification}
      onAiContextSnapshotChange={handleAiContextSnapshotChange}
      onHandlersReady={handleHandlersReady}
      onSnapshotChange={handleSnapshotChange}
      onUnmount={removeTabArtifacts}
      tabId={tab.id}
    />
  ))

  if (taskLogRouteTaskId) {
    return (
      <>
        <TaskLogPage
          taskId={taskLogRouteTaskId}
          accessKeyConfigured={accessKeyConfigured}
          settings={accessKeySettings}
          onOpenAccessKeyConfig={() => setAccessKeyConfigOpen(true)}
        />

        <AccessKeyConfigModal
          open={accessKeyConfigOpen}
          settings={accessKeySettings}
          onCancel={() => setAccessKeyConfigOpen(false)}
          onSubmit={(settings) => {
            updateAccessKeySettings(settings)
            setAccessKeyConfigOpen(false)
          }}
          onClear={clearAccessKeySettings}
        />
      </>
    )
  }

  return (
    <Layout className="h-screen overflow-hidden bg-transparent">
      <TopAuthPanel
        authToken={authToken}
        authUserName={authUserName}
        jmsSessionId={jmsSessionId}
        csrfToken={csrfToken}
        expiresAt={expiresAt}
        authExpiresAt={authExpiresAt}
        loginLoading={loginLoading}
        accessKeyConfigured={accessKeyConfigured}
        onLoginSubmit={handleLogin}
        onClearAuthError={clearAuthError}
        onOpenAccessKeyConfig={() => setAccessKeyConfigOpen(true)}
      />

      <Content className="flex min-h-0 overflow-hidden p-4 max-md:p-3">
        <Layout className="h-full w-full gap-4 overflow-hidden bg-transparent">
          <LeftConnectionPanel
            assetOptions={assetOptions}
            favoriteAssetOptions={favoriteAssetOptions}
            favoriteAssetIds={favoriteAssetIds}
            selectedAssetId={selectedAssetId}
            assetsLoading={assetsLoading}
            isConnecting={isConnecting}
            favoriteAssetsLoading={favoriteAssetsLoading}
            favoriteActionAssetId={favoriteActionAssetId}
            activeTabIsBusy={activeSnapshot.isBusy}
            phase={activeSnapshot.phase}
            statusText={activeSnapshot.statusText}
            sessionId={activeSnapshot.sessionId}
            closeText={activeSnapshot.closeText}
            onSelectedAssetChange={setSelectedAssetId}
            onToggleFavoriteAsset={(assetId) => void toggleFavoriteAsset(assetId)}
            onConnect={() => void handleConnect()}
            onDisconnect={handleDisconnectActiveTab}
          />

          <TerminalWorkspace
            activeTabId={activeTabId}
            aiPanel={
              <AiAssistantPanel
                activeContext={activeAiContext}
                activeSession={activeAiSession}
                settings={aiPanelSettings}
                onSessionChange={handleAiSessionChange}
                onSettingsChange={updateAiPanelSettings}
              />
            }
            aiPanelVisible={aiPanelVisible}
            hosts={hosts}
            onTabChange={setActiveTabId}
            onTabClose={handleCloseTab}
            tabs={tabs}
          />
        </Layout>
      </Content>

      <CommandPalette
        open={commandPaletteOpen}
        activeTag={activeTab?.tag ?? ''}
        customCommands={customCommands}
        nativeCommands={nativePaletteCommands}
        onCancel={() => setCommandPaletteOpen(false)}
        onOpenChange={handleCommandPaletteOpenChange}
        onExecuteCustomCommand={handleExecuteCustomCommand}
      />

      <CustomCommandManagerModal
        open={customCommandManagerOpen}
        commands={customCommands}
        tagOptions={tagOptions}
        onCancel={() => setCustomCommandManagerOpen(false)}
        onCreate={addCustomCommand}
        onUpdate={updateCustomCommand}
        onDelete={deleteCustomCommand}
      />

      <ObsManagerModal
        open={obsManagerOpen}
        onCancel={() => setObsManagerOpen(false)}
      />

      <TaskLogModal
        open={taskLogOpen}
        accessKeyConfigured={accessKeyConfigured}
        settings={accessKeySettings}
        onCancel={() => setTaskLogOpen(false)}
        onOpenAccessKeyConfig={() => setAccessKeyConfigOpen(true)}
      />

      <AccessKeyConfigModal
        open={accessKeyConfigOpen}
        settings={accessKeySettings}
        onCancel={() => setAccessKeyConfigOpen(false)}
        onSubmit={(settings) => {
          updateAccessKeySettings(settings)
          setAccessKeyConfigOpen(false)
        }}
        onClear={clearAccessKeySettings}
      />
    </Layout>
  )
}

const App: FC = () => (
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <AntdApp>
      <AppInner />
    </AntdApp>
  </ConfigProvider>
)

export default App
