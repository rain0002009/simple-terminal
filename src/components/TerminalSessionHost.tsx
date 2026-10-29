import { type FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AutoComplete, Input, Modal, Space, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { NotificationInstance } from 'antd/es/notification/interface'
import { useMemoizedFn, useRequest, useUnmount } from 'ahooks'
import { FileEditorModal } from './FileEditorModal'
import type {
  TerminalAiSourceSnapshot,
  TerminalSessionHandlers,
  TerminalSessionSnapshot,
  ZmodemTransferState,
} from '../features/koko/types'
import { useTerminalSession } from '../hooks/useTerminalSession'
import { useWorkspaceOverlayContainer } from './WorkspaceOverlayContext'

const { Text } = Typography
const { Dragger } = Upload

type TerminalSessionHostProps = {
  active: boolean
  notificationApi: NotificationInstance
  tabId: string
  onHandlersReady: (tabId: string, handlers: TerminalSessionHandlers) => void
  onSnapshotChange: (tabId: string, snapshot: TerminalSessionSnapshot) => void
  onAiContextSnapshotChange: (tabId: string, snapshot: TerminalAiSourceSnapshot) => void
  onUnmount: (tabId: string) => void
}

const shouldOpenUploadModal = (zmodemTransfer: ZmodemTransferState): boolean =>
  zmodemTransfer.direction === 'upload' &&
  zmodemTransfer.phase !== 'idle' &&
  zmodemTransfer.phase !== 'sending' &&
  zmodemTransfer.phase !== 'completed'

export const TerminalSessionHost: FC<TerminalSessionHostProps> = ({
  active,
  notificationApi,
  tabId,
  onHandlersReady,
  onSnapshotChange,
  onAiContextSnapshotChange,
  onUnmount,
}) => {
  const [showRzUploadModal, setShowRzUploadModal] = useState(false)
  const [rzFileList, setRzFileList] = useState<UploadFile[]>([])
  const [showOpenPathModal, setShowOpenPathModal] = useState(false)
  const [openPathValue, setOpenPathValue] = useState('')
  const [openPathSuggestions, setOpenPathSuggestions] = useState<string[]>([])
  const [isOpenPathDropdownOpen, setIsOpenPathDropdownOpen] = useState(false)
  const [openPathCompleting, setOpenPathCompleting] = useState(false)
  const openPathCompletionSeqRef = useRef(0)
  const suppressNextEnterOpenRef = useRef(false)
  const workspaceOverlayContainer = useWorkspaceOverlayContainer()

  const handleOpenRemotePathModal = useCallback(() => {
    if (!active) return
    setShowOpenPathModal(true)
  }, [active])

  const {
    terminalContainerRef,
    phase,
    statusText,
    errorText,
    closeText,
     sessionId,
     isBusy,
     aiContextSnapshot,
     zmodemTransfer,
    remoteEditor,
    uploadFiles,
    cancelRzUpload,
    updateRemoteEditorContent,
    closeRemoteEditor,
    completeRemotePath,
    openRemoteEditor,
    saveRemoteEditor,
    insertCommandText,
    connectToUrl,
    disconnect,
  } = useTerminalSession({
    suppressTerminalOutput: showOpenPathModal,
  })
  useEffect(() => {
    onHandlersReady(tabId, {
      connectToUrl,
      disconnect,
      openRemotePathModal: handleOpenRemotePathModal,
      insertCommandText,
    })
  }, [connectToUrl, disconnect, handleOpenRemotePathModal, insertCommandText, onHandlersReady, tabId])

  useEffect(() => {
    onSnapshotChange(tabId, {
      phase,
      statusText,
      errorText,
      closeText,
      sessionId,
      isBusy,
    })
  }, [closeText, errorText, isBusy, onSnapshotChange, phase, sessionId, statusText, tabId])

  useEffect(() => {
    onAiContextSnapshotChange(tabId, aiContextSnapshot)
  }, [aiContextSnapshot, onAiContextSnapshotChange, tabId])

  useEffect(() => {
    if (!active && showRzUploadModal) {
      setShowRzUploadModal(false)
      setRzFileList([])
    }
    if (!active && showOpenPathModal) {
      setShowOpenPathModal(false)
      setIsOpenPathDropdownOpen(false)
      setOpenPathSuggestions([])
      setOpenPathCompleting(false)
      setOpenPathValue('')
    }
  }, [active, showOpenPathModal, showRzUploadModal])

  useEffect(() => {
    if (!active) return

    if (zmodemTransfer.phase === 'waiting-upload' && zmodemTransfer.direction === 'upload') {
      setShowRzUploadModal(true)
      setRzFileList([])
      return
    }

    if (zmodemTransfer.phase === 'completed' && zmodemTransfer.direction === 'upload') {
      setShowRzUploadModal(false)
      setRzFileList([])
    }
  }, [active, zmodemTransfer.direction, zmodemTransfer.phase])

  const uploadRequest = useRequest(
    async (files: File[]) => uploadFiles(files),
    {
      manual: true,
      onSuccess: (success) => {
        if (success) {
          setShowRzUploadModal(false)
          setRzFileList([])
        }
      },
    },
  )

  const openRemotePathRequest = useRequest(
    async (path: string) => openRemoteEditor(path),
    { manual: true },
  )

  useUnmount(() => {
    onUnmount(tabId)
  })

  const handleConfirmRzUpload = useMemoizedFn(async () => {
    const files = rzFileList
      .map((item) => item.originFileObj)
      .filter((file): file is NonNullable<typeof file> => Boolean(file))

    if (!files.length) {
      notificationApi.error({
        key: `rz-upload-selection-error-${tabId}`,
        message: '文件上传准备失败',
        description: '请先拖拽或选择至少一个文件后再上传。',
        placement: 'topRight',
      })
      return
    }

    setShowRzUploadModal(false)
    await uploadRequest.runAsync(files)
  })

  const handleCancelRzUpload = useMemoizedFn(() => {
    setShowRzUploadModal(false)
    setRzFileList([])
    void cancelRzUpload()
  })

  const handleCancelRemoteEditor = useMemoizedFn(() => {
    if (remoteEditor.isSaving) return

    if (remoteEditor.isDirty) {
      const confirmed = window.confirm('当前文件有未保存修改，确认关闭编辑器吗？')
      if (!confirmed) return
    }

    closeRemoteEditor()
  })

  const handleOpenRemotePath = useMemoizedFn(async (pathOverride?: string) => {
    const trimmedPath = (pathOverride ?? openPathValue).trim()
    if (!trimmedPath) {
      notificationApi.error({
        key: `open-remote-path-empty-${tabId}`,
        message: '文件路径不能为空',
        description: '请输入需要打开的远端文件路径后再继续。',
        placement: 'topRight',
      })
      return
    }

    await openRemotePathRequest.runAsync(trimmedPath)
    setShowOpenPathModal(false)
    setIsOpenPathDropdownOpen(false)
    setOpenPathSuggestions([])
    setOpenPathValue('')
  })

  const handleCompleteRemotePath = useMemoizedFn(async (rawPath?: string) => {
    const trimmedPath = (rawPath ?? openPathValue).trim()
    if (!trimmedPath || openRemotePathRequest.loading) return

    const requestSeq = openPathCompletionSeqRef.current + 1
    openPathCompletionSeqRef.current = requestSeq
    setOpenPathCompleting(true)
    try {
      const result = await completeRemotePath(trimmedPath)
      if (openPathCompletionSeqRef.current !== requestSeq) return

      if (result.mode === 'single' && result.path) {
        setOpenPathValue(result.path)
        setIsOpenPathDropdownOpen(false)
        setOpenPathSuggestions([])
        return
      }

      if (result.mode === 'multiple') {
        setOpenPathSuggestions(result.items.filter((item) => item.trim().length > 0))
        setIsOpenPathDropdownOpen(true)
        return
      }

      setIsOpenPathDropdownOpen(false)
      setOpenPathSuggestions([])
    } catch (error) {
      notificationApi.error({
        key: `open-remote-path-complete-${tabId}`,
        message: '远端路径补全失败',
        description: error instanceof Error ? error.message : '请稍后重试。',
        placement: 'topRight',
      })
    } finally {
      if (openPathCompletionSeqRef.current === requestSeq) {
        setOpenPathCompleting(false)
      }
    }
  })

  const handleOpenPathValueChange = useMemoizedFn((value: string) => {
    setOpenPathValue(value)
    setIsOpenPathDropdownOpen(false)
    setOpenPathSuggestions([])
  })

  const handleCancelOpenPath = useMemoizedFn(() => {
    if (openRemotePathRequest.loading) return
    setShowOpenPathModal(false)
    setIsOpenPathDropdownOpen(false)
    setOpenPathSuggestions([])
    setOpenPathValue('')
  })

  return (
    <div className={`terminal-host ${active ? 'terminal-host-active' : 'terminal-host-inactive'}`}>
      <div className="terminal-container" ref={terminalContainerRef} />

      <Modal
        title="rz 上传文件"
        open={active && (showRzUploadModal || shouldOpenUploadModal(zmodemTransfer))}
        okText="确定上传"
        cancelText="取消"
        onOk={() => void handleConfirmRzUpload()}
        onCancel={handleCancelRzUpload}
        confirmLoading={uploadRequest.loading}
        closable={false}
        keyboard={!uploadRequest.loading}
        okButtonProps={{ disabled: uploadRequest.loading || rzFileList.length === 0 }}
        getContainer={workspaceOverlayContainer}
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Text type="secondary">检测到远端已执行 rz，请拖拽文件到下方区域或点击选择。</Text>
          <Dragger
            multiple
            fileList={rzFileList}
            beforeUpload={() => false}
            onChange={(info) => setRzFileList(info.fileList)}
            disabled={uploadRequest.loading}
          >
            <p className="ant-upload-drag-icon" />
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">支持多文件上传。点击取消会中止本次 rz 会话。</p>
          </Dragger>

          <Text type={zmodemTransfer.phase === 'error' ? 'danger' : 'secondary'} style={{ fontSize: 13 }}>
            {zmodemTransfer.message}
          </Text>
        </Space>
      </Modal>

      <FileEditorModal
        open={active && remoteEditor.visible}
        remoteEditor={remoteEditor}
        onChange={updateRemoteEditorContent}
        onCancel={handleCancelRemoteEditor}
        onSave={saveRemoteEditor}
        getContainer={workspaceOverlayContainer}
      />

      <Modal
        title="打开远端文件"
        open={active && showOpenPathModal}
        onCancel={handleCancelOpenPath}
        footer={null}
        destroyOnHidden
        maskClosable={!openRemotePathRequest.loading}
        keyboard={!openRemotePathRequest.loading}
        getContainer={workspaceOverlayContainer}
      >
        <Space className="w-full" direction="vertical" size="middle">
          <Text type="secondary">输入远端文件路径后按回车打开。快捷键：Ctrl+P</Text>
          <AutoComplete
            autoFocus
            className="w-full"
            value={openPathValue}
            options={openPathSuggestions
              .filter((item) => item.trim().length > 0)
              .map((item) => ({ value: item, label: <Text code>{item}</Text> }))}
            open={isOpenPathDropdownOpen && openPathSuggestions.length > 0}
            onOpenChange={setIsOpenPathDropdownOpen}
            defaultActiveFirstOption
            disabled={openRemotePathRequest.loading}
            placeholder="请输入文件绝对路径"
            getPopupContainer={(triggerNode) => triggerNode.parentElement ?? document.body}
            onChange={handleOpenPathValueChange}
            onSelect={(value) => {
              setOpenPathValue(value)
              setIsOpenPathDropdownOpen(false)
              setOpenPathSuggestions([])
            }}
            onInputKeyDown={(event) => {
              if (event.key !== 'Tab') return
              event.preventDefault()
              if (openPathCompleting) return
              void handleCompleteRemotePath(openPathValue)
            }}
          >
            <Input
              onPressEnter={() => {
                const trimmedPath = openPathValue.trim()
                const hasExactSuggestion = openPathSuggestions.some((item) => item.trim() === trimmedPath)
                if (isOpenPathDropdownOpen && openPathSuggestions.length > 0 && !hasExactSuggestion) return
                if (suppressNextEnterOpenRef.current) {
                  suppressNextEnterOpenRef.current = false
                  return
                }
                void handleOpenRemotePath()
              }}
            />
          </AutoComplete>
        </Space>
      </Modal>
    </div>
  )
}
