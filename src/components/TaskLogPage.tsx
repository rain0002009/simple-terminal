import type { FC } from 'react'
import { useEffect, useRef } from 'react'
import { ClearOutlined, DisconnectOutlined, LinkOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, Button, Space, Tag, Typography } from 'antd'
import type { AccessKeySettings } from '../features/koko/types'
import { useTaskLogStream } from '../hooks/useTaskLogStream'

const { Title, Text } = Typography

type TaskLogPageProps = {
  taskId: string
  accessKeyConfigured: boolean
  settings: AccessKeySettings
  onOpenAccessKeyConfig: () => void
}

const statusMeta = {
  idle: { color: 'default', text: '未连接' },
  connecting: { color: 'processing', text: '连接中' },
  connected: { color: 'green', text: '日志流已连接' },
  closed: { color: 'default', text: '已断开' },
  error: { color: 'red', text: '连接异常' },
} as const

export const TaskLogPage: FC<TaskLogPageProps> = ({ taskId, accessKeyConfigured, settings, onOpenAccessKeyConfig }) => {
  const logPanelRef = useRef<HTMLPreElement | null>(null)
  const { status, logText, errorText, connect, disconnect, clearLog } = useTaskLogStream({ settings })
  const connected = status === 'connected' || status === 'connecting'
  const meta = statusMeta[status]

  useEffect(() => {
    if (!taskId) return
    connect(taskId)
    return () => {
      disconnect()
    }
  }, [connect, disconnect, taskId])

  useEffect(() => {
    const panel = logPanelRef.current
    if (!panel) return
    panel.scrollTop = panel.scrollHeight
  }, [logText])

  return (
    <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),_transparent_40%),linear-gradient(180deg,_#060b17_0%,_#0f172a_100%)] px-6 py-6 text-slate-100 max-md:px-4">
      <div className="mx-auto flex h-full max-w-[1320px] flex-col gap-4">
        <div className="rounded-[20px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.72)] p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur">
          <div className="flex items-start justify-between gap-4 max-md:flex-col">
            <div className="min-w-0 flex-1">
              <Space size={10} wrap>
                <Title level={3} className="!m-0 !text-slate-50">
                  任务日志
                </Title>
                <Tag color={meta.color}>{meta.text}</Tag>
                <Tag color="blue">任务：{taskId}</Tag>
              </Space>
              <div className="mt-2">
                <Text type="secondary" className="text-[13px] !text-slate-400">
                  通过同源 WebSocket 透明转发连接上游任务日志流，连接建立后由前端发送任务订阅消息。
                </Text>
              </div>
            </div>

            <Space wrap>
              <Button icon={<SettingOutlined />} onClick={onOpenAccessKeyConfig}>
                {accessKeyConfigured ? 'AK/AS 已配置' : '配置 AK/AS'}
              </Button>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                loading={status === 'connecting'}
                disabled={connected}
                onClick={() => connect(taskId)}
              >
                重新连接
              </Button>
              <Button icon={<DisconnectOutlined />} disabled={!connected} onClick={disconnect}>
                断开
              </Button>
              <Button icon={<ClearOutlined />} onClick={clearLog}>
                清空日志
              </Button>
            </Space>
          </div>
        </div>

        {!accessKeyConfigured ? (
          <Alert
            showIcon
            type="warning"
            title="尚未配置 AK/AS"
            description="请先配置 AK/AS，否则任务日志流可能无法连接。"
          />
        ) : null}

        {errorText ? <Alert showIcon type="error" title={errorText} /> : null}

        <pre
          ref={logPanelRef}
          className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[rgba(100,116,139,0.24)] bg-[linear-gradient(180deg,rgba(2,6,23,0.96)_0%,rgba(11,19,36,0.98)_100%)] p-4 text-[12px] leading-[1.7] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          style={{
            margin: 0,
            fontFamily: "'Cascadia Code', 'Consolas', 'Menlo', monospace",
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {logText || '等待连接任务日志流...'}
        </pre>
      </div>
    </div>
  )
}
