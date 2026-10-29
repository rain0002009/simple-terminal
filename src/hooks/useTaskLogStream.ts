import { useEffect, useRef, useState } from 'react'
import { useMemoizedFn } from 'ahooks'
import { TASK_LOG_WS_ENDPOINT } from '../features/koko/constants'
import type { AccessKeySettings } from '../features/koko/types'

type TaskLogStreamStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

type UseTaskLogStreamOptions = {
  settings: AccessKeySettings
}

type UseTaskLogStreamResult = {
  status: TaskLogStreamStatus
  logText: string
  errorText: string
  connect: (taskId: string) => void
  disconnect: () => void
  clearLog: () => void
}

export const useTaskLogStream = ({ settings }: UseTaskLogStreamOptions): UseTaskLogStreamResult => {
  const socketRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<TaskLogStreamStatus>('idle')
  const [logText, setLogText] = useState('')
  const [errorText, setErrorText] = useState('')

  const disconnect = useMemoizedFn(() => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close(1000, 'client disconnect')
    }

    setStatus((current) => (current === 'idle' ? current : 'closed'))
  })

  const connect = useMemoizedFn((taskId: string) => {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) {
      setErrorText('请输入任务 ID 后再连接日志流。')
      setStatus('error')
      return
    }

    disconnect()
    setLogText('')
    setErrorText('')
    setStatus('connecting')

    if (!settings.accessKeyId.trim() || !settings.accessKeySecret.trim()) {
      setErrorText('请先配置 AK/AS 后再连接任务日志流。')
      setStatus('error')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socketUrl = new URL(TASK_LOG_WS_ENDPOINT, `${protocol}//${window.location.host}`)
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket

    socket.onopen = () => {
      if (socketRef.current !== socket) return
      socket.send(JSON.stringify({ task: normalizedTaskId, type: 'celery' }))
      setStatus('connected')
      setLogText((current) => `${current}[已连接任务日志：${normalizedTaskId}]\n`)
    }

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return

      const text = String(event.data)
      let message = text
      let eventName = ''

      try {
        const payload = JSON.parse(text) as { message?: string; event?: string }
        if (typeof payload.message === 'string') message = payload.message
        if (typeof payload.event === 'string') eventName = payload.event
      } catch {
        // use raw text when upstream payload is not json
      }

      if (eventName === 'end') {
        setLogText((current) => `${current}\n[日志流结束]\n`)
        setStatus('closed')
        socket.close(1000, 'task log ended')
        return
      }

      const clean = message
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
      if (!clean) return
      setLogText((current) => {
        const next = `${current}${clean}`
        return clean.endsWith('\n') ? next : `${next}\n`
      })
    }

    socket.onerror = () => {
      if (socketRef.current !== socket) return
      setErrorText('任务日志 WebSocket 连接异常')
      setStatus('error')
    }

    socket.onclose = (event) => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      setStatus((current) => (current === 'idle' || current === 'error' || current === 'closed' ? current : 'closed'))
      if ((event.code && event.code !== 1000) || event.reason) {
        setLogText((current) => `${current}\n[连接已关闭：${event.code || 'unknown'}${event.reason ? ` ${event.reason}` : ''}]\n`)
      }
    }
  })

  const clearLog = useMemoizedFn(() => {
    setLogText('')
    setErrorText('')
  })

  useEffect(() => () => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close(1000, 'component unmount')
    }
  }, [])

  return { status, logText, errorText, connect: (taskId: string) => void connect(taskId), disconnect, clearLog }
}
