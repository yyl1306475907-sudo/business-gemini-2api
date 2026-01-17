# Frontend - 自动注册管理面板

前端管理面板，用于自动注册 Gemini Business 账号和管理过期 Cookie 刷新。

## 功能特性

- ✅ 批量自动注册账号
- ✅ 自动创建临时邮箱
- ✅ 自动获取 Cookie 并推送到后端
- ✅ 过期 Cookie 自动刷新
- ✅ 定时自动注册
- ✅ 实时日志查看

## Hugging Face Spaces 部署（推荐）

### 1. 准备工作

1. Fork 本项目到你的 GitHub 账号
2. 注册 [Hugging Face](https://huggingface.co) 账号

### 2. 部署步骤

1. 在 Hugging Face 创建新的 Space
2. 选择 Docker SDK
3. 连接你的 GitHub 仓库
4. 选择 `frontend` 目录作为根目录
5. Space 会自动构建并部署

### 3. 配置服务

部署完成后：
1. 访问你的 Space 地址
2. 点击右上角"系统设置"
3. 配置以下信息：
   - **临时邮箱服务地址**：你的 tempmail 服务地址
   - **Business Gemini 后台地址**：你的后端服务地址
   - **Business Gemini 密码**：后端的 ADMIN_PASSWORD
   - **YesCaptcha API Key**：从 [YesCaptcha](https://yescaptcha.com) 获取

### 4. 开始使用

1. 配置完成后，点击"开始自动注册"
2. 系统会自动批量注册账号并推送到后端
3. 注册成功的账号可在后端管理界面查看

## 本地运行

```bash
cd frontend
npm install
node app-v6.js
```

访问 `http://localhost:7860`

## 主要功能说明

### 自动注册
- 点击"开始自动注册"批量创建账号
- 可配置注册数量和间隔时间
- 自动推送到后端

### 过期 Cookie 管理
- 自动同步后端的过期账号
- 点击"立即刷新全部"批量刷新过期 Cookie
- 刷新成功后自动从列表移除

### 系统设置
- 所有配置可通过 Web 界面修改
- 配置保存在 `runtime_config.json`
- 支持配置注册/刷新间隔时间

## 环境变量（可选）

也可以通过环境变量预设配置：

| 变量名 | 说明 |
|--------|------|
| `PORT` | 服务端口（默认 7860） |
| `TEMP_MAIL_URL` | 临时邮箱服务地址 |
| `YESCAPTCHA_API_KEY` | YesCaptcha API Key |
| `BUSINESS_GEMINI_URL` | 后端服务地址 |
| `BUSINESS_GEMINI_PASSWORD` | 后端管理员密码 |

更多信息请查看主 [README](../README.md)。

