import type { FC } from 'react'
import { useState } from 'react'
import { KeyOutlined, LoginOutlined } from '@ant-design/icons'
import { Button, Layout, Space, Tag, Typography } from 'antd'
import { useMemoizedFn } from 'ahooks'
import { getAppConfig } from '../lib/appConfig'
import { LoginModal } from './LoginModal'

const { Header } = Layout
const { Text, Title } = Typography

export type LoginModalSubmitValues = {
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
}

type TopAuthPanelProps = {
  authToken: string
  authUserName: string
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
  authExpiresAt: string
  loginLoading: boolean
  accessKeyConfigured: boolean
  onLoginSubmit: (values: LoginModalSubmitValues) => Promise<boolean>
  onClearAuthError: () => void
  onOpenAccessKeyConfig: () => void
}

export const TopAuthPanel: FC<TopAuthPanelProps> = ({
  authToken,
  authUserName,
  jmsSessionId,
  csrfToken,
  expiresAt,
  authExpiresAt,
  loginLoading,
  accessKeyConfigured,
  onLoginSubmit,
  onClearAuthError,
  onOpenAccessKeyConfig,
}) => {
  const [showLoginModal, setShowLoginModal] = useState(false)
  const appConfig = getAppConfig()

  const handleOpenLoginModal = useMemoizedFn(() => {
    onClearAuthError()
    setShowLoginModal(true)
  })

  const handleLoginSubmit = useMemoizedFn(async (values: LoginModalSubmitValues) => {
    const success = await onLoginSubmit(values)
    if (success) setShowLoginModal(false)
  })

  return (
    <>
      <Header className="top-nav-shell">
        <div className="flex items-center justify-between gap-4 border-b border-[rgba(100,116,139,0.28)] p-0 max-[860px]:items-start max-[860px]:flex-col">
          <div className="flex flex-col gap-1">
            <Title level={4} className="!m-0">
              KoKo 在线终端
            </Title>
            <Text type="secondary" className="text-[13px]">
              当前部署上游 JumpServer：{appConfig?.host || '（未配置）'}，API 与 WebSocket 使用 jms_sessionid Cookie + X-JMS-ORG
            </Text>
          </div>

          <Space wrap>
            <Button icon={<KeyOutlined />} onClick={onOpenAccessKeyConfig}>
              {accessKeyConfigured ? 'AK/AS 已配置' : '配置 AK/AS'}
            </Button>
            {!authToken ? (
              <Button type="primary" onClick={handleOpenLoginModal} icon={<LoginOutlined />}>
                配置 jms_sessionid
              </Button>
            ) : (
              <Text>{authUserName || 'jms_sessionid 已配置'}</Text>
            )}
          </Space>
        </div>

        <div className="flex flex-col gap-2 p-0">
          <Space wrap>
            {authToken ? <Tag color="green">已登录</Tag> : <Tag>未登录</Tag>}
            {accessKeyConfigured ? <Tag color="cyan">AK/AS 已配置</Tag> : <Tag>AK/AS 未配置</Tag>}
            {authExpiresAt && authToken && <Text type="secondary" className="text-[13px]">认证失效时间：{authExpiresAt}</Text>}
          </Space>
        </div>
      </Header>

      <LoginModal
        open={showLoginModal}
        loading={loginLoading}
        jmsSessionId={jmsSessionId}
        csrfToken={csrfToken}
        expiresAt={expiresAt}
        onCancel={() => setShowLoginModal(false)}
        onSubmit={(values) => void handleLoginSubmit(values)}
      />
    </>
  )
}

