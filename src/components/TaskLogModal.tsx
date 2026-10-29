import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ClearOutlined, DisconnectOutlined, LinkOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Modal, Space, Tag, Typography } from 'antd'
import type { AccessKeySettings } from '../features/koko/types'
import { useTaskLogStream } from '../hooks/useTaskLogStream'

const { Text } = Typography

type TaskLogModalProps = {
  open: boolean
  accessKeyConfigured: boolean
  settings: AccessKeySettings
  onCancel: () => void
  onOpenAccessKeyConfig: () => void
}

type TaskLogFormValues = {
  taskId: string
}

const statusMeta = {
  idle: { color: 'default', text: '未连接' },
  connecting: { color: 'processing', text: '连接中' },
  connected: { color: 'green', text: '日志流已连接' },
  closed: { color: 'default', text: '已断开' },
  error: { color: 'red', text: '连接异常' },
} as const

export const TaskLogModal: FC<TaskLogModalProps> = ({ open, accessKeyConfigured, settings, onCancel, onOpenAccessKeyConfig }) => {
  const [form] = Form.useForm<TaskLogFormValues>()
  const logPanelRef = useRef<HTMLPreElement | null>(null)
  const [taskId, setTaskId] = useState('')
  const { status, logText, errorText, connect, disconnect, clearLog } = useTaskLogStream({ settings })
  const connected = status === 'connected' || status === 'connecting'
  const meta = statusMeta[status]

  useEffect(() => {
    if (!open) disconnect()
  }, [disconnect, open])

  useEffect(() => {
    const panel = logPanelRef.current
    if (!panel) return
    panel.scrollTop = panel.scrollHeight
  }, [logText])

  const handleConnect = async () => {
    const values = await form.validateFields()
    const nextTaskId = values.taskId.trim()
    setTaskId(nextTaskId)
    connect(nextTaskId)
  }

  return (
    <Modal
      title="查询任务日志"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      width={860}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Space className="w-full" direction="vertical" size="middle">
        <div className="flex items-start justify-between gap-3 rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] p-3 max-md:flex-col">
          <div className="min-w-0 flex-1">
            <Space size={8} wrap>
              <Text strong>任务日志流</Text>
              <Tag color={meta.color}>{meta.text}</Tag>
              {taskId ? <Tag color="blue">任务：{taskId}</Tag> : null}
            </Space>
            <div className="mt-1">
              <Text type="secondary" className="text-[13px]">
                通过同源 WebSocket 透明转发连接上游任务日志流，连接建立后由前端发送任务订阅消息。
              </Text>
            </div>
          </div>
          <Button size="small" onClick={onOpenAccessKeyConfig}>
            {accessKeyConfigured ? 'AK/AS 已配置' : '配置 AK/AS'}
          </Button>
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

        <Form<TaskLogFormValues> form={form} layout="inline" initialValues={{ taskId: '' }} className="gap-2">
          <Form.Item
            className="min-w-[280px] flex-1"
            name="taskId"
            rules={[{ required: true, message: '请输入任务 ID' }]}
          >
            <Input
              allowClear
              autoFocus
              placeholder="请输入任务 ID，例如：c900547f-0cff-43a5-bc8e-926b8a22c1f0"
              disabled={connected}
              onPressEnter={() => void handleConnect()}
            />
          </Form.Item>
          <Form.Item>
            <Space wrap>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                loading={status === 'connecting'}
                disabled={connected}
                onClick={() => void handleConnect()}
              >
                连接
              </Button>
              <Button icon={<DisconnectOutlined />} disabled={!connected} onClick={disconnect}>
                断开
              </Button>
              <Button icon={<ClearOutlined />} onClick={clearLog}>
                清空日志
              </Button>
            </Space>
          </Form.Item>
        </Form>

        <pre
          ref={logPanelRef}
          style={{
            margin: 0,
            minHeight: 360,
            maxHeight: '46vh',
            overflow: 'auto',
            borderRadius: 12,
            border: '1px solid rgba(100, 116, 139, 0.24)',
            background: 'linear-gradient(180deg, rgba(2, 6, 23, 0.96) 0%, rgba(11, 19, 36, 0.98) 100%)',
            color: 'rgba(226, 232, 240, 0.94)',
            padding: '12px',
            fontFamily: "'Cascadia Code', 'Consolas', 'Menlo', monospace",
            fontSize: 12,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {logText || '等待连接任务日志流...'}
        </pre>
      </Space>
    </Modal>
  )
}
