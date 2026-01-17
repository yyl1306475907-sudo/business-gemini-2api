# API 密钥管理系统使用说明

## 📋 功能概述

API 密钥管理系统提供了完整的 API 密钥生成、管理和监控功能，替代了原有的简单 Token 机制。

### 核心功能

- ✅ **密钥生成**：自动生成 UUID 格式的 API 密钥
- ✅ **密钥管理**：创建、查看、撤销、删除 API 密钥
- ✅ **过期管理**：支持设置密钥过期时间
- ✅ **使用统计**：详细的调用统计和日志
- ✅ **安全存储**：密钥哈希存储，加密保存

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install cryptography
```

或安装所有依赖：

```bash
pip install -r requirements.txt
```

### 2. 启动服务

```bash
python gemini.py
```

数据库会自动初始化，创建 API 密钥相关的表。

---

## 📖 使用指南

### 创建 API 密钥

1. **通过 Web 界面**
   - 登录管理控制台
   - 进入「系统设置」标签页
   - 找到「API 密钥管理」部分
   - 点击「创建 API 密钥」按钮
   - 填写密钥名称（必填）
   - 可选：填写描述、设置过期天数
   - 点击「创建」

2. **创建后**
   - 密钥会显示在弹窗中（**仅显示一次**）
   - 请立即复制并保存
   - 关闭弹窗后无法再次查看完整密钥

### 使用 API 密钥

#### 方式一：Header 方式（推荐）

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local-gemini-auto",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

#### 方式二：X-API-Key Header

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local-gemini-auto",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

#### Python 示例

```python
import requests

API_KEY = "your-api-key-here"
BASE_URL = "http://localhost:8000/v1"

# 使用 API 密钥
response = requests.post(
    f"{BASE_URL}/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    },
    json={
        "model": "local-gemini-auto",
        "messages": [{"role": "user", "content": "Hello"}]
    }
)
```

#### OpenAI SDK 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key-here",
    base_url="http://localhost:8000/v1"
)

response = client.chat.completions.create(
    model="local-gemini-auto",
    messages=[{"role": "user", "content": "Hello"}]
)
```

---

## 🔧 管理功能

### 查看密钥列表

在「系统设置」→「API 密钥管理」中查看所有密钥：
- 密钥名称和描述
- 创建时间
- 过期时间
- 使用次数
- 最后使用时间
- 状态（活跃/已撤销/已过期）

### 查看统计信息

点击密钥的「统计」按钮，查看：
- 总调用次数
- 成功/失败次数
- 成功率
- 平均响应时间
- 按模型统计

### 查看调用日志

点击密钥的「日志」按钮，查看：
- 调用时间
- 使用的模型
- 响应状态
- 响应时间
- IP 地址
- 错误信息（如有）

### 撤销密钥

点击「撤销」按钮：
- 密钥将立即失效
- 无法再次使用
- 但密钥记录和日志会保留

### 删除密钥

点击「删除」按钮：
- 密钥将被永久删除
- **所有调用日志也会被删除**
- **此操作不可恢复**

---

## 🔐 安全特性

### 密钥存储

- **哈希存储**：密钥使用 SHA256 哈希存储，无法逆向
- **加密备份**：原始密钥使用 Fernet 加密存储（用于显示，可选）
- **安全验证**：使用哈希比较验证密钥，防止时序攻击

### 密钥格式

- **UUID 格式**：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **示例**：`a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### 过期管理

- 支持设置过期天数
- 过期后自动失效
- 可在创建时设置，或留空表示永不过期

---

## 📊 API 调用日志

### 自动记录

每次 API 调用都会自动记录：
- 调用时间
- 使用的模型
- 响应状态（success/error）
- 响应时间（毫秒）
- IP 地址
- 请求/响应大小
- 错误信息（如有）

### 日志查询

- 按密钥查询：查看特定密钥的所有调用
- 按状态筛选：查看成功或失败的调用
- 分页显示：支持分页浏览大量日志

---

## 🔄 迁移说明

### 从旧 Token 系统迁移

> **注意**：旧的 `api_tokens` 配置字段已被移除，系统现在完全使用 API 密钥管理系统。

### 迁移步骤

1. **创建新的 API 密钥**
2. **更新客户端使用新密钥**
3. **验证新密钥正常工作**
4. **删除旧的 Token**（可选）

---

## 🛠️ API 接口

### 管理接口（需要管理员权限）

#### 获取密钥列表
```http
GET /api/api-keys
```

#### 创建密钥
```http
POST /api/api-keys
Content-Type: application/json

