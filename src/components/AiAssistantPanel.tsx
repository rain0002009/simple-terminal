import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessage,
} from '@assistant-ui/react'
import {
  ApiOutlined,
  CodeOutlined,
  ConsoleSqlOutlined,
  CopyOutlined,
  DownloadOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useMemoizedFn } from 'ahooks'
import {
  Alert,
  AutoComplete,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from 'antd'
import { DEFAULT_AI_SYSTEM_PROMPT, DEFAULT_AI_TEMPERATURE } from '../features/koko/constants'
import type { AiPanelSettings, AiSessionState, TerminalAiContextSnapshot } from '../features/koko/types'
import { useWorkspaceOverlayContainer } from './WorkspaceOverlayContext'

const { Text } = Typography

type ChatCompletionRequestMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type AiChatCompletionProxyRequest = {
  apiKey: string
  baseUrl: string
  messages: ChatCompletionRequestMessage[]
  model: string
  temperature?: number
}

type AiModelsProxyRequest = {
  apiKey: string
  baseUrl: string
}

type AiModelsProxyResponse = {
  models?: string[]
}

type ModelOptionsSource = {
  apiKey: string
  baseUrl: string
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

type ProxyErrorResponse = {
  detail?: string
  error?: { message?: string }
  message?: string
  msg?: string
}

type AiAssistantPanelProps = {
  activeContext: TerminalAiContextSnapshot | null
  activeSession: AiSessionState | null
  onSessionChange: (session: AiSessionState) => void
  settings: AiPanelSettings
  onSettingsChange: (patch: Partial<AiPanelSettings>) => void
}

const createAiMessageId = (): string => `ai-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const summarizeSettings = (settings: AiPanelSettings): string => {
  return settings.model || '未配置模型'
}

const sessionStatusLabelMap: Record<AiSessionState['status'], string> = {
  idle: '空闲',
  running: '运行中',
  error: '异常',
}

const sessionStatusColorMap: Record<AiSessionState['status'], string> = {
  idle: 'default',
  running: 'processing',
  error: 'error',
}

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '')

const extractAssistantText = (response: ChatCompletionResponse): string => {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => item.text?.trim() ?? '')
      .filter((item) => item.length > 0)
      .join('\n')
      .trim()
  }
  return ''
}

const extractProxyErrorMessage = (response: Record<string, unknown> | null): string => {
  if (!response || typeof response !== 'object') return ''
  const candidate = response as ProxyErrorResponse
  return candidate.error?.message ?? candidate.detail ?? candidate.msg ?? candidate.message ?? ''
}

const isHtmlResponseText = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html')
}

const normalizeModelOptions = (models: string[]): Array<{ value: string }> => {
  return Array.from(new Set(models.map((item) => item.trim()).filter((item) => item.length > 0)))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((value) => ({ value }))
}

const extractMessageText = (message: Pick<ThreadMessage, 'content'>): string => {
  return message.content
    .flatMap((part) => {
      if (part.type !== 'text') return []
      return [part.text]
    })
    .join('\n')
    .trim()
}

const buildUserThreadMessage = (message: AppendMessage): ThreadMessage => ({
  id: createAiMessageId(),
  createdAt: message.createdAt,
  role: 'user',
  content: message.content.filter((part) => part.type !== 'reasoning' && part.type !== 'source' && part.type !== 'tool-call' && part.type !== 'generative-ui'),
  attachments: message.attachments ?? [],
  metadata: {
    custom: message.metadata.custom,
  },
})

const buildAssistantThreadMessage = (content: string): ThreadMessage => ({
  id: createAiMessageId(),
  createdAt: new Date(),
  role: 'assistant',
  content: [{ type: 'text', text: content }],
  status: { type: 'complete', reason: 'stop' },
  metadata: {
    unstable_state: null,
    unstable_annotations: [],
    unstable_data: [],
    steps: [],
    custom: {},
  },
})

const buildContextText = (activeContext: TerminalAiContextSnapshot | null, settings: AiPanelSettings): string => {
  if (!activeContext) return '当前没有激活的终端标签页。'

  const sections = [
    `上下文来源: ${[
      settings.includeTerminalContext ? 'terminal' : null,
      settings.includeEditorContext ? 'editor' : null,
    ].filter(Boolean).join(', ') || 'none'}`,
    `当前标签: ${activeContext.tabTitle || activeContext.tabId}`,
    `标签分组: ${activeContext.tabTag || '无'}`,
    `连接状态: ${activeContext.phase} / ${activeContext.statusText}`,
    `会话 ID: ${activeContext.sessionId || '无'}`,
  ]

  if (settings.includeTerminalContext) {
    sections.push(`终端输出尾部:\n${activeContext.terminalTranscriptTail || '暂无可用终端输出。'}`)
  }

  if (settings.includeEditorContext) {
    const editor = activeContext.remoteEditor
    sections.push(
      editor.visible
        ? `打开中的远端文件: ${editor.filePath || '未命名'}\n编辑状态: ${editor.isDirty ? '有未保存修改' : '已同步'}\n文件内容:\n${editor.content || '文件内容为空。'}`
        : '当前未打开远端文件编辑器。',
    )
  }

  return sections.join('\n\n')
}

const toOneLine = (value: string, maxLength = 140): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

const getLatestMessageText = (messages: readonly ThreadMessage[], role: 'user' | 'assistant'): string => {
  const latest = [...messages].reverse().find((message) => message.role === role)
  return latest ? extractMessageText(latest) : ''
}

const buildSessionMemorySummary = ({
  activeContext,
  errorText,
  messages,
  settings,
}: {
  activeContext: TerminalAiContextSnapshot | null
  errorText?: string
  messages: readonly ThreadMessage[]
  settings: AiPanelSettings
}): string => {
  const contextSource = [
    settings.includeTerminalContext ? '终端' : null,
    settings.includeEditorContext ? '编辑器' : null,
  ].filter(Boolean).join(' + ') || '无附加上下文'

  const latestUser = toOneLine(getLatestMessageText(messages, 'user'))
  const latestAssistant = toOneLine(getLatestMessageText(messages, 'assistant'))
  const latestError = toOneLine(errorText ?? '')
  const activeFile = activeContext?.remoteEditor.visible ? activeContext.remoteEditor.filePath || '未命名文件' : ''

  const lines = [
    activeContext
      ? `工作区：${activeContext.tabTitle || activeContext.tabId}（${activeContext.statusText}）`
      : '工作区：全局 AI 会话（未绑定终端标签）',
    `上下文来源：${contextSource}`,
    activeFile ? `活跃文件：${activeFile}` : '',
    latestUser ? `最近用户意图：${latestUser}` : '',
    latestAssistant ? `最近助手结论：${latestAssistant}` : '',
    latestError ? `待处理问题：${latestError}` : '',
  ].filter((line) => line.length > 0)

  return lines.join('\n')
}

const AiMessageCard: FC = () => {
  const role = useAuiState((state) => state.message.role)

  return (
    <MessagePrimitive.Root className={`ai-message-card ${role === 'assistant' ? 'ai-message-assistant' : 'ai-message-user'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Space size={6}>
          {role === 'assistant' ? <RobotOutlined /> : <UserOutlined />}
          <Text strong>{role === 'assistant' ? '助手' : '你'}</Text>
        </Space>

        <Space size={6}>
          <MessagePrimitive.Error>
            <Tag color="error">失败</Tag>
          </MessagePrimitive.Error>
          {role === 'assistant' ? (
            <ActionBarPrimitive.Root className="ai-message-actions">
              <ActionBarPrimitive.Copy
                aria-label="复制消息"
                className="ai-message-action-button"
                title="复制"
              >
                <CopyOutlined />
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
          ) : null}
        </Space>
      </div>

        <div className="ai-message-body">
          <div className="ai-message-text-wrap">
            <MessagePrimitive.Parts />
          </div>
          <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="ai-message-error">
              <span>请求失败：</span>
              <ErrorPrimitive.Message />
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>
        </div>
      </MessagePrimitive.Root>
  )
}

const AiThread: FC<{
  onToggleEditorContext: () => void
  onToggleTerminalContext: () => void
  settings: AiPanelSettings
}> = ({ onToggleEditorContext, onToggleTerminalContext, settings }) => {
  const isRunning = useAuiState((state) => state.thread.isRunning)

  return (
    <>
      <div className="ai-conversation-scroll">
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-3">
            <ThreadPrimitive.If empty>
              <div className="rounded-[12px] border border-dashed border-[rgba(100,116,139,0.28)] px-4 py-10">
                <Empty
                  description="输入提示词后，AI 会结合当前终端与编辑器上下文给出建议。"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </div>
            </ThreadPrimitive.If>

            <ThreadPrimitive.Messages>
              {() => <AiMessageCard />}
            </ThreadPrimitive.Messages>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 z-10 mt-auto pt-3">
              <div className="flex justify-center pb-2">
                <ThreadPrimitive.ScrollToBottom className="ai-scroll-to-bottom-button">
                  回到底部
                </ThreadPrimitive.ScrollToBottom>
              </div>

              <div className="ai-composer-shell">
                <ComposerPrimitive.Root>
                  <Space direction="vertical" size="small" className="w-full">
                    <div className="flex items-center justify-between gap-3">
                      <Text strong>提示词</Text>
                      <Space size={8} wrap>
                        <Tag
                          className="cursor-pointer select-none"
                          icon={<ConsoleSqlOutlined />}
                          color={settings.includeTerminalContext ? 'cyan' : 'default'}
                          onClick={onToggleTerminalContext}
                        >
                          终端
                        </Tag>
                        <Tag
                          className="cursor-pointer select-none"
                          icon={<CodeOutlined />}
                          color={settings.includeEditorContext ? 'geekblue' : 'default'}
                          onClick={onToggleEditorContext}
                        >
                          编辑器
                        </Tag>
                        {isRunning ? (
                          <ComposerPrimitive.Cancel className="ai-composer-secondary-button" aria-label="停止响应">
                            <StopOutlined />
                            <span>停止</span>
                          </ComposerPrimitive.Cancel>
                        ) : null}
                        <ComposerPrimitive.Send className="ai-composer-send-button" aria-label="发送消息">
                          <SendOutlined />
                          <span>发送</span>
                        </ComposerPrimitive.Send>
                      </Space>
                    </div>

                    <ComposerPrimitive.Input
                      autoFocus
                      className="ai-composer-input"
                      minRows={4}
                      maxRows={8}
                      placeholder="例如：总结当前终端输出中的异常，并告诉我下一步应该检查什么。"
                      submitMode="enter"
                    />

                    {!settings.apiKey.trim() || !settings.model.trim() ? (
                      <Alert showIcon type="warning" title="尚未完成本地 AI 配置，请先填写 Base URL、API Key 与模型。" />
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <Text type="secondary" className="text-[12px] leading-5">
                        Shift + Enter 换行，Enter 发送。配置仅保存在本地浏览器。
                      </Text>
                    </div>
                  </Space>
                </ComposerPrimitive.Root>
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </div>
    </>
  )
}

export const AiAssistantPanel: FC<AiAssistantPanelProps> = ({
  activeContext,
  activeSession,
  onSessionChange,
  settings,
  onSettingsChange,
}) => {
  const { notification } = App.useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState<Array<{ value: string }>>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsErrorText, setModelsErrorText] = useState('')
  const [modelOptionsSource, setModelOptionsSource] = useState<ModelOptionsSource | null>(null)
  const [form] = Form.useForm<AiPanelSettings>()
  const workspaceOverlayContainer = useWorkspaceOverlayContainer()
  const abortControllerRef = useRef<AbortController | null>(null)
  const watchedModel = Form.useWatch('model', form)
  const watchedBaseUrl = Form.useWatch('baseUrl', form)
  const watchedApiKey = Form.useWatch('apiKey', form)

  const contextSummary = useMemo(() => buildContextText(activeContext, settings), [activeContext, settings])
  const modelSummary = useMemo(() => summarizeSettings(settings), [settings])
  const threadKey = activeContext?.tabId || 'no-active-tab'

  useEffect(() => {
    if (!settingsOpen || !modelOptionsSource) return

    const normalizedBaseUrl = normalizeBaseUrl(watchedBaseUrl ?? '')
    const normalizedApiKey = (watchedApiKey ?? '').trim()
    if (normalizedBaseUrl === modelOptionsSource.baseUrl && normalizedApiKey === modelOptionsSource.apiKey) {
      return
    }

    setModelOptions([])
    setModelOptionsSource(null)
    setModelsErrorText('')
  }, [modelOptionsSource, settingsOpen, watchedApiKey, watchedBaseUrl])

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning: activeSession?.status === 'running',
    messages: activeSession?.messages ?? [],
    onCancel: async () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      if (!activeSession) return
      onSessionChange({
        ...activeSession,
        status: 'idle',
        updatedAt: Date.now(),
      })
    },
    onNew: async (message) => {
      if (!activeSession) return

      const nextUserMessage = buildUserThreadMessage(message)
      const nextMessages = [...activeSession.messages, nextUserMessage]
      const baseUrl = normalizeBaseUrl(settings.baseUrl)

      if (!baseUrl || !settings.apiKey.trim() || !settings.model.trim()) {
        onSessionChange({
          ...activeSession,
          errorText: '请先在本地设置中填写 Base URL、API Key 与模型名称。',
          messages: nextMessages,
          status: 'error',
          summary: contextSummary,
          updatedAt: Date.now(),
        })
        return
      }

      onSessionChange({
        ...activeSession,
        errorText: '',
        messages: nextMessages,
        status: 'running',
        summary: buildSessionMemorySummary({
          activeContext,
          messages: nextMessages,
          settings,
        }),
        updatedAt: Date.now(),
      })

      const payload: ChatCompletionRequestMessage[] = [
        {
          role: 'system',
          content: DEFAULT_AI_SYSTEM_PROMPT,
        },
      ]

      payload.push({
        role: 'system',
        content: `你正在协助一个 Web Terminal 工作区。请优先参考以下上下文，并在上下文不足时明确说明。\n\n${contextSummary}`,
      })

      nextMessages.forEach((item) => {
        if (item.role !== 'user' && item.role !== 'assistant') return
        const content = extractMessageText(item)
        if (!content) return
        payload.push({ role: item.role, content })
      })

      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const requestPayload: AiChatCompletionProxyRequest = {
          apiKey: settings.apiKey.trim(),
          baseUrl,
          messages: payload,
          model: settings.model.trim(),
          temperature: DEFAULT_AI_TEMPERATURE,
        }

        const response = await fetch('/ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        })

        const rawText = await response.text()
        if (isHtmlResponseText(rawText)) {
          throw new Error('AI 代理返回了 HTML 页面而不是模型结果，请确认 /ai/chat/completions 路由已部署到目标服务。')
        }

        const data = rawText ? (JSON.parse(rawText) as ChatCompletionResponse | ProxyErrorResponse) : null
        if (!response.ok) {
          const detail = extractProxyErrorMessage(data)
          throw new Error(detail || `请求失败（${response.status}）`)
        }

        const content = extractAssistantText((data ?? {}) as ChatCompletionResponse)
        if (!content) throw new Error('AI 返回内容为空，请调整模型或上下文后重试。')

        onSessionChange({
          ...activeSession,
          errorText: '',
          messages: [...nextMessages, buildAssistantThreadMessage(content)],
          status: 'idle',
          summary: buildSessionMemorySummary({
            activeContext,
            messages: [...nextMessages, buildAssistantThreadMessage(content)],
            settings,
          }),
          updatedAt: Date.now(),
        })
      } catch (error) {
        const errorText = error instanceof Error ? error.message : 'AI 请求失败，请稍后重试。'
        onSessionChange({
          ...activeSession,
          errorText,
          messages: nextMessages,
          status: 'error',
          summary: buildSessionMemorySummary({
            activeContext,
            errorText,
            messages: nextMessages,
            settings,
          }),
          updatedAt: Date.now(),
        })
        throw error
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null
        }
      }
    },
    setMessages: (messages) => {
      if (!activeSession) return
      onSessionChange({
        ...activeSession,
        messages: [...messages],
        updatedAt: Date.now(),
      })
    },
  })

  const handleToggleTerminalContext = useMemoizedFn(() => {
    onSettingsChange({ includeTerminalContext: !settings.includeTerminalContext })
  })

  const handleToggleEditorContext = useMemoizedFn(() => {
    onSettingsChange({ includeEditorContext: !settings.includeEditorContext })
  })

  const handleOpenSettings = useMemoizedFn(() => {
    form.setFieldsValue(settings)
    setModelOptions([])
    setModelOptionsSource(null)
    setModelsErrorText('')
    setSettingsOpen(true)
  })

  const handleFetchModels = useMemoizedFn(async () => {
    setModelsErrorText('')

    let values: Pick<AiPanelSettings, 'apiKey' | 'baseUrl'>
    try {
      values = await form.validateFields(['baseUrl', 'apiKey'])
    } catch {
      return
    }

    const requestPayload: AiModelsProxyRequest = {
      apiKey: values.apiKey.trim(),
      baseUrl: normalizeBaseUrl(values.baseUrl),
    }

    if (!requestPayload.baseUrl || !requestPayload.apiKey) {
      setModelsErrorText('请先填写可用的 Base URL 与 API Key，再获取模型列表。')
      return
    }

    setModelsLoading(true)

    try {
      const response = await fetch('/ai/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      })

      const rawText = await response.text()
      if (isHtmlResponseText(rawText)) {
        throw new Error('AI 代理返回了 HTML 页面而不是模型列表，请确认 /ai/models 路由已部署到目标服务。')
      }

      const data = rawText ? (JSON.parse(rawText) as AiModelsProxyResponse | ProxyErrorResponse) : null
      if (!response.ok) {
        const detail = extractProxyErrorMessage(data)
        throw new Error(detail || `获取模型失败（${response.status}）`)
      }

      const nextOptions = normalizeModelOptions((data as AiModelsProxyResponse | null)?.models ?? [])
      setModelOptions(nextOptions)
      setModelOptionsSource(requestPayload)

      if (nextOptions.length === 0) {
        setModelsErrorText('已连接成功，但当前接口没有返回可用模型。你仍然可以手动输入模型名称。')
        notification.warning({
          message: '未获取到模型',
          description: '当前接口未返回模型列表，你仍然可以手动输入模型名称。',
          placement: 'topRight',
        })
        return
      }

      notification.success({
        message: '模型列表已更新',
        description: `已获取 ${nextOptions.length} 个模型候选，可继续手动输入自定义模型名称。`,
        placement: 'topRight',
      })
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '获取模型失败，请稍后重试。'
      setModelOptions([])
      setModelOptionsSource(null)
      setModelsErrorText(errorText)
      notification.error({
        message: '获取模型失败',
        description: errorText,
        placement: 'topRight',
      })
    } finally {
      setModelsLoading(false)
    }
  })

  const handleSaveSettings = useMemoizedFn(async () => {
    const values = await form.validateFields()
    onSettingsChange({
      ...values,
      baseUrl: values.baseUrl.trim(),
      apiKey: values.apiKey,
      model: values.model.trim(),
    })
    setSettingsOpen(false)
    notification.success({
      message: 'AI 设置已保存',
      description: '配置仅保存在当前浏览器本地，不会发送到项目服务端。',
      placement: 'topRight',
    })
  })

  return (
    <AssistantRuntimeProvider key={threadKey} runtime={runtime}>
      <Card
        className="ai-panel-shell"
        title={
          <div className="flex items-center justify-between gap-3">
            <Space size={8}>
              <ApiOutlined />
              <span>AI 助手</span>
            </Space>
            <Button icon={<SettingOutlined />} size="small" onClick={handleOpenSettings}>
              设置
            </Button>
          </div>
        }
        styles={{ body: { padding: 12 } }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.4)] px-3 py-2">
            <Space size={[6, 6]} wrap>
              <Tag color="blue">{settings.model || '未配置模型'}</Tag>
              {activeSession ? <Tag color={sessionStatusColorMap[activeSession.status]}>{sessionStatusLabelMap[activeSession.status]}</Tag> : null}
              <Text type="secondary" className="text-[12px] leading-5">
                {modelSummary}
              </Text>
            </Space>
          </div>

          {activeSession ? (
            <div className="rounded-[12px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.32)] px-3 py-2">
              <Space direction="vertical" size={4} className="w-full">
                <div className="flex items-center justify-between gap-3">
                  <Text strong>会话状态</Text>
                  <Text type="secondary" className="text-[12px]">消息 {activeSession.messages.length} 条</Text>
                </div>
                <Text type="secondary" className="text-[12px] leading-5">
                  {activeSession.summary || '当前会话摘要会随着上下文与请求更新。'}
                </Text>
              </Space>
            </div>
          ) : null}

          {activeSession?.errorText ? <Alert showIcon type="error" title={activeSession.errorText} /> : null}

          <AiThread
            onToggleEditorContext={handleToggleEditorContext}
            onToggleTerminalContext={handleToggleTerminalContext}
            settings={settings}
          />
        </div>

      <Drawer
        title="本地 AI 设置"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        size={420}
        destroyOnHidden
        getContainer={workspaceOverlayContainer}
        rootStyle={workspaceOverlayContainer ? { position: 'absolute' } : undefined}
          extra={<Button type="primary" size="small" onClick={() => void handleSaveSettings()}>保存</Button>}
        >
        <Form<AiPanelSettings> form={form} layout="vertical" initialValues={settings}>
          <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 OpenAI 兼容接口地址' }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>

            <Form.Item label="API Key" name="apiKey" rules={[{ required: true, message: '请输入 API Key' }]}>
              <Input.Password placeholder="仅保存在当前浏览器本地" />
            </Form.Item>

          <Form.Item
            label={
              <div className="flex items-center gap-2">
                <span>模型</span>
                <Button
                  icon={<DownloadOutlined />}
                  loading={modelsLoading}
                  size="small"
                  type="link"
                  onClick={() => void handleFetchModels()}
                >
                  获取模型
                </Button>
              </div>
            }
            name="model"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <AutoComplete
              options={modelOptions}
              placeholder="gpt-4.1-mini"
              filterOption={(inputValue, option) => {
                const optionValue = String(option?.value ?? '').toLowerCase()
                return optionValue.includes(inputValue.trim().toLowerCase())
              }}
            >
              <Input />
            </AutoComplete>
          </Form.Item>

          {modelsErrorText ? (
            <Alert
              showIcon
              type="warning"
              message={modelsErrorText}
              className="mb-4"
            />
          ) : null}

          {!modelsErrorText && modelOptions.length > 0 ? (
            <Text type="secondary" className="mt-[-8px] block text-[12px] leading-5">
              已获取 {modelOptions.length} 个模型候选，当前仍支持手动输入。
              {watchedModel?.trim() ? ` 当前输入：${watchedModel.trim()}` : ''}
            </Text>
          ) : null}
        </Form>
      </Drawer>
      </Card>
    </AssistantRuntimeProvider>
  )
}
