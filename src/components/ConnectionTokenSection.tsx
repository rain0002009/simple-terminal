import type { FC } from 'react'
import { Button, Input, Select, Space, Tag, Typography } from 'antd'
import type { AssetOption } from '../features/koko/types'

const { Text, Title } = Typography

type ConnectionTokenSectionProps = {
  authToken: string
  selectedAssetName: string
  selectedAssetId: string
  assetOptions: AssetOption[]
  assetsLoading: boolean
  createTokenLoading: boolean
  expiryDate: string
  assetsError: string
  tokenActionError: string
  onAssetChange: (value: string) => void
  onExpiryDateChange: (value: string) => void
  onCreateConnectionToken: () => void
}

export const ConnectionTokenSection: FC<ConnectionTokenSectionProps> = ({
  authToken,
  selectedAssetName,
  selectedAssetId,
  assetOptions,
  assetsLoading,
  createTokenLoading,
  expiryDate,
  assetsError,
  tokenActionError,
  onAssetChange,
  onExpiryDateChange,
  onCreateConnectionToken,
}) => (
  <div className="control-section">
    <div className="flex items-center justify-between gap-3 max-[860px]:items-stretch max-[860px]:flex-col">
      <Title level={5} className="!m-0">
        2. 创建 Connection Token
      </Title>
      {selectedAssetName && <Tag color="blue">{selectedAssetName}</Tag>}
    </div>
    <div className="grid grid-cols-2 gap-3 max-[860px]:grid-cols-1">
      <Select
        placeholder={authToken ? '选择资产' : '请先配置 jms_sessionid 后加载资产'}
        showSearch={{ optionFilterProp: 'label' }}
        value={selectedAssetId || undefined}
        onChange={onAssetChange}
        loading={assetsLoading}
        disabled={!authToken || assetsLoading}
        options={assetOptions.map((item) => ({
          value: item.value,
          label: item.label,
          title: item.description,
        }))}
      />
      <Input
        type="date"
        value={expiryDate}
        onChange={(event) => onExpiryDateChange(event.target.value)}
        disabled={!authToken || createTokenLoading}
      />
    </div>
    <Space wrap>
      <Button
        type="primary"
        onClick={onCreateConnectionToken}
        loading={createTokenLoading}
        disabled={!authToken || !selectedAssetId}
      >
        创建 Connection Token
      </Button>
    </Space>
    <Text type="secondary" className="text-[13px]">
      JumpServer 会在服务端生成失效时间；创建成功后会自动刷新列表，并把返回的 token 写入下方连接列表。
    </Text>
    {assetsError && (
      <Text type="danger" className="text-[13px]">
        {assetsError}
      </Text>
    )}
    {tokenActionError && (
      <Text type="danger" className="text-[13px]">
        {tokenActionError}
      </Text>
    )}
  </div>
)
