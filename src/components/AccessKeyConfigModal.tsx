import type { FC } from 'react'
import { useEffect } from 'react'
import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd'

const { Text } = Typography

type AccessKeySettings = {
  accessKeyId: string
  accessKeySecret: string
}

type AccessKeyConfigModalProps = {
  open: boolean
  settings: AccessKeySettings
  onCancel: () => void
  onSubmit: (settings: AccessKeySettings) => void
  onClear: () => void
}

export const AccessKeyConfigModal: FC<AccessKeyConfigModalProps> = ({
  open,
  settings,
  onCancel,
  onSubmit,
  onClear,
}) => {
  const [form] = Form.useForm<AccessKeySettings>()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue(settings)
  }, [form, open, settings])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    onSubmit({
      accessKeyId: values.accessKeyId.trim(),
      accessKeySecret: values.accessKeySecret.trim(),
    })
  }

  const handleClear = () => {
    form.setFieldsValue({ accessKeyId: '', accessKeySecret: '' })
    onClear()
  }

  return (
    <Modal
      title="配置 AK / AS"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      width={560}
      styles={{ body: { paddingTop: 12 } }}
    >
      <Space className="w-full" direction="vertical" size="middle">
        <Alert
          showIcon
          type="info"
          message="本地 Access Key 设置"
          description="AK / AS 会保存在当前浏览器 localStorage，并同步到同源 Cookie，供任务日志 WebSocket 代理读取。"
        />

        <Form<AccessKeySettings>
          form={form}
          layout="vertical"
          initialValues={settings}
        >
          <Form.Item
            label="Access Key ID"
            name="accessKeyId"
            rules={[{ required: true, message: '请输入 Access Key ID' }]}
          >
            <Input allowClear placeholder="请输入 AK" autoComplete="off" />
          </Form.Item>

          <Form.Item
            label="Access Key Secret"
            name="accessKeySecret"
            rules={[{ required: true, message: '请输入 Access Key Secret' }]}
          >
            <Input.Password allowClear placeholder="请输入 AS" autoComplete="off" />
          </Form.Item>

          <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
            <Text type="secondary" className="text-[13px]">
              保存后页头会显示 AK/AS 已配置，可随时清空或覆盖。
            </Text>
            <Space>
              <Button onClick={handleClear}>清空</Button>
              <Button type="primary" onClick={() => void handleSubmit()}>
                保存配置
              </Button>
            </Space>
          </div>
        </Form>
      </Space>
    </Modal>
  )
}
