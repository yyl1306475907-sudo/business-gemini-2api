# Backend - Business Gemini API 服务

后端 API 服务，提供 OpenAI 兼容的接口，支持多账号管理、自动刷新、图片生成等功能。

## 功能特性

### 核心功能
- ✅ OpenAI 兼容的 API 接口
- ✅ 支持流式响应 (SSE)
- ✅ 图片生成（Markdown 格式渲染）
- ✅ 视频生成
- ✅ 文件上传
- ✅ 多账号管理和负载均衡

### 自动化功能
- ✅ 自动刷新过期 Cookie（通过前端触发）
- ✅ 账号健康检查
- ✅ 配额管理和冷却机制
- ✅ JWT 自动管理

### 管理功能
- ✅ Web 管理界面
- ✅ API Key 管理
- ✅ 账号状态监控
- ✅ 聊天历史记录

## Zeabur 部署（推荐）

### 1. 准备工作

1. Fork 本项目到你的 GitHub 账号
2. 注册 [Zeabur](https://zeabur.com) 账号

### 2. 部署步骤

1. 在 Zeabur 控制台点击"创建新项目"
2. 选择"从 Git 部署"
3. 连接你的 GitHub 仓库
4. 选择 `backend` 目录作为根目录
5. Zeabur 会自动检测 Python 项目并安装依赖

### 3. 配置环境变量

在 Zeabur 的"变量"选项卡中添加：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `ADMIN_PASSWORD` | 管理员密码 | ✅ |
| `TEMP_MAIL_URL` | 临时邮箱服务地址（用于自动刷新） | ❌ |
| `DATA_DIR` | 数据存储目录 | ❌ |

### 4. 配置持久化存储（可选）

在 Zeabur 的"存储"选项卡添加存储卷：
- 挂载路径：`/app/data`
- 用于保存账号数据、图片缓存等

### 5. 获取访问地址

在"网络"选项卡中：
1. 生成域名或绑定自定义域名
2. 记录访问地址，用于配置前端

## 本地运行

```bash
cd backend
pip install -r requirements.txt
python gemini.py
```

服务将在 `http://localhost:8000` 启动。

## 环境变量说明

```env
# 管理员密码（必填）
ADMIN_PASSWORD=your_admin_password

# 临时邮箱服务地址（可选，用于自动刷新 Cookie）
TEMP_MAIL_URL=https://your-tempmail-service.com

# 数据存储目录（可选）
DATA_DIR=./data
```

## 使用说明

### 1. 首次登录

1. 访问你的后端地址（如 `https://your-backend.zeabur.app`）
2. 使用环境变量中设置的 `ADMIN_PASSWORD` 登录
3. 进入管理界面

### 2. 创建 API Key

1. 在管理界面点击"API 密钥管理"
2. 点击"创建新密钥"
3. 复制生成的 API Key，用于调用接口

### 3. 添加账号

**方式一：通过前端自动注册**（推荐）
- 使用前端面板自动注册账号，会自动推送到后端

**方式二：手动添加**
1. 在管理界面点击"添加账号"
2. 填入账号信息（邮箱、Cookie 等）
3. 保存

### 4. 配置账号健康检查

1. 在"系统设置"中启用"账号健康检查"
2. 设置检查间隔（建议 30-60 分钟）
3. 系统会自动标记过期账号

### 5. 调用 API

```bash
curl https://your-backend.zeabur.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-enterprise",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

## 支持的模型

- `gemini-enterprise` - Gemini Enterprise（默认）
- `gemini-image` - 图片生成
- `gemini-video` - 视频生成

可在 Web 管理界面自定义模型配置。

## 与前端配合使用

1. 部署后端并获取访问地址
2. 在前端的"系统设置"中配置：
   - Business Gemini 后台地址：`https://your-backend.zeabur.app`
   - Business Gemini 密码：你的 `ADMIN_PASSWORD`
3. 前端会自动将注册的账号推送到后端
4. 前端可以触发过期账号的自动刷新

## 常见问题

**Q: 如何查看账号状态？**  
A: 在管理界面的"账号管理"中可以看到所有账号的状态、配额、过期时间等信息。

**Q: 账号过期了怎么办？**  
A: 使用前端面板的"立即刷新全部"功能，会自动刷新所有过期账号的 Cookie。

**Q: 如何删除不可用的账号？**  
A: 在管理界面点击"批量删除不可用"按钮，一键清理所有不可用账号。

更多信息请查看主 [README](../README.md)。
