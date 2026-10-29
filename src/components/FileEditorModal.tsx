import type { FC } from 'react'
import Editor from '@monaco-editor/react'
import { useLatest, useMemoizedFn } from 'ahooks'
import { Alert, Modal, Space, Spin, Tag, Typography } from 'antd'
import type { RemoteEditorState } from '../features/koko/types'

const { Text } = Typography

const NGINX_LANGUAGE_ID = 'nginx'

type MonacoLanguageApi = {
  languages: {
    getLanguages: () => Array<{ id: string }>
    register: (language: { id: string; extensions?: string[]; filenames?: string[]; aliases?: string[] }) => void
    setMonarchTokensProvider: (
      languageId: string,
      provider: {
        ignoreCase?: boolean
        tokenizer: Record<string, unknown[]>
      },
    ) => void
  }
}

type FileEditorModalProps = {
  open: boolean
  remoteEditor: RemoteEditorState
  onChange: (content: string) => void
  onCancel: () => void
  onSave: () => Promise<boolean>
  getContainer?: HTMLElement | false
}

const inferLanguageByPath = (filePath: string): string => {
  const lowerPath = filePath.toLowerCase()
  const fileName = lowerPath.split('/').pop() ?? lowerPath
  if (
    fileName === 'nginx.conf' ||
    fileName.endsWith('.nginx') ||
    lowerPath.includes('/nginx/') ||
    lowerPath.includes('/sites-available/') ||
    lowerPath.includes('/sites-enabled/')
  ) {
    return NGINX_LANGUAGE_ID
  }
  if (lowerPath.endsWith('.ts')) return 'typescript'
  if (lowerPath.endsWith('.tsx')) return 'typescript'
  if (lowerPath.endsWith('.js')) return 'javascript'
  if (lowerPath.endsWith('.jsx')) return 'javascript'
  if (lowerPath.endsWith('.json')) return 'json'
  if (lowerPath.endsWith('.css')) return 'css'
  if (lowerPath.endsWith('.html')) return 'html'
  if (lowerPath.endsWith('.md')) return 'markdown'
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) return 'yaml'
  if (lowerPath.endsWith('.sh')) return 'shell'
  return 'plaintext'
}

const registerNginxLanguage = (monaco: MonacoLanguageApi) => {
  if (monaco.languages.getLanguages().some((language) => language.id === NGINX_LANGUAGE_ID)) return

  monaco.languages.register({
    id: NGINX_LANGUAGE_ID,
    extensions: ['.nginx'],
    filenames: ['nginx.conf'],
    aliases: ['Nginx', 'nginx'],
  })

  monaco.languages.setMonarchTokensProvider(NGINX_LANGUAGE_ID, {
    ignoreCase: false,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(?:events|http|server|location|upstream|stream|mail|types|map|geo|limit_except)\b/, 'keyword'],
        [/\b(?:include|listen|server_name|root|index|proxy_pass|proxy_set_header|rewrite|return|try_files|access_log|error_log|ssl_certificate|ssl_certificate_key|client_max_body_size|keepalive_timeout|worker_processes|user|pid|daemon|env)\b/, 'keyword.directive'],
        [/\$[\w_]+/, 'variable'],
        [/(?:https?|wss?):\/\/[^\s;]+/, 'string.link'],
        [/'[^']*'/, 'string'],
        [/"[^"]*"/, 'string'],
        [/\b\d+[kKmMgG]?\b/, 'number'],
        [/[{}]/, 'delimiter.bracket'],
        [/[;]/, 'delimiter'],
      ],
    },
  })
}

export const FileEditorModal: FC<FileEditorModalProps> = ({
  open,
  remoteEditor,
  onChange,
  onCancel,
  onSave,
  getContainer,
}) => {
  const language = inferLanguageByPath(remoteEditor.filePath)
  const remoteEditorRef = useLatest(remoteEditor)
  const onSaveRef = useLatest(onSave)

  const handleEditorWillMount = useMemoizedFn((monaco: unknown) => {
    registerNginxLanguage(monaco as MonacoLanguageApi)
  })

  const handleEditorMount = useMemoizedFn((editor: unknown, monaco: unknown) => {
    const monacoApi = monaco as {
      KeyMod: { CtrlCmd: number }
      KeyCode: { KeyS: number }
      editor: {
        addCommand?: (keybinding: number, handler: () => void) => void
      }
    }

    const editorInstance = editor as {
      addCommand?: (keybinding: number, handler: () => void) => void
    }

    const saveKeybinding = monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS
    editorInstance.addCommand?.(saveKeybinding, () => {
      const currentEditor = remoteEditorRef.current
      if (currentEditor.isLoading || currentEditor.isSaving || !currentEditor.isDirty) return
      void onSaveRef.current()
    })
  })

  return (
    <Modal
      title="远端文件编辑器"
      open={open}
      onCancel={onCancel}
      onOk={() => void onSave()}
      okText="保存"
      cancelText="关闭"
      confirmLoading={remoteEditor.isSaving}
      okButtonProps={{ disabled: remoteEditor.isLoading || remoteEditor.isSaving || !remoteEditor.isDirty }}
      cancelButtonProps={{ disabled: remoteEditor.isSaving }}
      keyboard={!remoteEditor.isSaving}
      width="86vw"
      styles={{ body: { paddingTop: 12 } }}
      destroyOnHidden
      maskClosable={!remoteEditor.isSaving}
      getContainer={getContainer}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Text type="secondary">当前文件：</Text>
          <Text code>{remoteEditor.filePath || '-'}</Text>
          {remoteEditor.isDirty && <Tag color="gold">未保存</Tag>}
          {remoteEditor.isSaving && <Tag color="processing">保存中</Tag>}
        </Space>

        {remoteEditor.errorText ? <Alert type="error" showIcon title={remoteEditor.errorText} /> : null}

        {remoteEditor.isLoading ? (
          <div style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" tip="正在读取远端文件..." />
          </div>
        ) : (
          <Editor
            height="62vh"
            theme="vs-dark"
            language={language}
            value={remoteEditor.content}
            beforeMount={handleEditorWillMount}
            onChange={(value) => onChange(value ?? '')}
            onMount={handleEditorMount}
            loading={<Spin size="small" />}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              tabSize: 2,
              fontSize: 13,
              scrollBeyondLastLine: false,
              readOnly: remoteEditor.isLoading || remoteEditor.isSaving,
              domReadOnly: remoteEditor.isLoading || remoteEditor.isSaving,
            }}
          />
        )}
      </Space>
    </Modal>
  )
}
