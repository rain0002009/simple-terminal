import type { ThreadMessage } from '@assistant-ui/react'

export type Phase =
  | 'idle'
  | 'connecting'
  | 'waiting-connect'
  | 'initializing'
  | 'ready'
  | 'closing'
  | 'closed'
  | 'error'

export type ZmodemTransferDirection = 'upload' | 'download'

export type ZmodemDownloadSaveMode = 'none' | 'directory-picker' | 'browser-download'

export type ZmodemTransferPhase =
  | 'idle'
  | 'waiting-upload'
  | 'receiving'
  | 'saving'
  | 'sending'
  | 'completed'
  | 'error'

export type ZmodemTransferState = {
  phase: ZmodemTransferPhase
  direction: ZmodemTransferDirection | null
  fileName: string
  transferredBytes: number
  totalBytes: number
  percent: number
  message: string
  saveMode: ZmodemDownloadSaveMode
  saveModeMessage: string
}

export type ProtocolMessage = {
  id?: string
  type?: string
  data?: unknown
  err?: string
}

export type SavedToken = {
  id: string
  name: string
  token: string
}

export type TerminalTab = {
  id: string
  title: string
  tag: string
}

export type TerminalSessionHandlers = {
  connectToUrl: (socketUrl: string) => void
  disconnect: () => void
  openRemotePathModal: () => void
  insertCommandText: (command: string) => boolean
}

export type AiConversationRole = 'user' | 'assistant'

export type AiConversationMessage = {
  id: string
  role: AiConversationRole
  content: string
  requestContent?: string
  createdAt: number
  error?: boolean
}

export type AiSessionStatus = 'idle' | 'running' | 'error'

export type AiSessionState = {
  id: string
  tabId: string
  title: string
  summary: string
  status: AiSessionStatus
  errorText: string
  messages: ThreadMessage[]
  updatedAt: number
}

export type AiPanelSettings = {
  baseUrl: string
  apiKey: string
  model: string
  includeTerminalContext: boolean
  includeEditorContext: boolean
}

export type AccessKeySettings = {
  accessKeyId: string
  accessKeySecret: string
}

export type CustomCommand = {
  id: string
  name: string
  content: string
  tag: string
}

export type TerminalSessionSnapshot = {
  phase: Phase
  statusText: string
  errorText: string
  closeText: string
  sessionId: string
  isBusy: boolean
}

export type TerminalAiEditorSnapshot = {
  visible: boolean
  filePath: string
  content: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  errorText: string
}

export type TerminalAiSourceSnapshot = {
  terminalTranscriptTail: string
  remoteEditor: TerminalAiEditorSnapshot
}

export type TerminalAiContextSnapshot = TerminalAiSourceSnapshot & {
  tabId: string
  tabTitle: string
  tabTag: string
  phase: Phase
  statusText: string
  sessionId: string
}

export type RemoteEditorState = {
  visible: boolean
  filePath: string
  content: string
  checksum: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  errorText: string
}

export type JmsSessionCredentials = {
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
}

export type UserProfile = {
  id?: string
  username?: string
  name?: string
}

export type PaginatedResponse<T> = {
  count?: number
  results?: T[]
}

export type AssetGranted = {
  id?: string
  name?: string
  display_name?: string
  hostname?: string
  address?: string
  ip?: string
  comment?: string
  platform?: string | { id?: string; name?: string }
}

export type FavoriteAssetApiRecord = {
  id?: string
  asset?: string | { id?: string; name?: string; display_name?: string } 
}

export type FavoriteAssetRecord = {
  id: string
  assetId: string
}

export type AssetPermedAccount = {
  id?: string
  alias?: string
  name?: string
  username?: string
  has_secret?: boolean
  actions?: string[]
}

export type AssetPermedProtocol = {
  name?: string
  port?: number | null
  public?: boolean
  setting?: Record<string, unknown>
}

export type AssetPermedDetail = AssetGranted & {
  permed_accounts?: AssetPermedAccount[]
  permed_protocols?: AssetPermedProtocol[]
}

export type AssetOption = {
  value: string
  label: string
  description: string
  address: string
}

export type SystemUserRecord = {
  id?: string
  name?: string
  username?: string
}

export type ConnectionTokenApiRecord = {
  id?: string
  secret?: string
  value?: string
  asset?: string | { id?: string; name?: string } | null
  account?: string | { id?: string; name?: string; username?: string } | null
  asset_display?: string
  date_created?: string
  date_expired?: string
  is_valid?: boolean
  is_expired?: boolean
}

export type ConnectionTokenRecord = {
  id: string
  secret: string
  tokenId: string
  assetId: string
  assetName: string
  createdAt: string
  expiresAt: string
  isValid: boolean
}

export type ConnectMethodRecord = {
  value?: string
  label?: string
  type?: string
  endpoint_protocol?: string
  component?: string
}

export type AssetConnectionDefaults = {
  assetId: string
  account: string
  inputUsername: string
  protocol: string
  connectMethod: string
}

export type SmartEndpointResponse = {
  url?: string
  host?: string
  port?: number
  protocol?: string
  endpoint?: string
}