{
  "name": "生产环境密钥",
  "description": "用于生产环境的 API 密钥",
  "expires_days": 90
}
```

#### 撤销密钥
```http
POST /api/api-keys/{key_id}/revoke
```

#### 删除密钥
```http
DELETE /api/api-keys/{key_id}
```

#### 获取统计信息
```http
GET /api/api-keys/{key_id}/stats?days=30
```

#### 获取调用日志
```http
GET /api/api-keys/{key_id}/logs?page=1&page_size=50&status=success
```

#### 获取所有日志
```http
GET /api/api-logs?page=1&page_size=50&key_id=1&status=success
```

---

## 📝 最佳实践

### 1. 密钥命名

- 使用有意义的名称：`生产环境-主密钥`、`测试环境-密钥1`
- 包含环境信息：`prod-`、`dev-`、`test-`
- 包含用途信息：`web-app`、`mobile-app`、`api-service`

### 2. 密钥管理

- **定期轮换**：建议每 90 天轮换一次密钥
- **最小权限**：为不同应用创建独立密钥
- **及时撤销**：不再使用的密钥立即撤销
- **安全存储**：密钥保存在安全的地方，不要提交到代码仓库

### 3. 监控和审计

- **定期查看统计**：了解 API 使用情况
- **检查异常日志**：关注错误率和异常 IP
- **设置过期时间**：为密钥设置合理的过期时间

### 4. 安全建议

- **使用 HTTPS**：生产环境必须使用 HTTPS
- **限制 IP**：通过防火墙限制 API 访问 IP（如需要）
- **监控异常**：关注异常调用模式和频率
- **及时更新**：定期更新依赖包，修复安全漏洞

---

## 🐛 故障排除

### 问题：密钥验证失败

**可能原因**：
1. 密钥已过期
2. 密钥已被撤销
3. 密钥格式错误

**解决方案**：
1. 检查密钥是否过期
2. 检查密钥状态是否为「活跃」
3. 确认密钥格式正确（UUID 格式）

### 问题：无法创建密钥

**可能原因**：
1. 数据库未初始化
2. 权限不足

**解决方案**：
1. 检查数据库文件是否存在
2. 确认已登录管理员账号
3. 查看控制台错误日志

### 问题：日志不显示

**可能原因**：
1. 数据库表未创建
2. 日志记录失败

**解决方案**：
1. 重启服务，确保数据库初始化
2. 检查控制台是否有错误信息
3. 确认数据库文件权限

---

## 📊 数据库结构

### APIKey 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer | 主键 |
| key_hash | String | 密钥哈希值（SHA256） |
| encrypted_key | Text | 加密后的密钥（可选） |
| name | String | 密钥名称 |
| description | Text | 描述信息 |
| created_at | DateTime | 创建时间 |
| expires_at | DateTime | 过期时间 |
| is_active | Boolean | 是否激活 |
| usage_count | Integer | 使用次数 |
| last_used_at | DateTime | 最后使用时间 |

### APICallLog 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer | 主键 |
| api_key_id | Integer | 关联的 API 密钥 ID |
| timestamp | DateTime | 调用时间 |
| model | String | 使用的模型 |
| status | String | 状态（success/error） |
| response_time | Integer | 响应时间（毫秒） |
| ip_address | String | 客户端 IP |
| endpoint | String | 调用的端点 |
| error_message | Text | 错误信息 |
| request_size | Integer | 请求大小（字节） |
| response_size | Integer | 响应大小（字节） |

---

## 🎯 总结

API 密钥管理系统提供了：
- ✅ 完整的密钥生命周期管理
- ✅ 详细的调用统计和日志
- ✅ 安全的存储和验证
- ✅ 友好的 Web 管理界面

**下一步**：
1. 创建第一个 API 密钥
2. 更新客户端使用新密钥
3. 查看统计和日志，了解使用情况
4. 根据需要创建更多密钥

---

*最后更新: 2025-11-29*

