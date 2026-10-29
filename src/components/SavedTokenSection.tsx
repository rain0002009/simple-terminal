import type { FC } from 'react'
import {
  CloseOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  LinkOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { Button, Divider, Drawer, Input, Popconfirm, Select, Space, Typography } from 'antd'
import type { SavedToken } from '../features/koko/types'

const { Text } = Typography

type SavedTokenSectionProps = {
  savedTokens: SavedToken[]
  selectedTokenId: string
  isBusy: boolean
  showTokenManager: boolean
  newTokenName: string
  newTokenValue: string
  onSelectedTokenChange: (id: string) => void
  onConnect: () => void
  onDisconnect: () => void
  onToggleManager: () => void
  onNewTokenNameChange: (value: string) => void
  onNewTokenValueChange: (value: string) => void
  onAddToken: () => void
  onDeleteToken: (id: string) => void
}

export const SavedTokenSection: FC<SavedTokenSectionProps> = ({
  savedTokens,
  selectedTokenId,
  isBusy,
  showTokenManager,
  newTokenName,
  newTokenValue,
  onSelectedTokenChange,
  onConnect,
  onDisconnect,
  onToggleManager,
  onNewTokenNameChange,
  onNewTokenValueChange,
  onAddToken,
  onDeleteToken,
}) => (
  <>
    <Space orientation="vertical" size="small" className="w-full">
      <Select
        className="w-full"
        placeholder={savedTokens.length === 0 ? '请先在本地连接令牌管理中添加连接令牌' : '选择连接令牌'}
        value={selectedTokenId || undefined}
        onChange={onSelectedTokenChange}
        options={savedTokens.map((token) => ({ value: token.id, label: token.name }))}
      />
      <div className="connection-control-actions">
        <Space wrap>
          <Button type="primary" onClick={onConnect} disabled={!selectedTokenId} icon={<LinkOutlined />}>
            连接
          </Button>
          <Button onClick={onDisconnect} disabled={!isBusy} icon={<DisconnectOutlined />}>
            断开
          </Button>
        </Space>
        <Button
          onClick={onToggleManager}
          icon={showTokenManager ? <CloseOutlined /> : <SettingOutlined />}
          aria-label={showTokenManager ? '关闭本地连接令牌管理' : '打开本地连接令牌管理'}
        />
      </div>
    </Space>

    <Drawer
      title="本地连接令牌管理"
      placement="right"
      size={500}
      open={showTokenManager}
      onClose={onToggleManager}
      destroyOnHidden
    >
        <Space orientation="vertical" className="w-full" size="small">
          <Space.Compact className="w-full">
            <Input
              placeholder="名称（如：生产服务器A）"
              value={newTokenName}
              onChange={(event) => onNewTokenNameChange(event.target.value)}
              className="w-[35%]"
              autoComplete="off"
              onPressEnter={onAddToken}
            />
            <Input.Password
              placeholder="连接令牌 ID"
              value={newTokenValue}
              onChange={(event) => onNewTokenValueChange(event.target.value)}
              className="flex-1"
              autoComplete="off"
              onPressEnter={onAddToken}
            />
            <Button
              type="primary"
              onClick={onAddToken}
              disabled={!newTokenName.trim() || !newTokenValue.trim()}
              icon={<PlusOutlined />}
            >
              添加
            </Button>
          </Space.Compact>

          {savedTokens.length > 0 && (
            <>
              <Divider className="my-[6px]" />
              {savedTokens.map((item) => (
                <Space key={item.id} className="w-full justify-between">
                  <Text>{item.name}</Text>
                  <Popconfirm
                    title="确认删除此连接令牌？"
                    onConfirm={() => onDeleteToken(item.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ))}
            </>
          )}
        </Space>
    </Drawer>
  </>
)
