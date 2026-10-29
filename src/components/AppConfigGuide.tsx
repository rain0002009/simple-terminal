import { Alert, Result, Typography } from 'antd'

const { Paragraph, Text } = Typography

interface AppConfigGuideProps {
  error: unknown
}

const toMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export default function AppConfigGuide({ error }: AppConfigGuideProps) {
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <Result
        status="warning"
        title="部署配置未就绪"
        subTitle="应用需要从 /config.json 读取部署配置后才能启动。"
      >
        <Alert
          type="error"
          showIcon
          message="读取失败原因"
          description={<Text code>{toMessage(error)}</Text>}
          className="text-left max-w-[720px] mx-auto mb-4"
        />
        <Paragraph className="text-left max-w-[720px] mx-auto">
          请在服务端完成以下配置后刷新页面：
        </Paragraph>
        <Paragraph className="text-left max-w-[720px] mx-auto">
          <ol className="list-decimal pl-5 leading-7">
            <li>
              复制 <Text code>.env.example</Text> 为 <Text code>.env</Text>（开发环境放仓库根目录，生产环境放{' '}
              <Text code>server/</Text> 或仓库根目录）
            </li>
            <li>
              填写必填项 <Text code>TARGET_HTTP</Text>、<Text code>TARGET_WS</Text>、<Text code>TARGET_ORIGIN</Text>、{' '}
              <Text code>ORG_ID</Text>
            </li>
            <li>
              重启 <Text code>server.mjs</Text>（或重新启动 <Text code>vite dev</Text>）
            </li>
          </ol>
        </Paragraph>
      </Result>
    </div>
  )
}
