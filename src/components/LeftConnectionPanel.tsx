import { useMemo } from 'react'
import type { FC } from 'react'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { Button, Card, Layout, Select, Space, Tooltip, Typography } from 'antd'
import type { AssetOption, Phase } from '../features/koko/types'
import { TerminalStatus } from './TerminalStatus'

const { Sider } = Layout
const { Text } = Typography

type LeftConnectionPanelProps = {
  assetOptions: AssetOption[]
  favoriteAssetOptions: AssetOption[]
  favoriteAssetIds: string[]
  selectedAssetId: string
  assetsLoading: boolean
  isConnecting: boolean
  favoriteAssetsLoading: boolean
  favoriteActionAssetId: string
  activeTabIsBusy: boolean
  phase: Phase
  statusText: string
  sessionId: string
  closeText: string
  onSelectedAssetChange: (assetId: string) => void
  onToggleFavoriteAsset: (assetId: string) => void
  onConnect: () => void
  onDisconnect: () => void
}

export const LeftConnectionPanel: FC<LeftConnectionPanelProps> = ({
  assetOptions,
  favoriteAssetOptions,
  favoriteAssetIds,
  selectedAssetId,
  assetsLoading,
  isConnecting,
  favoriteAssetsLoading,
  favoriteActionAssetId,
  activeTabIsBusy,
  phase,
  statusText,
  sessionId,
  closeText,
  onSelectedAssetChange,
  onToggleFavoriteAsset,
  onConnect,
  onDisconnect,
}) => {
  const selectedAssetIsFavorite = favoriteAssetIds.includes(selectedAssetId)
  const selectedFavoriteAssetId = selectedAssetIsFavorite ? selectedAssetId : undefined
  const favoriteOptions = useMemo(
    () => favoriteAssetOptions.map((item) => ({
      value: item.value,
      label: item.label,
      title: item.description,
    })),
    [favoriteAssetOptions],
  )
  const allAssetOptions = useMemo(
    () => Array.from(
      new Map([...assetOptions, ...favoriteAssetOptions].map((item) => [item.value, item])).values(),
    ).map((item) => ({
      value: item.value,
      label: item.label,
      title: item.description,
    })),
    [assetOptions, favoriteAssetOptions],
  )

  const selectedAssetLabel = allAssetOptions.find((item) => item.value === selectedAssetId)?.label ?? ''
  const renderAssetOption = (label: unknown) => (
    <span className="block whitespace-normal break-all leading-5">
      {typeof label === 'string' ? label : ''}
    </span>
  )

  return (
  <Sider className="min-h-0 bg-transparent max-md:!max-w-full max-md:!w-full max-md:!flex-0-0-full" width={300}>
    <Card className="control-pane" title="连接控制">
      <Space orientation="vertical" className="w-full" size="middle">
        <div className="flex gap-2">
          <Tooltip title={selectedAssetLabel}>
            <Select
              className="min-w-0 flex-1"
              popupMatchSelectWidth={false}
              placeholder="选择资产"
              value={selectedAssetId || undefined}
              onChange={onSelectedAssetChange}
              loading={assetsLoading}
              showSearch={{ optionFilterProp: 'label' }}
              options={allAssetOptions}
              optionRender={(option) => renderAssetOption(option.label)}
              styles={{ popup: { root: { maxWidth: 720, minWidth: 520 } } }}
            />
          </Tooltip>
          <Tooltip title={selectedAssetIsFavorite ? '取消收藏当前资产' : '收藏当前资产'}>
            <Button
              aria-label={selectedAssetIsFavorite ? '取消收藏当前资产' : '收藏当前资产'}
              icon={selectedAssetIsFavorite ? <StarFilled /> : <StarOutlined />}
              loading={favoriteActionAssetId === selectedAssetId}
              disabled={!selectedAssetId || Boolean(favoriteActionAssetId)}
              onClick={() => onToggleFavoriteAsset(selectedAssetId)}
            />
          </Tooltip>
        </div>

        <div className="flex flex-col gap-1">
          <Text type="secondary" className="text-[13px]">
            收藏资产
          </Text>
          <Select
            className="w-full"
            popupMatchSelectWidth={false}
            placeholder="选择已收藏资产"
            value={selectedFavoriteAssetId}
            onChange={onSelectedAssetChange}
            loading={favoriteAssetsLoading}
            disabled={favoriteAssetsLoading || favoriteAssetOptions.length === 0}
            showSearch={{ optionFilterProp: 'label' }}
            options={favoriteOptions}
            optionRender={(option) => renderAssetOption(option.label)}
            styles={{ popup: { root: { maxWidth: 720, minWidth: 520 } } }}
          />
        </div>

        <div className="connection-control-actions">
          <Space wrap>
            <Button
              type="primary"
              onClick={onConnect}
              disabled={!selectedAssetId || isConnecting}
              loading={isConnecting}
            >
              连接
            </Button>
            <Button
              onClick={onDisconnect}
              disabled={!activeTabIsBusy}
            >
              断开
            </Button>
          </Space>
        </div>

        <TerminalStatus
          phase={phase}
          statusText={statusText}
          sessionId={sessionId}
          closeText={closeText}
        />

      </Space>
    </Card>
  </Sider>
)
}
