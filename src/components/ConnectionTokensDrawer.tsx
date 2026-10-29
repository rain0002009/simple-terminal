import type { FC } from 'react'
import { KeyOutlined, PlusCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Drawer, Space, Typography } from 'antd'
import type { ConnectionTokenRecord } from '../features/koko/types'
import { formatDisplayDate } from '../features/koko/utils'

const { Text } = Typography

type ConnectionTokensDrawerProps = {
  open: boolean
  tokenListLoading: boolean
  connectionTokens: ConnectionTokenRecord[]
  onClose: () => void
  onRefresh: () => void
  onCreateToken: () => void
}

export const ConnectionTokensDrawer: FC<ConnectionTokensDrawerProps> = ({
  open,
  tokenListLoading,
  connectionTokens,
  onClose,
  onRefresh,
  onCreateToken,
}) => (
  <Drawer
    title="当前有效的连接令牌"
    placement="right"
    size={560}
    open={open}
    onClose={onClose}
    extra={
      <Space>
        <Button onClick={onRefresh} loading={tokenListLoading} icon={<ReloadOutlined />}>
          刷新
        </Button>
        <Button type="primary" onClick={onCreateToken} icon={<PlusCircleOutlined />}>
          创建连接令牌
        </Button>
      </Space>
    }
  >
    <Space orientation="vertical" className="w-full" size="middle">
      <Text type="secondary" className="text-[13px]">
        共 {connectionTokens.length} 个有效连接令牌。
      </Text>

      <div className="flex flex-col gap-[10px]">
        {connectionTokens.length === 0 ? (
          <Text type="secondary" className="text-[13px]">
            当前没有查询到有效的连接令牌。
          </Text>
        ) : (
          connectionTokens.map((item) => (
            <div
              className="flex items-center justify-between gap-3 rounded-[10px] border border-[rgba(100,116,139,0.24)] bg-[rgba(15,23,42,0.55)] p-3 max-[860px]:items-stretch max-[860px]:flex-col"
              key={item.id}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Text strong copyable={{ text: item.id }}>
                  <KeyOutlined className="mr-[6px]" />
                  连接令牌 ID：{item.id}
                </Text>
                <Text type="secondary">资产名称：{item.assetName}</Text>
                <Text type="secondary">创建日期：{formatDisplayDate(item.createdAt)}</Text>
                <Text type="secondary">失效日期：{formatDisplayDate(item.expiresAt)}</Text>
              </div>
            </div>
          ))
        )}
      </div>
    </Space>
  </Drawer>
)
