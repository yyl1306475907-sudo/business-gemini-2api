# Tempmail - 临时邮箱服务

简单的临时邮箱服务，用于接收 Gemini Business 注册验证邮件。

## 功能

- ✅ 创建临时邮箱
- ✅ 接收邮件（通过 Webhook）
- ✅ 生成 JWT Token URL
- ✅ 简洁的 Web 界面

## Zeabur 部署（推荐）

### 1. 部署服务

1. Fork 本项目到你的 GitHub
2. 在 Zeabur 创建新项目，选择 Git 部署
3. 选择 `tempmail` 目录
4. Zeabur 会自动检测并构建

### 2. 配置环境变量

在 Zeabur 的"变量"选项卡设置：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `JWT_SECRET` | JWT 密钥（随机字符串） | ✅ |
| `MAIL_DOMAIN` | 邮箱域名 | ❌ |

### 3. 配置持久化存储

在"存储"选项卡添加存储卷：
- 挂载路径：`/app/data`

### 4. 获取访问地址

在"网络"选项卡生成域名，记录地址用于配置前端。

## 配置邮件接收

使用 Cloudflare Email Routing 等服务将邮件转发到：

```
POST https://your-tempmail.zeabur.app/api/webhook/receive
```

Webhook 格式：
```json
{
  "to": "user@yourdomain.com",
  "from": "sender@example.com",
  "subject": "Email Subject",
  "text": "Plain text content"
}
```

## 在前端中使用

1. 访问临时邮箱服务，创建邮箱
2. 复制生成的 URL（格式：`https://your-domain/?jwt=xxx`）
3. 在前端"系统设置"中填入临时邮箱服务地址

## 本地开发

```bash
cd tempmail
npm install
npm run dev
```

访问 `http://localhost:3000`

更多信息请查看主 [README](../README.md)。
