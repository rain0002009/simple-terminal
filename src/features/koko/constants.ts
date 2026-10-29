export const API_BASE = '/api/v1'
export const TOKENS_STORAGE_KEY = 'koko.saved-tokens'
export const SELECTED_TOKEN_KEY = 'koko.selected-token-id'
export const CUSTOM_COMMANDS_STORAGE_KEY = 'koko.custom-commands'
export const AI_PANEL_SETTINGS_STORAGE_KEY = 'koko.ai-panel-settings'
export const ACCESS_KEY_SETTINGS_STORAGE_KEY = 'koko.access-key-settings'
export const JMS_SESSION_STORAGE_KEY = 'koko.jms-session'
export const JMS_SESSION_COOKIE_NAME = 'jms_sessionid'
export const CSRF_COOKIE_NAME = 'jms_csrftoken'
export const ACCESS_KEY_ID_COOKIE_NAME = 'koko_access_key_id'
export const ACCESS_KEY_SECRET_COOKIE_NAME = 'koko_access_key_secret'
export const ACCESS_KEY_ID_HEADER = 'X-KOKO-ACCESS-KEY-ID'
export const ACCESS_KEY_SECRET_HEADER = 'X-KOKO-ACCESS-KEY-SECRET'
export const HANDSHAKE_TIMEOUT_MS = 10_000
export const READY_HINT_TIMEOUT_MS = 10_000
export const PING_INTERVAL_MS = 25_000
export const MAX_EVENT_LOG = 12
export const MAX_TERMINAL_TRANSCRIPT_LINES = 160
export const MAX_TERMINAL_TRANSCRIPT_CHARS = 12_000
export const KOKO_WS_ENDPOINT = '/koko/ws/terminal/'
export const TASK_LOG_WS_ENDPOINT = '/task-log/ws/ops/tasks/log/'
export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini'
export const DEFAULT_AI_TEMPERATURE = 0.1
export const DEFAULT_AI_SYSTEM_PROMPT = `你是一个终端与远端文件编辑工作区里的 AI 助手。

你的首要目标是基于当前提供的终端输出、编辑器内容和用户问题，给出可靠、克制、可执行的帮助。

遵循以下规则：
1. 优先使用已提供的上下文，不要臆造命令输出、文件内容、报错原因或系统状态。
2. 如果上下文不足以得出结论，明确说明缺少什么信息，并给出下一步最有价值的检查动作。
3. 回答以解决问题为导向，优先给出结论、原因判断和下一步操作，而不是泛泛而谈。
4. 当建议终端命令时，只给与当前问题直接相关的最小命令集；如果命令可能有风险，要先提醒风险。
5. 当涉及代码或配置文件时，优先结合已打开文件的实际内容、路径和状态回答。
6. 不要假装自己已经执行了命令、修改了文件或验证了结果；只能根据提供的上下文推断。
7. 输出保持简洁、明确、工程化，优先帮助用户继续排查、修复或决策。`

export const phaseTextMap = {
  idle: '未连接',
  connecting: '正在建立连接',
  'waiting-connect': 'Socket 已打开，等待 CONNECT',
  initializing: '已收到 CONNECT，初始化终端中',
  ready: '终端可用',
  closing: '正在断开连接',
  closed: '连接已关闭',
  error: '连接异常',
} as const
