import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest, useMemoizedFn } from 'ahooks'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import 'nora-zmodemjs'
import '@xterm/xterm/css/xterm.css'
import {
  HANDSHAKE_TIMEOUT_MS,
  MAX_TERMINAL_TRANSCRIPT_CHARS,
  MAX_TERMINAL_TRANSCRIPT_LINES,
  MAX_EVENT_LOG,
  PING_INTERVAL_MS,
  READY_HINT_TIMEOUT_MS,
} from '../features/koko/constants'
import type {
  Phase,
  ProtocolMessage,
  TerminalAiSourceSnapshot,
  RemoteEditorState,
  ZmodemDownloadSaveMode,
  ZmodemTransferDirection,
  ZmodemTransferState,
} from '../features/koko/types'
import {
  decodeFrameToString,
  nowLabel,
  parseProtocolMessage,
  sanitizeTerminalDisplayChunk,
  safeString,
} from '../features/koko/utils'
import {
  buildRemoteEditorReadCommand,
  buildRemoteEditorWriteCommand,
  buildRemotePathCompletionCommand,
  decodeBase64,
  getBridgeErrorMessage as getErrorMessage,
  normalizeBridgeCandidate,
  parseBridgeLine,
  type BridgeFieldName,
  type RemoteEditorBridgeResult,
} from '../features/koko/remote-editor-bridge'
import { writeTerminalTransferStatus } from '../features/koko/terminal-transfer-status'
import {
  isZmodemDownloadWorkerResponse,
  type ZmodemDownloadWorkerResponse,
} from '../features/koko/zmodemDownloadWorker'

type UseTerminalSessionOptions = {
  suppressTerminalOutput?: boolean
}

type UseTerminalSessionResult = {
  terminalContainerRef: React.RefObject<HTMLDivElement | null>
  phase: Phase
  statusText: string
  errorText: string
  closeText: string
  sessionId: string
  eventLog: string[]
  aiContextSnapshot: TerminalAiSourceSnapshot
  isBusy: boolean
  zmodemTransfer: ZmodemTransferState
  remoteEditor: RemoteEditorState
  uploadFiles: (files: FileList | File[]) => Promise<boolean>
  cancelRzUpload: () => Promise<void>
  updateRemoteEditorContent: (content: string) => void
  closeRemoteEditor: () => void
  completeRemotePath: (inputPath: string) => Promise<{ mode: 'single' | 'multiple' | 'none'; path?: string; items: string[] }>
  openRemoteEditor: (filePath: string) => Promise<void>
  saveRemoteEditor: () => Promise<boolean>
  insertCommandText: (command: string) => boolean
  connectToUrl: (socketUrl: string) => void
  disconnect: () => void
}

type PendingBridgeRequest = {
  resolve: (result: RemoteEditorBridgeResult) => void
  reject: (error: Error) => void
  timeoutId: number
}

type PendingDownloadAssemblyRequest = {
  resolve: (result: { buffer: ArrayBuffer; totalBytes: number }) => void
  reject: (error: Error) => void
  timeoutId: number
}

type PendingDownloadChunkBatch = {
  bufferedBytes: number
  chunks: ArrayBuffer[]
  flushTimerId: number | null
}

type DownloadProgressSnapshot = {
  fileName: string
  message: string
  phase: ZmodemTransferState['phase']
  totalBytes: number
  transferredBytes: number
}

const REMOTE_EDITOR_TIMEOUT_MS = 20_000
const DOWNLOAD_ASSEMBLY_TIMEOUT_MS = 20_000
const DOWNLOAD_CHUNK_BATCH_INTERVAL_MS = 40
const DOWNLOAD_CHUNK_BATCH_BYTES = 256 * 1024
const DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS = 120
const REMOTE_EDITOR_PREFIX = '__KOKO_EDITOR__:'
const REMOTE_EDITOR_END_TOKEN = 'END'
const BRIDGE_LINE_PATTERN = new RegExp(
  String.raw`__KOKO_EDITOR__:[^:\r\n]+:(?:phase|op|path|ok|checksum|contentChunk|error|completionMode|completionItem)=[^\r\n]*`,
  'g',
)

const createIdleRemoteEditorState = (): RemoteEditorState => ({
  visible: false,
  filePath: '',
  content: '',
  checksum: '',
  isDirty: false,
  isLoading: false,
  isSaving: false,
  errorText: '',
})

type ZmodemSessionLike = {
  type?: 'send' | 'receive'
  on: (eventName: string, handler: (...args: unknown[]) => void) => unknown
  start?: () => Promise<unknown>
  close?: () => Promise<unknown>
  abort?: () => void
}

type ZmodemOfferLike = {
  get_details: () => { name?: string; size?: number }
  get_offset: () => number
  accept: () => Promise<unknown>
  on: (eventName: string, handler: (...args: unknown[]) => void) => unknown
}

type ZmodemTransferLike = {
  get_offset: () => number
}

type ZmodemDetectionLike = {
  confirm: () => ZmodemSessionLike
}

type ZmodemGlobalLike = {
  Sentry: new (options: {
    to_terminal: (octets: unknown) => void
    sender: (octets: unknown) => void
    on_detect: (detection: ZmodemDetectionLike) => void
    on_retract: () => void
  }) => {
    consume: (input: ArrayBuffer) => void
  }
  Browser: {
    send_files: (
      session: ZmodemSessionLike,
      files: FileList | File[],
      options?: {
        on_offer_response?: (file: File, transfer?: ZmodemTransferLike) => void
        on_progress?: (file: File, transfer: ZmodemTransferLike, chunk: Uint8Array) => void
        on_file_complete?: (file: File, transfer: ZmodemTransferLike) => void
      },
    ) => Promise<unknown>
  }
}

type FileSystemWritableFileStreamLike = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

type FileSystemDirectoryHandleLike = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<FileSystemFileHandleLike>
}

type DirectoryPickerCapableWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
}

const getZmodem = (): ZmodemGlobalLike | null => {
  if (typeof window === 'undefined') return null
  return window.Zmodem ?? null
}

const trimTranscriptTail = (text: string): string => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const limitedLines = lines.slice(-MAX_TERMINAL_TRANSCRIPT_LINES)
  const joined = limitedLines.join('\n').trim()
  if (joined.length <= MAX_TERMINAL_TRANSCRIPT_CHARS) return joined
  return joined.slice(joined.length - MAX_TERMINAL_TRANSCRIPT_CHARS).trim()
}

const createIdleTransferState = (): ZmodemTransferState => ({
  phase: 'idle',
  direction: null,
  fileName: '',
  transferredBytes: 0,
  totalBytes: 0,
  percent: 0,
  message: '暂无文件传输',
  saveMode: 'none',
  saveModeMessage: '',
})

const toPercent = (transferredBytes: number, totalBytes: number): number => {
  if (!totalBytes || totalBytes < 0) return 0
  const ratio = transferredBytes / totalBytes
  if (!Number.isFinite(ratio)) return 0
  return Math.max(0, Math.min(100, Number((ratio * 100).toFixed(1))))
}

const toOctetArray = (value: unknown): number[] => {
  if (value instanceof Uint8Array) return Array.from(value)
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value))
  if (Array.isArray(value)) return value.filter((item): item is number => typeof item === 'number')
  return []
}

