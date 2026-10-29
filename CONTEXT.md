# koko Web Terminal

面向 JumpServer 的 Web 终端工作区：浏览器端终端会话 + AI 助手面板，由一个 Node BFF（`server.mjs`）托管前端产物并代理上游。

## Language

**部署配置**（Deployment config）：
部署者在部署期一次性设定的值，决定该实例连接哪个 JumpServer、使用哪个 AI 上游。每个部署各不相同。
_Avoid_: 环境变量、全局配置

**连接配置**（Connection config）：
部署配置中决定 JumpServer 连接目标的部分，至少包含主机地址与组织 ID。
_Avoid_: 服务器地址、Host 配置

**用户设置**（User settings）：
单个终端用户在浏览器中自行设定并保存的偏好，如自定义命令、AI 面板参数。
_Avoid_: 配置（指用户偏好时）、首选项

**协议常量**（Protocol constant）：
JumpServer / koko 协议固定的值（子协议名、cookie 名、API 路径形状），所有部署相同，不进配置。
_Avoid_: 配置（指这些值时）、硬编码常量
