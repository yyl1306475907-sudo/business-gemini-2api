# 临时邮箱 API 集成指南

## 📋 概述

系统支持两种独立的登录流程来获取验证码：

1. **API 方式**：如果临时邮箱服务支持 API（如 [cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email)），优先使用 API 方式
2. **浏览器方式**：使用 Playwright 浏览器自动化访问临时邮箱页面

系统会自动在两种方式之间切换：默认先尝试 API 方式，如果失败则自动切换到浏览器方式。

### ✅ 使用 API 的优势

1. **更快的响应速度**：无需加载整个页面，直接获取 JSON 数据
2. **更稳定可靠**：不依赖页面 DOM 结构变化，减少选择器失效问题
3. **更低的资源消耗**：无需启动浏览器，节省内存和 CPU
4. **更简洁的代码**：直接解析 JSON，无需复杂的页面元素查找
5. **更好的错误处理**：API 返回明确的错误信息

### 🔄 自动切换机制

系统实现了智能的自动切换机制：

- **默认行为**：优先尝试 API 方式获取验证码
- **自动降级**：如果 API 方式失败，自动切换到浏览器方式
- **无缝切换**：切换过程对用户透明，无需手动配置
- **独立流程**：两种方式是完全独立的登录流程，互不干扰

---

## 🔍 当前实现方式分析

### 浏览器自动化方式（当前）

```python
def get_verification_code_from_tempmail(page, timeout=120, tempmail_url: Optional[str] = None, retry_mode: bool = False):
    """从临时邮箱服务获取验证码（使用浏览器自动化）"""
    # 1. 导航到临时邮箱页面
    page.goto(tempmail_url, wait_until="networkidle", timeout=60000)
    
    # 2. 切换到收件箱标签
    mailbox_tab.click()
    
    # 3. 点击刷新按钮
    refresh_btn.click()
    
    # 4. 查找邮件列表元素
    mail_items = page.locator("li.n-list-item").all()
    
    # 5. 点击邮件打开详情
    mail_item.click()
    
    # 6. 从页面文本中提取验证码
    page_text = page.locator("body").text_content()
    code = extract_verification_code(page_text)
```

**问题**：
- 依赖页面 DOM 结构（选择器可能失效）
- 需要等待页面加载和渲染
- 需要处理各种页面状态（加载中、错误等）
- 资源消耗较大

---

## 🚀 API 方式实现

### 1. 从 tempmail_url 提取 JWT Token

临时邮箱 URL 通常包含 JWT token，格式如：
```
https://tempmail.example.com/?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

提取 JWT 的函数：

```python
import json
import base64
from urllib.parse import urlparse, parse_qs
from typing import Optional, Tuple

def extract_jwt_from_url(tempmail_url: str) -> Optional[str]:
    """从临时邮箱 URL 中提取 JWT token"""
    try:
        parsed = urlparse(tempmail_url)
        params = parse_qs(parsed.query)
        if 'jwt' in params:
            return params['jwt'][0]
    except Exception as e:
        print(f"[临时邮箱 API] 提取 JWT 失败: {e}")
    return None

def extract_email_from_jwt(jwt_token: str) -> Optional[str]:
    """从 JWT token 中提取邮箱地址"""
    try:
        # JWT 格式：header.payload.signature
        parts = jwt_token.split('.')
        if len(parts) < 2:
            return None
        
        # 解码 payload（第二个部分）
        payload = parts[1]
        # Base64 URL 解码需要补全 padding
        padding = '=' * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded)
        
        # 从 payload 中提取邮箱地址
        if 'address' in data:
            return data['address']
    except Exception as e:
        print(f"[临时邮箱 API] 从 JWT 提取邮箱失败: {e}")
    return None
```

### 2. 使用 API 获取邮件列表

根据 [cloudflare_temp_email 文档](https://temp-mail-docs.awsl.uk/zh/guide/feature/mail-api.html)，API 调用方式：

```python
import requests
from typing import List, Dict, Optional

