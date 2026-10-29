import type { FC } from 'react'
import { useEffect } from 'react'
import { Form, Input, Modal, Typography } from 'antd'

const { Text } = Typography

type LoginFormValues = {
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
}

type LoginModalProps = {
  open: boolean
  loading: boolean
  jmsSessionId: string
  csrfToken: string
  expiresAt: string
  onCancel: () => void
  onSubmit: (values: LoginFormValues) => void
}

export const LoginModal: FC<LoginModalProps> = ({
  open,
  loading,
  jmsSessionId,
  csrfToken,
  expiresAt,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<LoginFormValues>()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ jmsSessionId, csrfToken, expiresAt })
  }, [csrfToken, expiresAt, form, jmsSessionId, open])

  return (
    <Modal
      title="jms_sessionid 认证"
      open={open}
      onCancel={onCancel}
      onOk={() => void form.submit()}
      okText="保存并加载资产"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form<LoginFormValues>
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values)}
        autoComplete="off"
      >
        <Form.Item
          label="jms_sessionid"
          name="jmsSessionId"
          rules={[
            { required: true, whitespace: true, message: '请输入 jms_sessionid。' },
          ]}
        >
          <Input.Password placeholder="从 JumpServer 登录 Cookie 中复制 jms_sessionid" onPressEnter={() => void form.submit()} />
        </Form.Item>
        <Form.Item
          label="jms_csrftoken"
          name="csrfToken"
          rules={[
            { required: true, whitespace: true, message: '请输入 jms_csrftoken。' },
          ]}
        >
          <Input placeholder="从 JumpServer 登录 Cookie 中复制 jms_csrftoken" />
        </Form.Item>
        <Form.Item
          label="失效时间（Cookie Expires）"
          name="expiresAt"
          rules={[
            { required: true, whitespace: true, message: '请输入 Cookie Expires。' },
          ]}
        >
          <Input placeholder="例如：Wed, 11 Jun 2026 08:00:00 GMT" />
        </Form.Item>
        <Text type="secondary" className="text-[13px]">
          jms_sessionid、jms_csrftoken 和 Expires 可以直接从 JumpServer 原页面 Cookie 里复制；这里会写入当前站点 Cookie，并为 POST 请求添加 X-CSRFToken。
        </Text>
      </Form>
    </Modal>
  )
}
