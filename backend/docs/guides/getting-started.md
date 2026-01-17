# 首次使用指南

## 🚀 快速开始

### 方式一：完全通过 Web 界面配置（推荐）

**无需创建 JSON 文件！** 系统会自动创建数据库，所有配置都可以通过 Web 界面完成。

#### 1. 安装依赖

```bash
# 进入项目目录
cd business-gemini-pool-main

# 安装 Python 依赖
pip install -r requirements.txt

# 安装 Playwright 浏览器（用于 Cookie 自动刷新，可选）
playwright install chromium
```

#### 2. 启动服务

```bash
python gemini.py
```

系统会自动：
- ✅ 创建数据库文件 `geminibusiness.db`
- ✅ 初始化数据库表结构
- ✅ 生成管理员密钥（如果不存在）

#### 3. 访问管理界面

打开浏览器访问：`http://localhost:8000`

#### 4. 首次登录

- 如果是第一次访问，系统会要求设置管理员密码
- 输入密码后，系统会自动保存到数据库

#### 5. 添加账号

在管理界面中：
1. 进入「账号管理」标签页
2. 点击「添加账号」按钮
3. 填写账号信息：
   - `team_id`: Google Cloud 团队 ID
   - `secure_c_ses`: `__Secure-C_SES` Cookie 值
   - `host_c_oses`: `__Host-C_OSES` Cookie 值
   - `csesidx`: 会话索引 ID
   - `user_agent`: 浏览器 User-Agent
4. 点击「保存」

#### 6. 创建 API 密钥

1. 进入「API 密钥管理」标签页
2. 点击「创建 API 密钥」按钮
3. 填写密钥信息（名称、描述、过期时间等）
4. 复制生成的 API 密钥（只显示一次）

#### 7. 开始使用

使用创建的 API 密钥调用 API：

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local-gemini-auto",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

### 方式二：使用 JSON 配置文件（从旧版本迁移）

如果你有现有的 JSON 配置文件，系统会自动迁移到数据库。

#### 1. 准备 JSON 配置文件

创建 `business_gemini_session.json` 文件：

```json
{
  "proxy": "http://127.0.0.1:7890",
  "image_base_url": "http://127.0.0.1:8000/",
  "log_level": "INFO",
  "accounts": [
    {
      "team_id": "your-team-id",
      "secure_c_ses": "your-secure-c-ses",
      "host_c_oses": "your-host-c-oses",
      "csesidx": "your-csesidx",
      "user_agent": "your-user-agent",
      "available": true
    }
  ],
  "models": [
    {
      "id": "local-gemini-auto",
      "name": "Gemini Auto",
      "description": "自动选择最合适的 Gemini 模型",
      "context_length": 32768,
      "max_tokens": 8192,
      "price_per_1k_tokens": "0.0015",
      "enabled": true,
      "account_index": 0
    }
  ]
}
```

#### 2. 启动服务

```bash
python gemini.py
```

系统会自动：
- ✅ 检测到 JSON 配置文件
- ✅ 自动迁移数据到数据库
- ✅ 之后优先使用数据库

控制台会显示：

```
[存储] 数据库为空，检测到 JSON 配置，开始自动迁移...
[迁移] 开始从 JSON 迁移数据到数据库...
[迁移] ✓ 迁移完成：1 个账号，1 个模型
[存储] ✓ 已切换到数据库存储
```

#### 3. 后续使用

迁移完成后，所有配置都会保存到数据库，JSON 文件保留作为备份。

---

## 📋 系统初始化流程

系统启动时会自动执行以下步骤：

1. **检查数据库**
   - 如果数据库存在且有数据 → 使用数据库
   - 如果数据库为空 → 继续检查

2. **检查 JSON 文件**
   - 如果 JSON 文件存在 → 自动迁移到数据库
   - 如果 JSON 文件不存在 → 使用空数据库（新安装）

3. **初始化配置**
   - 自动创建数据库表结构
   - 生成管理员密钥（如果不存在）
   - 加载账号和模型配置

---

## ✅ 验证安装

启动服务后，检查控制台输出：

```
[存储] 使用数据库存储（新安装）
[账号配置]
  总数量: 0
  可用数量: 0
[模型配置]
  - gemini-enterprise (默认)
```

如果看到这些信息，说明系统已成功初始化。

---

## 🔧 常见问题

### Q: 必须创建 JSON 文件吗？

**A: 不需要！** 系统会自动创建数据库，所有配置都可以通过 Web 界面完成。

### Q: JSON 文件的作用是什么？

**A: JSON 文件主要用于：**
- 从旧版本迁移数据
- 备份和恢复配置
- 批量导入配置

### Q: 数据库文件在哪里？

**A: 数据库文件位置：**
- 文件路径：`geminibusiness.db`
- 位置：项目根目录
- 格式：SQLite 数据库

### Q: 如何备份配置？

**A: 在 Web 管理界面：**
1. 进入「系统设置」标签页
2. 点击「下载配置」按钮
3. 会下载一个 JSON 文件，包含所有配置

### Q: 如何恢复配置？

**A: 在 Web 管理界面：**
1. 进入「系统设置」标签页
2. 点击「导入配置」按钮
3. 选择之前备份的 JSON 文件
4. 系统会自动导入并保存到数据库

---

## 📚 相关文档

- [部署指南](./deployment.md) - 部署说明
- [API密钥管理](./api-keys.md) - API 密钥使用

---

## 🎯 总结

**首次使用推荐流程：**

1. ✅ 安装依赖
2. ✅ 启动服务（无需创建 JSON 文件）
3. ✅ 访问 Web 管理界面
4. ✅ 设置管理员密码
5. ✅ 通过 Web 界面添加账号和配置
6. ✅ 创建 API 密钥
7. ✅ 开始使用 API

**无需手动创建 JSON 文件！** 系统会自动处理所有初始化工作。

