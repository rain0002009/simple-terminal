import type { FC } from 'react'
import { Space, Typography } from 'antd'
import { phaseTextMap } from '../features/koko/constants'
import type { Phase } from '../features/koko/types'

const { Text } = Typography

type TerminalStatusProps = {
  phase: Phase
  statusText: string
  sessionId: string
  closeText: string
}

export const TerminalStatus: FC<TerminalStatusProps> = ({
  phase,
  statusText,
  sessionId,
  closeText,
}) => (
  <Space orientation="vertical" size={2} className="w-full">
    <Text>
      当前状态：<Text strong>{phaseTextMap[phase]}</Text>
    </Text>
    <Text type="secondary" className="text-[13px]">
      {statusText}
    </Text>
    {sessionId && (
      <Text type="secondary" className="text-[13px]">
        Session ID: {sessionId}
      </Text>
    )}
    {closeText && (
      <Text type="warning" className="text-[13px]">
        Close: {closeText}
      </Text>
    )}
  </Space>
)