def get_mails_from_api(
    worker_url: str,
    jwt_token: str,
    limit: int = 20,
    offset: int = 0,
    keyword: Optional[str] = None
) -> List[Dict]:
    """通过 API 获取邮件列表
    
    Args:
        worker_url: Worker 地址（从 tempmail_url 中提取，不包含路径和参数）
        jwt_token: JWT 认证 token
        limit: 返回邮件数量限制
        offset: 偏移量（分页）
        keyword: 关键词过滤（可选）
    
    Returns:
        邮件列表，格式：[{"id": 1, "from": "...", "subject": "...", "text": "...", ...}, ...]
    """
    try:
        url = f"{worker_url}/api/mails"
        params = {
            "limit": limit,
            "offset": offset
        }
        if keyword:
            params["keyword"] = keyword
        
        headers = {
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        # 根据实际 API 响应格式调整
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and "mails" in data:
            return data["mails"]
        elif isinstance(data, dict) and "data" in data:
            return data["data"]
        else:
            print(f"[临时邮箱 API] 未知的响应格式: {data}")
            return []
            
    except requests.RequestException as e:
        print(f"[临时邮箱 API] 获取邮件列表失败: {e}")
        return []
    except Exception as e:
        print(f"[临时邮箱 API] 解析邮件列表失败: {e}")
        return []
```

### 3. 从邮件内容中提取验证码

```python
def extract_verification_code_from_mail(mail_text: str) -> Optional[str]:
    """从邮件文本内容中提取验证码（复用现有函数）"""
    # 使用现有的 extract_verification_code 函数
    from auto_login_with_email import extract_verification_code
    return extract_verification_code(mail_text)
```

### 4. 完整的 API 方式获取验证码函数

```python
import time
from typing import Optional

def get_verification_code_from_api(
    tempmail_url: str,
    timeout: int = 120,
    retry_mode: bool = False
) -> Optional[str]:
    """通过 API 从临时邮箱服务获取验证码
    
    Args:
        tempmail_url: 临时邮箱 URL（包含 JWT token）
        timeout: 超时时间（秒）
        retry_mode: 是否为重试模式（True：立即获取，不等待；False：等待邮件到达）
    
    Returns:
        验证码字符串，如果未找到则返回 None
    """
    # 1. 提取 JWT token 和 Worker URL
    jwt_token = extract_jwt_from_url(tempmail_url)
    if not jwt_token:
        print("[临时邮箱 API] ✗ 无法从 URL 中提取 JWT token")
        return None
    
    # 提取 Worker 基础 URL（去除路径和参数）
    parsed = urlparse(tempmail_url)
    worker_url = f"{parsed.scheme}://{parsed.netloc}"
    
    print(f"[临时邮箱 API] 使用 API 方式获取验证码...")
    
    # 2. 等待邮件到达（如果不是重试模式）
    if not retry_mode:
        print(f"[临时邮箱 API] 等待验证码邮件（最多 {timeout} 秒）...")
        # 第一次获取时，等待一段时间确保邮件已发送
        time.sleep(10)
    
    # 3. 轮询获取邮件
    start_time = time.time()
    attempts = 0
    max_attempts = timeout // 5  # 每 5 秒检查一次
    last_max_id = 0  # 记录已处理的最大邮件 ID
    
    keywords = ['gemini', 'google', 'verify', 'verification', 'code', '验证', '验证码']
    
    while attempts < max_attempts:
        attempts += 1
        elapsed = int(time.time() - start_time)
        
        if elapsed >= timeout:
            print(f"[临时邮箱 API] ✗ 超时（{timeout} 秒）未获取到验证码")
            break
        
        # 获取邮件列表（使用关键词过滤）
        mails = []
        for keyword in keywords:
            mails = get_mails_from_api(worker_url, jwt_token, limit=20, keyword=keyword)
            if mails:
                break
        
        if not mails:
            # 如果没有找到匹配的邮件，等待后重试
            if not retry_mode:
                time.sleep(5)
            continue
        
        # 4. 查找最新的验证码邮件
        # 按 ID 排序，获取最新的邮件
        mails.sort(key=lambda x: x.get("id", 0), reverse=True)
        
        for mail in mails:
            mail_id = mail.get("id", 0)
            
            # 跳过已处理的邮件
            if mail_id <= last_max_id:
                continue
            
            # 获取邮件内容
            mail_text = mail.get("text", "") or mail.get("html", "") or mail.get("content", "")
            if not mail_text:
                continue
            
            # 5. 提取验证码
            code = extract_verification_code_from_mail(mail_text)
            
            if code:
                print(f"[临时邮箱 API] ✓ 从邮件 ID {mail_id} 中提取到验证码: {code}")
                last_max_id = mail_id
                return code
            else:
                # 记录已处理但未找到验证码的邮件 ID
                last_max_id = mail_id
        
        # 等待后重试
        if not retry_mode:
            time.sleep(5)
        else:
            # 重试模式只尝试一次
            break
    
    print(f"[临时邮箱 API] ✗ 未找到验证码（尝试 {attempts} 次）")
    return None
```

---

## 🔧 集成到现有代码

### 方案 1：自动检测并选择方式

修改 `auto_login_with_email.py`，添加自动检测功能：

```python
def get_verification_code_from_tempmail(
    page,  # 保留 page 参数以兼容现有调用
    timeout=120,
    tempmail_url: Optional[str] = None,
    retry_mode: bool = False
) -> Optional[str]:
    """从临时邮箱服务获取验证码（自动选择 API 或浏览器方式）"""
    
    # 检查是否可以使用 API 方式
    if tempmail_url and 'jwt=' in tempmail_url:
        try:
            # 尝试使用 API 方式
            code = get_verification_code_from_api(tempmail_url, timeout, retry_mode)
            if code:
                return code
            else:
                print("[临时邮箱] API 方式未获取到验证码，回退到浏览器方式...")
        except Exception as e:
            print(f"[临时邮箱] API 方式失败: {e}，回退到浏览器方式...")
    
    # 回退到浏览器方式（原有实现）
    return get_verification_code_from_tempmail_browser(page, timeout, tempmail_url, retry_mode)
```

### 方案 2：配置项控制

在配置中添加选项：

```python
# 在 auto_login_with_email.py 顶部添加配置
USE_TEMPMAIL_API = True  # 是否优先使用 API 方式

def get_verification_code_from_tempmail(...):
    if USE_TEMPMAIL_API and tempmail_url and 'jwt=' in tempmail_url:
        # 使用 API 方式
        return get_verification_code_from_api(...)
    else:
        # 使用浏览器方式
        return get_verification_code_from_tempmail_browser(...)
```

---

## 📝 完整实现示例

创建一个新文件 `tempmail_api.py`：

```python
"""
临时邮箱 API 客户端
支持 cloudflare_temp_email 项目的 API
"""

import json
import time
import base64
import requests
from typing import Optional, List, Dict
from urllib.parse import urlparse, parse_qs
from auto_login_with_email import extract_verification_code


class TempMailAPIClient:
    """临时邮箱 API 客户端"""
    
    def __init__(self, tempmail_url: str):
        """初始化客户端
        
        Args:
            tempmail_url: 临时邮箱 URL（包含 JWT token）
        """
        self.tempmail_url = tempmail_url
        self.jwt_token = self._extract_jwt()
        self.worker_url = self._extract_worker_url()
        
        if not self.jwt_token:
            raise ValueError("无法从 URL 中提取 JWT token")
    
    def _extract_jwt(self) -> Optional[str]:
        """从 URL 中提取 JWT token"""
        try:
            parsed = urlparse(self.tempmail_url)
            params = parse_qs(parsed.query)
            if 'jwt' in params:
                return params['jwt'][0]
        except Exception:
            pass
        return None
    
    def _extract_worker_url(self) -> str:
        """提取 Worker 基础 URL"""
        parsed = urlparse(self.tempmail_url)
        return f"{parsed.scheme}://{parsed.netloc}"
    
    def get_email_address(self) -> Optional[str]:
        """从 JWT token 中提取邮箱地址"""
        if not self.jwt_token:
            return None
        
        try:
            parts = self.jwt_token.split('.')
            if len(parts) < 2:
                return None
            
            payload = parts[1]
            padding = '=' * (4 - len(payload) % 4)
            decoded = base64.urlsafe_b64decode(payload + padding)
            data = json.loads(decoded)
            
            if 'address' in data:
                return data['address']
        except Exception as e:
            print(f"[临时邮箱 API] 从 JWT 提取邮箱失败: {e}")
        
        return None
    
    def get_mails(
        self,
        limit: int = 20,
        offset: int = 0,
        keyword: Optional[str] = None
    ) -> List[Dict]:
        """获取邮件列表
        
        Args:
            limit: 返回邮件数量限制
            offset: 偏移量（分页）
            keyword: 关键词过滤（可选）
        
        Returns:
            邮件列表
        """
        try:
            url = f"{self.worker_url}/api/mails"
            params = {
                "limit": limit,
                "offset": offset
            }
            if keyword:
                params["keyword"] = keyword
            
            headers = {
                "Authorization": f"Bearer {self.jwt_token}",
                "Content-Type": "application/json"
            }
            
            response = requests.get(url, headers=headers, params=params, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # 处理不同的响应格式
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                if "mails" in data:
                    return data["mails"]
                elif "data" in data:
                    return data["data"]
                elif "result" in data:
                    return data["result"]
            
            return []
            
        except requests.RequestException as e:
            print(f"[临时邮箱 API] 获取邮件列表失败: {e}")
            return []
        except Exception as e:
            print(f"[临时邮箱 API] 解析邮件列表失败: {e}")
            return []
    
    def get_verification_code(
        self,
        timeout: int = 120,
        retry_mode: bool = False
    ) -> Optional[str]:
        """获取验证码
        
        Args:
            timeout: 超时时间（秒）
            retry_mode: 是否为重试模式
        
        Returns:
            验证码字符串，如果未找到则返回 None
        """
        print(f"[临时邮箱 API] 使用 API 方式获取验证码...")
        
        if not retry_mode:
            print(f"[临时邮箱 API] 等待验证码邮件（最多 {timeout} 秒）...")
            time.sleep(10)  # 等待邮件发送
        
        start_time = time.time()
        attempts = 0
        max_attempts = timeout // 5
        last_max_id = 0
        
        keywords = ['gemini', 'google', 'verify', 'verification', 'code', '验证', '验证码']
        
        while attempts < max_attempts:
            attempts += 1
            elapsed = int(time.time() - start_time)
            
            if elapsed >= timeout:
                print(f"[临时邮箱 API] ✗ 超时（{timeout} 秒）未获取到验证码")
                break
            
            # 尝试不同的关键词
            mails = []
            for keyword in keywords:
                mails = self.get_mails(limit=20, keyword=keyword)
                if mails:
                    break
            
            if not mails:
                if not retry_mode:
                    time.sleep(5)
                continue
            
            # 按 ID 排序，获取最新邮件
            mails.sort(key=lambda x: x.get("id", 0), reverse=True)
            
            for mail in mails:
                mail_id = mail.get("id", 0)
                
                if mail_id <= last_max_id:
                    continue
                
                # 获取邮件文本内容
                mail_text = (
                    mail.get("text", "") or
                    mail.get("html", "") or
                    mail.get("content", "") or
                    mail.get("body", "")
                )
                
                if not mail_text:
                    continue
                
                # 提取验证码
                code = extract_verification_code(mail_text)
                
                if code:
                    print(f"[临时邮箱 API] ✓ 从邮件 ID {mail_id} 中提取到验证码: {code}")
                    last_max_id = mail_id
                    return code
                else:
                    last_max_id = mail_id
            
            if not retry_mode:
                time.sleep(5)
            else:
                break
        
        print(f"[临时邮箱 API] ✗ 未找到验证码（尝试 {attempts} 次）")
        return None


# 便捷函数
def get_verification_code_from_api(
    tempmail_url: str,
    timeout: int = 120,
    retry_mode: bool = False
) -> Optional[str]:
    """通过 API 获取验证码（便捷函数）"""
    try:
        client = TempMailAPIClient(tempmail_url)
        return client.get_verification_code(timeout, retry_mode)
    except Exception as e:
        print(f"[临时邮箱 API] 初始化客户端失败: {e}")
        return None
```

---

## 🔄 修改现有代码

在 `auto_login_with_email.py` 中集成 API 方式：

```python
# 在文件顶部添加导入
try:
    from tempmail_api import get_verification_code_from_api
    TEMPMAIL_API_AVAILABLE = True
except ImportError:
    TEMPMAIL_API_AVAILABLE = False
    print("[临时邮箱] API 模块未找到，将使用浏览器方式")

# 修改 get_verification_code_from_tempmail 函数
def get_verification_code_from_tempmail(
    page,
    timeout=120,
    tempmail_url: Optional[str] = None,
    retry_mode: bool = False
) -> Optional[str]:
    """从临时邮箱服务获取验证码（自动选择最佳方式）"""
    
    # 优先尝试 API 方式
    if (TEMPMAIL_API_AVAILABLE and 
        tempmail_url and 
        'jwt=' in tempmail_url):
        try:
            code = get_verification_code_from_api(tempmail_url, timeout, retry_mode)
            if code:
                return code
            print("[临时邮箱] API 方式未获取到验证码，回退到浏览器方式...")
        except Exception as e:
            print(f"[临时邮箱] API 方式失败: {e}，回退到浏览器方式...")
    
    # 回退到浏览器方式（原有实现）
    return get_verification_code_from_tempmail_browser(page, timeout, tempmail_url, retry_mode)
```

---

## ✅ 测试步骤

1. **测试 JWT 提取**：
   ```python
   url = "https://tempmail.example.com/?jwt=eyJhbGci..."
   client = TempMailAPIClient(url)
   email = client.get_email_address()
   print(f"邮箱地址: {email}")
   ```

2. **测试邮件列表获取**：
   ```python
   mails = client.get_mails(limit=10, keyword="gemini")
   print(f"找到 {len(mails)} 封邮件")
   ```

3. **测试验证码提取**：
   ```python
   code = client.get_verification_code(timeout=60)
   print(f"验证码: {code}")
   ```

---

## 📚 参考文档

- [cloudflare_temp_email GitHub](https://github.com/dreamhunter2333/cloudflare_temp_email)
- [临时邮箱 API 文档](https://temp-mail-docs.awsl.uk/zh/guide/feature/mail-api.html)

---

## 🎯 总结

使用 API 方式替代浏览器访问邮件页面可以：

1. ✅ **提高效率**：直接获取 JSON 数据，无需渲染页面
2. ✅ **增强稳定性**：不依赖 DOM 结构，减少选择器失效问题
3. ✅ **降低资源消耗**：无需启动浏览器
4. ✅ **简化代码**：直接解析 JSON，逻辑更清晰

建议优先使用 API 方式，浏览器方式作为备用方案。