export const useTerminalSession = ({
  suppressTerminalOutput,
}: UseTerminalSessionOptions): UseTerminalSessionResult => {
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef('')
  const readyRef = useRef(false)
  const resizeTimerRef = useRef<number | null>(null)
  const handshakeTimerRef = useRef<number | null>(null)
  const readyHintTimerRef = useRef<number | null>(null)
  const pingTimerRef = useRef<number | null>(null)
  const zmodemSentryRef = useRef<unknown>(null)
  const zmodemSessionRef = useRef<ZmodemSessionLike | null>(null)
  const zmodemDownloadWorkerRef = useRef<Worker | null>(null)
  const pendingDownloadAssemblyRequestsRef = useRef<Map<string, PendingDownloadAssemblyRequest>>(new Map())
  const activeDownloadTransferIdsRef = useRef<Set<string>>(new Set())
  const pendingDownloadChunkBatchesRef = useRef<Map<string, PendingDownloadChunkBatch>>(new Map())
  const downloadProgressStateRef = useRef<Map<string, { lastFlushAt: number; lastProgressBucket: number; lastPhase: ZmodemTransferState['phase'] }>>(new Map())
  const terminalNoiseCarryRef = useRef('')
  const pendingObjectUrlsRef = useRef<Set<string>>(new Set())
  const lastDownloadTerminalPhaseRef = useRef<ZmodemTransferState['phase']>('idle')
  const lastDownloadProgressBucketRef = useRef(-1)
  const lastUploadTerminalPhaseRef = useRef<ZmodemTransferState['phase']>('idle')
  const lastUploadProgressBucketRef = useRef(-1)
  const pendingBridgeRequestsRef = useRef<Map<string, PendingBridgeRequest>>(new Map())
  const activeBridgeRequestIdsRef = useRef<Set<string>>(new Set())
  const suppressPromptEchoUntilRef = useRef(0)
  const bridgeLineCarryRef = useRef('')
  const bridgePayloadBufferRef = useRef<Map<string, Partial<Record<BridgeFieldName, string>>>>(new Map())
  const remoteEditorBaselineContentRef = useRef('')
  const terminalTranscriptRef = useRef('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [statusText, setStatusText] = useState('请选择 Token 后连接')
  const [errorText, setErrorText] = useState('')
  const [closeText, setCloseText] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [eventLog, setEventLog] = useState<string[]>([])
  const [terminalTranscriptTail, setTerminalTranscriptTail] = useState('')
  const [zmodemTransfer, setZmodemTransfer] = useState<ZmodemTransferState>(createIdleTransferState)
  const [remoteEditor, setRemoteEditor] = useState<RemoteEditorState>(createIdleRemoteEditorState)
  const remoteEditorRef = useLatest(remoteEditor)

  const pushEvent = useMemoizedFn((text: string) => {
    const entry = `[${nowLabel()}] ${text}`
    setEventLog((prev) => {
      const next = [...prev, entry]
      return next.length <= MAX_EVENT_LOG ? next : next.slice(next.length - MAX_EVENT_LOG)
    })
  })

  const setTerminalInputEnabled = useMemoizedFn((enabled: boolean) => {
    readyRef.current = enabled
    const terminal = terminalRef.current
    if (terminal) terminal.options.disableStdin = !enabled
  })

  const clearTimers = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = null
    }
    if (handshakeTimerRef.current !== null) {
      window.clearTimeout(handshakeTimerRef.current)
      handshakeTimerRef.current = null
    }
    if (readyHintTimerRef.current !== null) {
      window.clearTimeout(readyHintTimerRef.current)
      readyHintTimerRef.current = null
    }
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
  }, [])

  const clearPendingBridgeRequests = useCallback((reason: string) => {
    pendingBridgeRequestsRef.current.forEach((request) => {
      window.clearTimeout(request.timeoutId)
      request.reject(new Error(reason))
    })
    pendingBridgeRequestsRef.current.clear()
    activeBridgeRequestIdsRef.current.clear()
    bridgePayloadBufferRef.current.clear()
    bridgeLineCarryRef.current = ''
  }, [])

  const resetSession = useCallback(() => {
    sessionIdRef.current = ''
    setSessionId('')
    setTerminalInputEnabled(false)
    terminalNoiseCarryRef.current = ''
    bridgeLineCarryRef.current = ''
    remoteEditorBaselineContentRef.current = ''
    terminalTranscriptRef.current = ''
    setTerminalTranscriptTail('')
  }, [setTerminalInputEnabled])

  const appendTerminalTranscript = useMemoizedFn((text: string) => {
    if (!text) return
    const next = trimTranscriptTail(`${terminalTranscriptRef.current}${text}`)
    terminalTranscriptRef.current = next
    setTerminalTranscriptTail(next)
  })

  const cleanupObjectUrls = useCallback(() => {
    pendingObjectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url)
    })
    pendingObjectUrlsRef.current.clear()
  }, [])

  const clearDownloadChunkBatch = useCallback((transferId: string) => {
    const batch = pendingDownloadChunkBatchesRef.current.get(transferId)
    if (!batch) return

    if (batch.flushTimerId !== null) {
      window.clearTimeout(batch.flushTimerId)
    }

    pendingDownloadChunkBatchesRef.current.delete(transferId)
  }, [])

  const clearDownloadProgressState = useCallback((transferId: string) => {
    downloadProgressStateRef.current.delete(transferId)
  }, [])

  const resetDownloadAssemblyWorker = useCallback((reason?: string) => {
    activeDownloadTransferIdsRef.current.forEach((transferId) => {
      zmodemDownloadWorkerRef.current?.postMessage({
        type: 'abort',
        transferId,
      })
      clearDownloadChunkBatch(transferId)
      clearDownloadProgressState(transferId)
    })
    activeDownloadTransferIdsRef.current.clear()

    pendingDownloadChunkBatchesRef.current.forEach((_, transferId) => {
      clearDownloadChunkBatch(transferId)
    })
    downloadProgressStateRef.current.clear()

    pendingDownloadAssemblyRequestsRef.current.forEach((request) => {
      window.clearTimeout(request.timeoutId)
      request.reject(new Error(reason || '下载合并任务已取消。'))
    })
    pendingDownloadAssemblyRequestsRef.current.clear()
  }, [clearDownloadChunkBatch, clearDownloadProgressState])

  const resetZmodemSession = useCallback((reason?: string) => {
    resetDownloadAssemblyWorker(reason)
    zmodemSentryRef.current = null
    zmodemSessionRef.current = null
    lastUploadTerminalPhaseRef.current = 'idle'
    lastUploadProgressBucketRef.current = -1
    lastDownloadTerminalPhaseRef.current = 'idle'
    lastDownloadProgressBucketRef.current = -1
    setZmodemTransfer(createIdleTransferState())
    if (reason) pushEvent(`ZMODEM 重置：${reason}`)
  }, [pushEvent, resetDownloadAssemblyWorker])

  const sendProtocolMessage = useCallback(
    (type: string, data: unknown, id = sessionIdRef.current): boolean => {
      const socket = websocketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      try {
        socket.send(JSON.stringify({ id, type, data }))
      } catch {
        return false
      }
      return true
    },
    [],
  )

  const updateRemoteEditorContent = useMemoizedFn((content: string) => {
    setRemoteEditor((current) => ({
      ...current,
      content,
      isDirty: current.visible ? content !== remoteEditorBaselineContentRef.current : false,
      errorText: '',
    }))
  })

  const closeRemoteEditor = useMemoizedFn(() => {
    remoteEditorBaselineContentRef.current = ''
    setRemoteEditor(createIdleRemoteEditorState())
  })

  const sendRawTerminalData = useCallback(
    (text: string): boolean => {
      if (!text || !readyRef.current || !sessionIdRef.current) return false
      return sendProtocolMessage('TERMINAL_DATA', text)
    },
    [sendProtocolMessage],
  )

  const sendBridgeCommand = useCallback(
    (buildCommand: (requestId: string) => string): Promise<RemoteEditorBridgeResult> => {
      if (!readyRef.current || !sessionIdRef.current) {
        return Promise.reject(new Error('终端尚未就绪，无法读取远端文件。'))
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const command = buildCommand(requestId)

      return new Promise<RemoteEditorBridgeResult>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          pendingBridgeRequestsRef.current.delete(requestId)
          activeBridgeRequestIdsRef.current.delete(requestId)
          bridgePayloadBufferRef.current.delete(requestId)
          reject(new Error('等待远端文件响应超时，请稍后重试。'))
        }, REMOTE_EDITOR_TIMEOUT_MS)

        pendingBridgeRequestsRef.current.set(requestId, { resolve, reject, timeoutId })
        activeBridgeRequestIdsRef.current.add(requestId)

        const sent = sendRawTerminalData(`${command}\r`)
        if (!sent) {
          window.clearTimeout(timeoutId)
          pendingBridgeRequestsRef.current.delete(requestId)
          activeBridgeRequestIdsRef.current.delete(requestId)
          reject(new Error('发送远端文件命令失败，连接可能已经断开。'))
        }
      })
    },
    [sendRawTerminalData],
  )

  const finalizeBridgeRequest = useCallback((requestId: string, payload: Partial<Record<BridgeFieldName, string>>) => {
    const pending = pendingBridgeRequestsRef.current.get(requestId)
    if (!pending) return

    pendingBridgeRequestsRef.current.delete(requestId)
    activeBridgeRequestIdsRef.current.delete(requestId)
    suppressPromptEchoUntilRef.current = Date.now() + 400
    bridgePayloadBufferRef.current.delete(requestId)
    window.clearTimeout(pending.timeoutId)

    pending.resolve({
      ok: payload.ok === 'true',
      completionItems: payload.completionItem ? payload.completionItem.split('\u0000') : undefined,
      completionMode:
        payload.completionMode === 'single' || payload.completionMode === 'multiple' || payload.completionMode === 'none'
          ? payload.completionMode
          : undefined,
      op: payload.op === 'write' ? 'write' : 'read',
      path: payload.path ?? '',
      checksum: payload.checksum,
      content: payload.contentChunk ? decodeBase64(payload.contentChunk) : undefined,
      error: payload.error,
    })
  }, [])

  const writeTerminalText = useMemoizedFn((text: string) => {
    if (suppressTerminalOutput) return
    if (!text) return
    const sanitized = sanitizeTerminalDisplayChunk(text, terminalNoiseCarryRef.current)
    terminalNoiseCarryRef.current = sanitized.carry
    if (sanitized.text) {
      appendTerminalTranscript(sanitized.text)
      terminalRef.current?.write(sanitized.text)
    }
  })

  const writeDisplayText = useMemoizedFn((text: string, readyReason?: string) => {
    writeTerminalText(text)
    if (readyReason) markReady(readyReason)
  })

  const consumeBridgeOutput = useMemoizedFn((text: string): string => {
    const combined = `${bridgeLineCarryRef.current}${text}`
    const lines = combined.split(/\r?\n/)
    bridgeLineCarryRef.current = lines.pop() ?? ''

    const visibleLines: string[] = []

    lines.forEach((line) => {
      const normalizedLine = normalizeBridgeCandidate(line)
      const matches = normalizedLine.match(BRIDGE_LINE_PATTERN)
      if (!matches?.length) {
        visibleLines.push(line)
        return
      }

      matches.forEach((match) => {
        const parsed = parseBridgeLine(match)
        if (!parsed) return

        const current = bridgePayloadBufferRef.current.get(parsed.requestId) ?? {}
        if (parsed.field === 'contentChunk') {
          current.contentChunk = `${current.contentChunk ?? ''}${parsed.value}`
        } else if (parsed.field === 'completionItem') {
          current.completionItem = `${current.completionItem ?? ''}\u0000${parsed.value}`
        } else {
          current[parsed.field] = parsed.value
        }
        bridgePayloadBufferRef.current.set(parsed.requestId, current)

        if (parsed.field === 'phase' && parsed.value.startsWith(REMOTE_EDITOR_END_TOKEN)) {
          finalizeBridgeRequest(parsed.requestId, current)
        }
      })
    })

    return visibleLines.join('\n')
  })

  const writeTerminalData = useMemoizedFn((text: string, readyReason?: string) => {
    if (suppressTerminalOutput) {
      consumeBridgeOutput(text)
      if (readyReason) markReady(readyReason)
      return
    }

    const visibleText = consumeBridgeOutput(text)
    const hasActiveBridgeRequest = activeBridgeRequestIdsRef.current.size > 0
    if (hasActiveBridgeRequest) {
      if (readyReason) markReady(readyReason)
      return
    }

    const suppressPromptEcho =
      Date.now() < suppressPromptEchoUntilRef.current &&
      normalizeBridgeCandidate(visibleText).replace(/\]0;[^\r\n]*/g, '').trim().match(/^(\[[^\]]+\]\s*)+$/)

    if (suppressPromptEcho) {
      if (readyReason) markReady(readyReason)
      return
    }

    if (visibleText) {
      writeDisplayText(visibleText, readyReason)
      return
    }

    if (readyReason) markReady(readyReason)
  })

  const openRemoteEditor = useMemoizedFn(async (filePath: string) => {
    setRemoteEditor({
      visible: true,
      filePath,
      content: '',
      checksum: '',
      isDirty: false,
      isLoading: true,
      isSaving: false,
      errorText: '',
    })

    try {
      const result = await sendBridgeCommand((requestId) => buildRemoteEditorReadCommand(filePath, requestId))
      if (!result.ok) {
        throw new Error(result.error || '读取远端文件失败。')
      }

      remoteEditorBaselineContentRef.current = result.content ?? ''

      setRemoteEditor({
        visible: true,
        filePath: result.path || filePath,
        content: result.content ?? '',
        checksum: result.checksum ?? '',
        isDirty: false,
        isLoading: false,
        isSaving: false,
        errorText: '',
      })
      writeTerminalText(`\r\n[local] 已打开编辑器：${filePath}\r\n`)
    } catch (error) {
      const detail = getErrorMessage(error, '读取远端文件失败。')
      setRemoteEditor((current) => ({
        ...current,
        visible: true,
        filePath,
        isLoading: false,
        errorText: detail,
      }))
      writeTerminalText(`\r\n[local] 打开编辑器失败：${detail}\r\n`)
    }
  })

  const completeRemotePath = useMemoizedFn(
    async (inputPath: string): Promise<{ mode: 'single' | 'multiple' | 'none'; path?: string; items: string[] }> => {
      const normalizedPath = inputPath.trim()
      if (!normalizedPath) {
        return { mode: 'none', items: [] }
      }

      const result = await sendBridgeCommand((requestId) => buildRemotePathCompletionCommand(normalizedPath, requestId))
      if (!result.ok) {
        throw new Error(result.error || '远端路径补全失败。')
      }

      return {
        mode: result.completionMode ?? 'none',
        path: result.path || undefined,
        items: result.completionItems ?? [],
      }
    },
  )

  const saveRemoteEditor = useMemoizedFn(async (): Promise<boolean> => {
    const currentEditor = remoteEditorRef.current
    if (!currentEditor.visible || currentEditor.isLoading || currentEditor.isSaving) return false

    setRemoteEditor((current) => ({ ...current, isSaving: true, errorText: '' }))

    try {
      const result = await sendBridgeCommand((requestId) =>
        buildRemoteEditorWriteCommand(
          {
            filePath: currentEditor.filePath,
            content: currentEditor.content,
            checksum: currentEditor.checksum,
          },
          requestId,
        ),
      )

      if (!result.ok) {
        throw new Error(result.error || '保存远端文件失败。')
      }

      setRemoteEditor((current) => ({
        ...current,
        checksum: result.checksum ?? current.checksum,
        isDirty: false,
        isSaving: false,
        errorText: '',
      }))
      remoteEditorBaselineContentRef.current = currentEditor.content
      writeTerminalText(`\r\n[local] 保存成功：${currentEditor.filePath}\r\n`)
      return true
    } catch (error) {
      const detail = getErrorMessage(error, '保存远端文件失败。')
      setRemoteEditor((current) => ({ ...current, isSaving: false, errorText: detail }))
      writeTerminalText(`\r\n[local] 保存失败：${detail}\r\n`)
      return false
    }
  })

  const insertCommandText = useMemoizedFn((command: string): boolean => {
    const normalizedCommand = command.trim()
    if (!normalizedCommand) return false
    terminalRef.current?.focus()
    return sendRawTerminalData(command)
  })

  const updateTransferProgress = useCallback((params: {
    phase: ZmodemTransferState['phase']
    direction: ZmodemTransferDirection
    fileName: string
    transferredBytes: number
    totalBytes: number
    message: string
    saveMode?: ZmodemDownloadSaveMode
    saveModeMessage?: string
  }) => {
    const {
      direction,
      fileName,
      message,
      phase: nextPhase,
      saveMode,
      saveModeMessage,
      totalBytes,
      transferredBytes,
    } = params
    setZmodemTransfer((current) => ({
      phase: nextPhase,
      direction,
      fileName,
      transferredBytes,
      totalBytes,
      percent: toPercent(transferredBytes, totalBytes),
      message,
      saveMode: saveMode ?? (direction === 'download' ? current.saveMode : 'none'),
      saveModeMessage: saveModeMessage ?? (direction === 'download' ? current.saveModeMessage : ''),
    }))
  }, [])

  const disconnectSocket = useCallback(
    (reason: string, manual = false) => {
      const socket = websocketRef.current
      if (!socket) return

      if (manual) {
        setPhase('closing')
        setStatusText('正在断开连接...')
      }

      if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
        try {
          socket.send(JSON.stringify({ id: sessionIdRef.current, type: 'CLOSE', data: '' }))
        } catch {
          pushEvent('发送 CLOSE 失败，继续断开。')
        }
      }

      try {
        socket.close(1000, reason)
      } catch {
        pushEvent('关闭 websocket 失败。')
      }
    },
    [pushEvent],
  )

  const sendTerminalResize = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal || !sessionIdRef.current) return
    sendProtocolMessage('TERMINAL_RESIZE', JSON.stringify({ cols: terminal.cols, rows: terminal.rows }))
  }, [sendProtocolMessage])

  const fitAndResize = useCallback(() => {
    const fitAddon = fitAddonRef.current
    if (!fitAddon) return
    fitAddon.fit()
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null
      sendTerminalResize()
    }, 120)
  }, [sendTerminalResize])

  const markReady = useCallback(
    (reason: string) => {
      if (readyRef.current) return
      setTerminalInputEnabled(true)
      setPhase('ready')
      setStatusText(`终端已就绪：${reason}`)
      pushEvent(`READY: ${reason}`)
      terminalRef.current?.focus()
      if (readyHintTimerRef.current !== null) {
        window.clearTimeout(readyHintTimerRef.current)
        readyHintTimerRef.current = null
      }
    },
    [pushEvent, setTerminalInputEnabled],
  )

  const feedRawToTerminal = useCallback((rawInput: unknown) => {
    const octets = toOctetArray(rawInput)
    if (!octets.length) return
    writeTerminalText(new TextDecoder().decode(new Uint8Array(octets)))
  }, [writeTerminalText])

  const toPayloadBlob = useCallback((payloads: unknown): Blob => {
    const bufferList: BlobPart[] = payloads instanceof ArrayBuffer
      ? [new Uint8Array(payloads)]
      : Array.isArray(payloads)
        ? payloads.map((chunk) => {
            if (chunk instanceof Uint8Array) {
              const copied = new Uint8Array(chunk.byteLength)
              copied.set(chunk)
              return copied
            }
            if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
            if (Array.isArray(chunk)) return new Uint8Array(chunk)
            return new Uint8Array(0)
          })
        : []
    return new Blob(bufferList)
  }, [])

  const handleDownloadWorkerMessage = useMemoizedFn((event: MessageEvent<unknown>) => {
    if (!isZmodemDownloadWorkerResponse(event.data)) return

    const message: ZmodemDownloadWorkerResponse = event.data
    const pending = pendingDownloadAssemblyRequestsRef.current.get(message.transferId)
    if (!pending) return

    pendingDownloadAssemblyRequestsRef.current.delete(message.transferId)
    activeDownloadTransferIdsRef.current.delete(message.transferId)
    clearDownloadChunkBatch(message.transferId)
    clearDownloadProgressState(message.transferId)
    window.clearTimeout(pending.timeoutId)

    if (message.type === 'error') {
      pending.reject(new Error(message.message || 'ZMODEM 文件合并失败'))
      return
    }

    pending.resolve({
      buffer: message.buffer,
      totalBytes: message.totalBytes,
    })
  })

  const ensureDownloadWorker = useCallback((): Worker => {
    const existing = zmodemDownloadWorkerRef.current
    if (existing) return existing

    const worker = new Worker(new URL('../features/koko/zmodem-download.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event) => {
      handleDownloadWorkerMessage(event)
    }
    worker.onerror = (event) => {
      const detail = event.message || 'ZMODEM Worker 处理失败'
      resetDownloadAssemblyWorker(detail)
    }

    zmodemDownloadWorkerRef.current = worker
    return worker
  }, [clearDownloadChunkBatch, clearDownloadProgressState, handleDownloadWorkerMessage, resetDownloadAssemblyWorker])

  const beginDownloadAssembly = useCallback((transferId: string) => {
    const worker = ensureDownloadWorker()
    activeDownloadTransferIdsRef.current.add(transferId)
    pendingDownloadChunkBatchesRef.current.set(transferId, {
      bufferedBytes: 0,
      chunks: [],
      flushTimerId: null,
    })
    downloadProgressStateRef.current.set(transferId, {
      lastFlushAt: 0,
      lastPhase: 'idle',
      lastProgressBucket: -1,
    })
    worker.postMessage({
      type: 'reset',
      transferId,
    })
  }, [ensureDownloadWorker])

  const flushDownloadChunks = useCallback((transferId: string) => {
    const worker = ensureDownloadWorker()
    const batch = pendingDownloadChunkBatchesRef.current.get(transferId)
    if (!batch || batch.chunks.length === 0) return

    const chunks = batch.chunks
    batch.chunks = []
    batch.bufferedBytes = 0
    if (batch.flushTimerId !== null) {
      window.clearTimeout(batch.flushTimerId)
      batch.flushTimerId = null
    }

    worker.postMessage(
      {
        type: 'append-batch',
        transferId,
        chunks,
      },
      chunks,
    )
  }, [ensureDownloadWorker])

  const appendDownloadChunk = useCallback((transferId: string, chunk: Uint8Array) => {
    const batch = pendingDownloadChunkBatchesRef.current.get(transferId)
    if (!batch) return

    const buffer = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
      ? chunk.buffer
      : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)

    batch.chunks.push(buffer as ArrayBuffer)
    batch.bufferedBytes += buffer.byteLength

    if (batch.bufferedBytes >= DOWNLOAD_CHUNK_BATCH_BYTES) {
      flushDownloadChunks(transferId)
      return
    }

    if (batch.flushTimerId !== null) return

    batch.flushTimerId = window.setTimeout(() => {
      flushDownloadChunks(transferId)
    }, DOWNLOAD_CHUNK_BATCH_INTERVAL_MS)
  }, [flushDownloadChunks])

  const finalizeDownloadAssembly = useCallback((transferId: string, payloads: unknown) => {
    const worker = ensureDownloadWorker()
    void payloads
    flushDownloadChunks(transferId)

    return new Promise<{ buffer: ArrayBuffer; totalBytes: number }>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingDownloadAssemblyRequestsRef.current.delete(transferId)
        activeDownloadTransferIdsRef.current.delete(transferId)
        clearDownloadChunkBatch(transferId)
        clearDownloadProgressState(transferId)
        worker.postMessage({
          type: 'abort',
          transferId,
        })
        reject(new Error('等待下载合并结果超时，请稍后重试。'))
      }, DOWNLOAD_ASSEMBLY_TIMEOUT_MS)

      pendingDownloadAssemblyRequestsRef.current.set(transferId, { resolve, reject, timeoutId })

      worker.postMessage(
        {
          type: 'finalize',
          transferId,
        },
      )
    })
  }, [clearDownloadChunkBatch, clearDownloadProgressState, ensureDownloadWorker, flushDownloadChunks])

  const saveFileByBrowserDownload = useCallback((payloads: unknown, fileName: string) => {
    const blob = toPayloadBlob(payloads)
    const url = URL.createObjectURL(blob)
    pendingObjectUrlsRef.current.add(url)
    const anchor = document.createElement('a')
    anchor.style.display = 'none'
    anchor.href = url
    anchor.download = fileName || 'download.bin'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }, [toPayloadBlob])

  const getDownloadSavingMessage = useCallback((saveMode: ZmodemDownloadSaveMode, fileName: string) => {
    if (saveMode === 'directory-picker') {
      return `接收完成，正在写入所选目录：${fileName}`
    }

    return `接收完成，正在触发浏览器下载：${fileName}`
  }, [])

  const writeDownloadStatusToTerminal = useMemoizedFn((params: {
    phase: ZmodemTransferState['phase']
    fileName: string
    transferredBytes: number
    totalBytes: number
    message: string
  }) => {
    const state = {
      lastPhase: lastDownloadTerminalPhaseRef.current,
      lastProgressBucket: lastDownloadProgressBucketRef.current,
    }

    writeTerminalTransferStatus(params, state, writeTerminalText, {
      prefix: 'sz',
      startVerb: '开始下载',
      progressVerb: '下载进度',
      completeVerb: '下载完成',
      failVerb: '下载失败',
      progressPhase: 'receiving',
    })

    lastDownloadTerminalPhaseRef.current = state.lastPhase
    lastDownloadProgressBucketRef.current = state.lastProgressBucket
  })

  const writeUploadStatusToTerminal = useMemoizedFn((params: {
    phase: ZmodemTransferState['phase']
    fileName: string
    transferredBytes: number
    totalBytes: number
    message: string
  }) => {
    const state = {
      lastPhase: lastUploadTerminalPhaseRef.current,
      lastProgressBucket: lastUploadProgressBucketRef.current,
    }

    writeTerminalTransferStatus(params, state, writeTerminalText, {
      prefix: 'rz',
      startVerb: '开始上传',
      progressVerb: '上传进度',
      completeVerb: '上传完成',
      failVerb: '上传失败',
      progressPhase: 'sending',
    })

    lastUploadTerminalPhaseRef.current = state.lastPhase
    lastUploadProgressBucketRef.current = state.lastProgressBucket
  })

  const shouldFlushDownloadProgress = useCallback((transferId: string, snapshot: DownloadProgressSnapshot): boolean => {
    const current = downloadProgressStateRef.current.get(transferId)
    if (!current) return true

    if (snapshot.phase !== current.lastPhase) return true
    if (snapshot.phase !== 'receiving') return true

    const now = Date.now()
    const nextProgressBucket = snapshot.totalBytes > 0
      ? Math.floor((Math.max(0, Math.min(snapshot.transferredBytes / snapshot.totalBytes, 1)) * 100) / 2)
      : current.lastProgressBucket

    return now - current.lastFlushAt >= DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS || nextProgressBucket > current.lastProgressBucket
  }, [])

  const flushDownloadProgress = useCallback((transferId: string, snapshot: DownloadProgressSnapshot) => {
    const progressBucket = snapshot.totalBytes > 0
      ? Math.floor((Math.max(0, Math.min(snapshot.transferredBytes / snapshot.totalBytes, 1)) * 100) / 2)
      : -1

    downloadProgressStateRef.current.set(transferId, {
      lastFlushAt: Date.now(),
      lastPhase: snapshot.phase,
      lastProgressBucket: progressBucket,
    })

    updateTransferProgress({
      phase: snapshot.phase,
      direction: 'download',
      fileName: snapshot.fileName,
      transferredBytes: snapshot.transferredBytes,
      totalBytes: snapshot.totalBytes,
      message: snapshot.message,
    })

    writeDownloadStatusToTerminal({
      phase: snapshot.phase,
      fileName: snapshot.fileName,
      transferredBytes: snapshot.transferredBytes,
      totalBytes: snapshot.totalBytes,
      message: snapshot.message,
    })
  }, [updateTransferProgress, writeDownloadStatusToTerminal])

  const pickDownloadTarget = useCallback(async (): Promise<{
    saveMode: ZmodemDownloadSaveMode
    saveModeMessage: string
    save: (payloads: unknown, fileName: string) => Promise<void>
  }> => {
    const fallback = {
      saveMode: 'browser-download' as const,
      saveModeMessage: '已使用浏览器下载保存（当前浏览器不支持或未选择目录）',
      save: async (payloads: unknown, fileName: string) => {
        saveFileByBrowserDownload(payloads, fileName)
      },
    }

    const browserWindow = window as DirectoryPickerCapableWindow
    if (!browserWindow.showDirectoryPicker) return fallback

    try {
      const directoryHandle = await browserWindow.showDirectoryPicker()
      return {
        saveMode: 'directory-picker',
        saveModeMessage: '已选择本地目录，文件将直接写入该目录',
        save: async (payloads: unknown, fileName: string) => {
          const fileHandle = await directoryHandle.getFileHandle(fileName || 'download.bin', { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(toPayloadBlob(payloads))
          await writable.close()
        },
      }
    } catch {
      return fallback
    }
  }, [saveFileByBrowserDownload, toPayloadBlob])

  const bindReceiveSession = useCallback((session: ZmodemSessionLike) => {
    session.on('offer', (rawOffer: unknown) => {
      void (async () => {
        const offer = rawOffer as ZmodemOfferLike
        const details = offer.get_details()
        const name = details.name ?? 'download.bin'
        const size = details.size ?? 0
        const downloadTarget = await pickDownloadTarget()

        updateTransferProgress({
          phase: 'receiving',
          direction: 'download',
          fileName: name,
          transferredBytes: 0,
          totalBytes: size,
          message: `开始接收 ${name}`,
          saveMode: downloadTarget.saveMode,
          saveModeMessage: downloadTarget.saveModeMessage,
        })
        writeDownloadStatusToTerminal({
          phase: 'receiving',
          fileName: name,
          transferredBytes: 0,
          totalBytes: size,
          message: `开始接收 ${name}`,
        })

        const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        beginDownloadAssembly(transferId)
        flushDownloadProgress(transferId, {
          phase: 'receiving',
          fileName: name,
          transferredBytes: 0,
          totalBytes: size,
          message: `开始接收 ${name}`,
        })

        offer.on('input', (rawPayload: unknown) => {
          const payload = rawPayload instanceof Uint8Array ? rawPayload : new Uint8Array(toOctetArray(rawPayload))
          const currentOffset = offer.get_offset()
          const fallbackTotal = size || currentOffset
          const transferPhase = size > 0 && currentOffset >= size ? 'saving' : 'receiving'
          const transferMessage =
            transferPhase === 'saving'
              ? '数据接收完成，正在整理文件...'
              : `接收中：${name}`

          const snapshot: DownloadProgressSnapshot = {
            phase: transferPhase,
            fileName: name,
            transferredBytes: currentOffset,
            totalBytes: fallbackTotal,
            message: transferMessage,
          }

          if (shouldFlushDownloadProgress(transferId, snapshot)) {
            flushDownloadProgress(transferId, snapshot)
          }

          if (!payload.length) return

          appendDownloadChunk(transferId, payload)
        })

        void offer
          .accept()
          .then(async (payloads) => {
            const { buffer: finalBuffer, totalBytes: totalPayloadBytes } = await finalizeDownloadAssembly(transferId, payloads)

            if (totalPayloadBytes <= 0) {
              const detail = `下载失败：${name} 内容为空`
              setErrorText(detail)
              updateTransferProgress({
                phase: 'error',
                direction: 'download',
                fileName: name,
                transferredBytes: offer.get_offset(),
                totalBytes: size || offer.get_offset(),
                message: detail,
                saveMode: downloadTarget.saveMode,
                saveModeMessage: downloadTarget.saveModeMessage,
              })
              writeDownloadStatusToTerminal({
                phase: 'error',
                fileName: name,
                transferredBytes: offer.get_offset(),
                totalBytes: size || offer.get_offset(),
                message: detail,
              })
              pushEvent(`ZMODEM 下载失败：${detail}`)
              return
            }

            let finalSaveMode = downloadTarget.saveMode
            let finalSaveModeMessage = downloadTarget.saveModeMessage
            const finalOffset = offer.get_offset()
            const total = size || finalOffset

            flushDownloadProgress(transferId, {
              phase: 'saving',
              fileName: name,
              transferredBytes: finalOffset,
              totalBytes: total,
              message: getDownloadSavingMessage(downloadTarget.saveMode, name),
            })
            updateTransferProgress({
              phase: 'saving',
              direction: 'download',
              fileName: name,
              transferredBytes: finalOffset,
              totalBytes: total,
              message: getDownloadSavingMessage(downloadTarget.saveMode, name),
              saveMode: finalSaveMode,
              saveModeMessage: finalSaveModeMessage,
            })

            try {
              await downloadTarget.save(finalBuffer, name)
            } catch {
              saveFileByBrowserDownload(finalBuffer, name)
              finalSaveMode = 'browser-download'
              finalSaveModeMessage = '目录写入失败，已自动回退为浏览器下载保存'
            }

            flushDownloadProgress(transferId, {
              phase: 'completed',
              fileName: name,
              transferredBytes: finalOffset,
              totalBytes: total,
              message: `下载完成：${name}`,
            })
            updateTransferProgress({
              phase: 'completed',
              direction: 'download',
              fileName: name,
              transferredBytes: finalOffset,
              totalBytes: total,
              message: `下载完成：${name}`,
              saveMode: finalSaveMode,
              saveModeMessage: finalSaveModeMessage,
            })
            pushEvent(`ZMODEM 下载完成：${name}`)
          })
          .catch((error: unknown) => {
            resetDownloadAssemblyWorker('下载失败，已取消后台合并任务。')
            const detail = safeString(error) || '下载失败'
            setErrorText(detail)
            updateTransferProgress({
              phase: 'error',
              direction: 'download',
              fileName: name,
              transferredBytes: offer.get_offset(),
              totalBytes: size,
              message: detail,
              saveMode: downloadTarget.saveMode,
              saveModeMessage: downloadTarget.saveModeMessage,
            })
            writeDownloadStatusToTerminal({
              phase: 'error',
              fileName: name,
              transferredBytes: offer.get_offset(),
              totalBytes: size,
              message: detail,
            })
            pushEvent(`ZMODEM 下载失败：${detail}`)
          })
      })()
    })

    session.on('session_end', () => {
      zmodemSessionRef.current = null
      pushEvent('ZMODEM 会话结束')
    })

    void session.start?.().catch((error: unknown) => {
      const detail = safeString(error) || '接收会话启动失败'
      setErrorText(detail)
      updateTransferProgress({
        phase: 'error',
        direction: 'download',
        fileName: '',
        transferredBytes: 0,
        totalBytes: 0,
        message: detail,
      })
      pushEvent(`ZMODEM 接收会话启动失败：${detail}`)
    })
  }, [
    appendDownloadChunk,
    beginDownloadAssembly,
    finalizeDownloadAssembly,
    getDownloadSavingMessage,
    pickDownloadTarget,
    pushEvent,
    resetDownloadAssemblyWorker,
    saveFileByBrowserDownload,
    setErrorText,
    updateTransferProgress,
    writeDownloadStatusToTerminal,
  ])

  const attachZmodemSentry = useCallback((socket: WebSocket) => {
    const zmodem = getZmodem()
    if (!zmodem) {
      pushEvent('ZMODEM 未加载，跳过 ZMODEM Sentry 初始化')
      return
    }

    const sentry = new zmodem.Sentry({
      to_terminal: (octets: unknown) => {
        if (zmodemSessionRef.current) return
        feedRawToTerminal(octets)
      },
      sender: (octets: unknown) => {
        if (socket.readyState !== WebSocket.OPEN) return
        const payload = toOctetArray(octets)
        if (!payload.length) return
        socket.send(new Uint8Array(payload))
      },
      on_detect: (rawDetection: unknown) => {
        const detection = rawDetection as ZmodemDetectionLike
        const session = detection.confirm()
        zmodemSessionRef.current = session

        if (session.type === 'send') {
          updateTransferProgress({
            phase: 'waiting-upload',
            direction: 'upload',
            fileName: '',
            transferredBytes: 0,
            totalBytes: 0,
            message: '检测到 rz，等待选择本地文件上传',
          })
          pushEvent('检测到 rz，会话已就绪，等待上传文件')
        } else {
          pushEvent('检测到 sz，开始接收文件')
          bindReceiveSession(session)
        }
      },
      on_retract: () => {
        zmodemSessionRef.current = null
        setZmodemTransfer((current) =>
          current.phase === 'idle'
            ? current
            : {
                ...createIdleTransferState(),
                message: 'ZMODEM 会话被撤回',
              },
        )
        pushEvent('ZMODEM 检测撤回')
      },
    })

    zmodemSentryRef.current = sentry
  }, [bindReceiveSession, feedRawToTerminal, pushEvent, updateTransferProgress])

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const zmodem = getZmodem()
    if (!zmodem) {
      setErrorText('ZMODEM 组件未加载完成，请刷新页面后重试。')
      return false
    }

    const currentSession = zmodemSessionRef.current
    if (!currentSession || currentSession.type !== 'send') {
      setErrorText('当前没有可用的 rz 上传会话，请先在远端执行 rz。')
      return false
    }

    const normalizedFiles = Array.from(files)
    if (!normalizedFiles.length) return false

    try {
      await zmodem.Browser.send_files(currentSession, normalizedFiles, {
        on_offer_response: (rawFile: unknown, transfer?: unknown) => {
          const file = rawFile as File
          if (!transfer) {
            pushEvent(`远端跳过文件：${file.name}`)
            return
          }

          updateTransferProgress({
            phase: 'sending',
            direction: 'upload',
            fileName: file.name,
            transferredBytes: 0,
            totalBytes: file.size,
            message: `开始上传：${file.name}`,
          })
          writeUploadStatusToTerminal({
            phase: 'sending',
            fileName: file.name,
            transferredBytes: 0,
            totalBytes: file.size,
            message: `开始上传：${file.name}`,
          })
        },
        on_file_complete: (rawFile: unknown, rawTransfer: unknown) => {
          const file = rawFile as File
          const transfer = rawTransfer as ZmodemTransferLike
          const done = transfer.get_offset()
          updateTransferProgress({
            phase: 'completed',
            direction: 'upload',
            fileName: file.name,
            transferredBytes: done,
            totalBytes: file.size || done,
            message: `上传完成：${file.name}`,
          })
          writeUploadStatusToTerminal({
            phase: 'completed',
            fileName: file.name,
            transferredBytes: done,
            totalBytes: file.size || done,
            message: `上传完成：${file.name}`,
          })
          pushEvent(`ZMODEM 上传完成：${file.name}`)
        },
      })

      await currentSession.close?.()
      zmodemSessionRef.current = null
      pushEvent('rz 上传会话关闭')
      return true
    } catch (error) {
      const detail = safeString(error) || '上传失败'
      setErrorText(detail)
      setZmodemTransfer((current) => ({
        ...current,
        phase: 'error',
        message: detail,
      }))
      writeUploadStatusToTerminal({
        phase: 'error',
        fileName: '',
        transferredBytes: 0,
        totalBytes: 0,
        message: detail,
      })
      pushEvent(`ZMODEM 上传失败：${detail}`)
      return false
    }
  }, [pushEvent, setErrorText, updateTransferProgress, writeUploadStatusToTerminal])

  const cancelRzUpload = useCallback(async () => {
    const session = zmodemSessionRef.current
    if (!session || session.type !== 'send') {
      setZmodemTransfer(createIdleTransferState())
      return
    }

    try {
      session.abort?.()
      await session.close?.()
      pushEvent('rz 上传已取消')
    } catch (error) {
      pushEvent(`取消 rz 上传失败：${safeString(error) || 'unknown'}`)
    } finally {
      zmodemSessionRef.current = null
      setZmodemTransfer(createIdleTransferState())
    }
  }, [pushEvent])

  const handleTerminalAction = useCallback((action: unknown): boolean => {
    const actionText = safeString(action).trim().toUpperCase()
    if (!actionText) return false

    if (actionText === 'ZMODEM_START') {
      pushEvent('收到 ZMODEM_START，已切换至上传交互弹窗')
      return true
    }

    if (actionText === 'ZMODEM_END') {
      writeTerminalText('\r\n')
      pushEvent('收到 ZMODEM_END，已结束本次 ZMODEM 终端提示')
      return true
    }

    return false
  }, [pushEvent, writeTerminalText])

  const dispatchProtocolMessage = useCallback(
    (message: ProtocolMessage) => {
      const messageType = (message.type ?? '').toUpperCase()

      if (messageType === 'CONNECT') {
        const id = message.id ?? ''
        if (!id) {
          setPhase('error')
          setErrorText('收到 CONNECT，但缺少 id，无法继续初始化。')
          pushEvent('CONNECT 缺少 id')
          disconnectSocket('Missing id from CONNECT')
          return
        }
        sessionIdRef.current = id
        setSessionId(id)
        setPhase('initializing')
        setStatusText('已收到 CONNECT，发送 TERMINAL_INIT...')
        pushEvent(`CONNECT id=${id}`)

        if (handshakeTimerRef.current !== null) {
          window.clearTimeout(handshakeTimerRef.current)
          handshakeTimerRef.current = null
        }

        const terminal = terminalRef.current
        const cols = terminal?.cols ?? 120
        const rows = terminal?.rows ?? 30
        sendProtocolMessage('TERMINAL_INIT', JSON.stringify({ cols, rows }), id)
        pushEvent(`发送 TERMINAL_INIT cols=${cols}, rows=${rows}`)

        if (readyHintTimerRef.current !== null) window.clearTimeout(readyHintTimerRef.current)
        readyHintTimerRef.current = window.setTimeout(() => {
          if (!readyRef.current) {
            setStatusText('连接已建立，但尚未收到就绪信号，可能是协议或认证差异。')
            pushEvent('等待 READY 提示超时')
          }
        }, READY_HINT_TIMEOUT_MS)
        return
      }

      if (messageType === 'TERMINAL_SESSION') {
        markReady('收到 TERMINAL_SESSION')
        return
      }

      if (['TERMINAL_SHARE_USERS', 'TERMINAL_SHARE_JOIN'].includes(messageType)) {
        return
      }

      if (messageType === 'TERMINAL_DATA') {
        const payload = safeString(message.data)
        if (payload) {
          writeTerminalData(payload, '收到 TERMINAL_DATA')
          return
        }

        markReady('收到 TERMINAL_DATA')
        return
      }
      if (messageType === 'TERMINAL_ACTION' && handleTerminalAction(message.data)) {
        return
      }
      if (messageType === 'PING') {
        sendProtocolMessage('PONG', '')
        pushEvent('收到 PING，已回 PONG')
        return
      }
      if (messageType === 'ERROR' || messageType === 'TERMINAL_ERROR') {
        const detail = message.err || safeString(message.data) || '服务端返回错误'
        setPhase('error')
        setErrorText(detail)
        setStatusText('连接已建立，但服务端报错。')
        pushEvent(`错误：${detail}`)
        writeTerminalText(`\r\n[ERROR] ${detail}\r\n`)
        return
      }
      if (messageType === 'CLOSE') {
        setStatusText('服务端要求关闭连接。')
        pushEvent('收到服务端 CLOSE')
        disconnectSocket('Server requested close')
        return
      }
      if (messageType === 'TERMINAL_RESIZE') {
        pushEvent('收到 TERMINAL_RESIZE')
        return
      }

      if (message.data !== undefined) {
        const text = safeString(message.data)
        if (text) {
          writeTerminalData(text, `收到 ${messageType || 'UNKNOWN'} 数据`)
        }
      }
      pushEvent(`收到消息类型：${messageType || 'UNKNOWN'}`)
    },
    [disconnectSocket, handleTerminalAction, markReady, pushEvent, sendProtocolMessage, writeTerminalData, writeTerminalText],
  )

  const handleBinaryFrame = useCallback(
    async (frame: ArrayBuffer | Blob) => {
      const sentry = zmodemSentryRef.current as { consume: (input: ArrayBuffer) => void } | null
      const binary = frame instanceof Blob ? await frame.arrayBuffer() : frame
      const hasActiveBridgeRequest = activeBridgeRequestIdsRef.current.size > 0
      const decoded = await decodeFrameToString(binary)

      if (hasActiveBridgeRequest) {
        if (decoded) writeTerminalData(decoded, '收到原始二进制终端输出')
        return
      }

      if (decoded.includes(REMOTE_EDITOR_PREFIX)) {
        writeTerminalData(decoded, '收到原始二进制终端输出')
        return
      }

      if (sentry) {
        try {
          sentry.consume(binary)
          return
        } catch (error) {
          const detail = safeString(error) || 'ZMODEM 二进制消息处理失败'
          const activeSession = zmodemSessionRef.current

          if (activeSession?.type === 'receive') {
            pushEvent(`ZMODEM 接收中 consume 失败，忽略该二进制帧：${detail}`)
            return
          }

          activeSession?.abort?.()
          pushEvent(`ZMODEM 二进制处理失败，回退文本渲染：${detail}`)
        }
      }

      if (decoded) writeTerminalData(decoded, '收到原始二进制终端输出')
    },
    [pushEvent, writeTerminalData],
  )

  const consumeSocketFrame = useCallback(
    async (frame: string | ArrayBuffer | Blob) => {
      if (frame instanceof ArrayBuffer || frame instanceof Blob) {
        await handleBinaryFrame(frame)
        return
      }

      const asString = await decodeFrameToString(frame)
      const maybeProtocol = parseProtocolMessage(asString)
      if (maybeProtocol) {
        dispatchProtocolMessage(maybeProtocol)
        return
      }

      if (asString) {
        writeTerminalData(asString, '收到原始终端输出')
      }
    },
    [dispatchProtocolMessage, handleBinaryFrame, writeTerminalData],
  )

  const connectToUrl = useCallback((socketUrl: string) => {
    clearTimers()
    resetSession()
    resetZmodemSession()
    setCloseText('')
    setErrorText('')
    terminalRef.current?.clear()

    setPhase('connecting')
    setStatusText('正在创建 websocket 连接...')
    pushEvent(`连接地址：${socketUrl}`)

    const currentSocket = websocketRef.current
    if (currentSocket) {
      currentSocket.onopen = null
      currentSocket.onmessage = null
      currentSocket.onerror = null
      currentSocket.onclose = null
      currentSocket.close(1000, 'Replace socket')
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl, ['JMS-KOKO'])
    } catch {
      setPhase('error')
      setStatusText('创建 websocket 失败')
      setErrorText('无法创建 websocket，请检查浏览器策略和网络环境。')
      pushEvent('创建 websocket 失败')
      return
    }

    socket.binaryType = 'arraybuffer'
    websocketRef.current = socket
    attachZmodemSentry(socket)

    socket.onopen = () => {
      setPhase('waiting-connect')
      setStatusText('Socket 已连接，等待服务端 CONNECT...')
      pushEvent('WebSocket 已打开')

      if (handshakeTimerRef.current !== null) window.clearTimeout(handshakeTimerRef.current)
      handshakeTimerRef.current = window.setTimeout(() => {
        if (!sessionIdRef.current) {
          setPhase('error')
          setErrorText('连接已打开但未收到 CONNECT，可能是 token/认证或协议不匹配。')
          setStatusText('等待 CONNECT 超时')
          pushEvent('等待 CONNECT 超时，准备关闭连接')
          disconnectSocket('Missing CONNECT')
        }
      }, HANDSHAKE_TIMEOUT_MS)

      if (pingTimerRef.current !== null) window.clearInterval(pingTimerRef.current)
      pingTimerRef.current = window.setInterval(() => {
        sendProtocolMessage('PING', '')
      }, PING_INTERVAL_MS)
    }

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer | Blob>) => {
      void consumeSocketFrame(event.data)
    }

    socket.onerror = () => {
      setPhase('error')
      setStatusText('WebSocket 发生错误')
      setErrorText('网络异常或服务器拒绝连接，请检查 token、域名和认证状态。')
      pushEvent('WebSocket error')
    }

    socket.onclose = (event: CloseEvent) => {
      websocketRef.current = null
      clearTimers()
      clearPendingBridgeRequests('连接已关闭，编辑器请求已取消。')
      setTerminalInputEnabled(false)
      resetZmodemSession('socket close')
      setPhase((current) => (current === 'error' ? current : 'closed'))
      const detail = `code=${event.code}, clean=${event.wasClean ? 'yes' : 'no'}, reason=${event.reason || '(empty)'}`
      setCloseText(detail)
      setStatusText('连接已关闭')
      pushEvent(`连接关闭：${detail}`)
    }
  }, [
    clearPendingBridgeRequests,
    clearTimers,
    disconnectSocket,
    pushEvent,
    resetZmodemSession,
    resetSession,
    sendProtocolMessage,
    consumeSocketFrame,
    setTerminalInputEnabled,
    attachZmodemSentry,
  ])

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily: 'Consolas, Menlo, Monaco, monospace',
      fontSize: 14,
      theme: { background: '#0b1324', foreground: '#e2e8f0', cursor: '#f8fafc' },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    terminal.attachCustomKeyEventHandler((event) => {
      const isCopyCommand = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'c'
      const isPasteCommand = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v'
      if (isCopyCommand && terminal.hasSelection()) {
        return false
      }
      return !isPasteCommand
    })

    const onPaste = (event: ClipboardEvent) => {
      if (!readyRef.current || !sessionIdRef.current) return

      const pastedText = event.clipboardData?.getData('text') ?? ''
      if (!pastedText) return

      event.preventDefault()
      sendRawTerminalData(pastedText)
    }

    const container = terminalContainerRef.current
    if (container) {
      terminal.open(container)
      fitAddon.fit()
      container.addEventListener('paste', onPaste)
    }

    const inputDisposable = terminal.onData((text) => {
      if (!readyRef.current || !sessionIdRef.current) return
      sendRawTerminalData(text)
    })

    const resizeDisposable = terminal.onResize(() => {
      sendTerminalResize()
    })

    const observer = new ResizeObserver(() => {
      fitAndResize()
    })
    if (container) observer.observe(container)

    const onWindowResize = () => {
      fitAndResize()
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      if (container) {
        container.removeEventListener('paste', onPaste)
      }

      window.removeEventListener('resize', onWindowResize)
      observer.disconnect()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      clearTimers()
      clearPendingBridgeRequests('终端已卸载，编辑器请求已取消。')
      disconnectSocket('Unmount')
      resetZmodemSession('unmount')
      zmodemDownloadWorkerRef.current?.terminate()
      zmodemDownloadWorkerRef.current = null
      cleanupObjectUrls()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      websocketRef.current = null
    }
  }, [clearPendingBridgeRequests, clearTimers, cleanupObjectUrls, disconnectSocket, fitAndResize, resetZmodemSession, sendRawTerminalData, sendTerminalResize])

  const isBusy =
    phase === 'connecting' ||
    phase === 'waiting-connect' ||
    phase === 'initializing' ||
    phase === 'ready' ||
    phase === 'closing'

  const aiContextSnapshot: TerminalAiSourceSnapshot = {
    terminalTranscriptTail,
    remoteEditor: {
      visible: remoteEditor.visible,
      filePath: remoteEditor.filePath,
      content: remoteEditor.content,
      isDirty: remoteEditor.isDirty,
      isLoading: remoteEditor.isLoading,
      isSaving: remoteEditor.isSaving,
      errorText: remoteEditor.errorText,
    },
  }

  return {
    terminalContainerRef,
    phase,
    statusText,
    errorText,
    closeText,
    sessionId,
    eventLog,
    aiContextSnapshot,
    isBusy,
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
    disconnect: () => disconnectSocket('User disconnect', true),
  }
}
