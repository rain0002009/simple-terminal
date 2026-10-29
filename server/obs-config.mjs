// OBS 凭据来自部署配置（.env），代码里不再保存任何密钥。
// 用函数延迟读取，保证 load-env.mjs 先于调用方执行即可，不受模块求值顺序影响。
export const getObsAccessKeyId = () => String(process.env.OBS_ACCESS_KEY_ID ?? '').trim()
export const getObsSecretAccessKey = () => String(process.env.OBS_SECRET_ACCESS_KEY ?? '').trim()
