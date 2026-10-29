import type { FC } from 'react'
import { useEffect } from 'react'
import { Alert, Form, Input, Modal, Select, Typography } from 'antd'
import type { AssetOption } from '../features/koko/types'

const { Text } = Typography

type CreateTokenFormValues = {
  selectedAssetId: string
  expiryDate: string
  alias: string
}

type CreateConnectionTokenModalProps = {
  open: boolean
  loading: boolean
  assetsLoading: boolean
  selectedAssetId: string
  expiryDate: string
  alias: string
  selectedAssetName: string
  assetOptions: AssetOption[]
  onCancel: () => void
  onSubmit: (values: CreateTokenFormValues) => void
}

export const CreateConnectionTokenModal: FC<CreateConnectionTokenModalProps> = ({
  open,
  loading,
  assetsLoading,
  selectedAssetId,
  expiryDate,
  alias,
  selectedAssetName,
  assetOptions,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<CreateTokenFormValues>()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ selectedAssetId, expiryDate, alias })
  }, [alias, expiryDate, form, open, selectedAssetId])

  return (
    <Modal
      title="创建连接令牌"
      open={open}
      onCancel={onCancel}
      onOk={() => void form.submit()}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form<CreateTokenFormValues>
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values)}
        autoComplete="off"
      >
        <Form.Item
          label="资产"
          name="selectedAssetId"
          rules={[
            { required: true, message: '请选择资产。' },
          ]}
        >
          <Select
            placeholder="选择资产"
            showSearch={{ optionFilterProp: 'label' }}
            loading={assetsLoading}
            disabled={assetsLoading}
            options={assetOptions.map((item) => ({
              value: item.value,
              label: item.label,
              title: item.description,
            }))}
          />
        </Form.Item>

        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="JumpServer 4.10.16 会在服务端生成连接令牌失效时间，前端不再提交 date_expired。"
        />

        <Form.Item
          label="连接令牌别名"
          name="alias"
          rules={[
            { required: true, message: '请输入别名。' },
          ]}
        >
          <Input placeholder="例如：生产主机跳板 token" maxLength={64} />
        </Form.Item>

        <Text type="secondary" className="text-[13px]">
          当前选中资产：{selectedAssetName || '未选择'}；账号、协议和连接方式会从该资产的授权详情中自动选择。
        </Text>
      </Form>
    </Modal>
  )
}
