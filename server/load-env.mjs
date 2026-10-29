import fs from 'node:fs'
import path from 'node:path'

// Node 16 没有 --env-file，这里做最小 .env 解析：KEY=VALUE，支持 # 注释与引号包裹。
// 语义与 dotenv 一致：已存在的 process.env 变量优先，不被文件覆盖。
const parseEnvFile = (content) => {
  const entries = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    entries[key] = value
  }

  return entries
}

// 依次在给定目录里找 .env，加载第一个找到的，返回其路径（都没有则返回 ''）。
export const loadDotEnv = (dirs) => {
  for (const dir of dirs) {
    const filePath = path.join(dir, '.env')
    if (!fs.existsSync(filePath)) continue

    const entries = parseEnvFile(fs.readFileSync(filePath, 'utf8'))
    for (const [key, value] of Object.entries(entries)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
    return filePath
  }

  return ''
}
