const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// 配置
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DATA_DIR = process.env.DATA_DIR || './data';
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'tempmail.example.com';

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库
const db = new Database(path.join(DATA_DIR, 'mail.db'));

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS mailboxes (
    id TEXT PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    from_address TEXT,
    from_name TEXT,
    subject TEXT,
    text_content TEXT,
    html_content TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox_id);
  CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(received_at);
`);

// 生成 JWT Token
function generateToken(mailboxId, address) {
  return jwt.sign(
    { mailbox_id: mailboxId, address: address },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// 验证 JWT Token
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// 中间件：验证 Token
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.jwt;
  
  let token = queryToken;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  req.mailbox = decoded;
  next();
}

// API: 获取可用域名
app.get('/api/domains', (req, res) => {
  res.json({
    domains: [MAIL_DOMAIN],
    default: MAIL_DOMAIN
  });
});

// API: 创建邮箱
app.post('/api/mailboxes', (req, res) => {
  try {
    const { address, password } = req.body;
    
    // 生成随机地址（如果未提供）
    const mailAddress = address || `${uuidv4().substring(0, 8)}@${MAIL_DOMAIN}`;
    const mailPassword = password || uuidv4().substring(0, 16);
    const mailboxId = uuidv4();
    
    // 检查地址是否已存在
    const existing = db.prepare('SELECT id FROM mailboxes WHERE address = ?').get(mailAddress);
    if (existing) {
      return res.status(400).json({ error: 'Address already exists' });
    }
    
    // 创建邮箱
    db.prepare('INSERT INTO mailboxes (id, address, password) VALUES (?, ?, ?)')
      .run(mailboxId, mailAddress, mailPassword);
    
    const token = generateToken(mailboxId, mailAddress);
    
    res.json({
      id: mailboxId,
      address: mailAddress,
      token: token,
      // Business Gemini 需要的 URL 格式
      url: `${req.protocol}://${req.get('host')}/?jwt=${token}`
    });
  } catch (e) {
    console.error('Create mailbox error:', e);
    res.status(500).json({ error: 'Failed to create mailbox' });
  }
});

// API: 登录邮箱
app.post('/api/login', (req, res) => {
  try {
    const { address, password } = req.body;
    
    const mailbox = db.prepare('SELECT * FROM mailboxes WHERE address = ? AND password = ?')
      .get(address, password);
    
    if (!mailbox) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(mailbox.id, mailbox.address);
    
    res.json({
      id: mailbox.id,
      address: mailbox.address,
      token: token,
      url: `${req.protocol}://${req.get('host')}/?jwt=${token}`
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// API: 获取邮件列表
app.get('/api/emails', authMiddleware, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const emails = db.prepare(`
      SELECT * FROM emails 
      WHERE mailbox_id = ? 
      ORDER BY received_at DESC 
      LIMIT ? OFFSET ?
    `).all(req.mailbox.mailbox_id, limit, offset);
    
    res.json({
      emails: emails,
      total: db.prepare('SELECT COUNT(*) as count FROM emails WHERE mailbox_id = ?')
        .get(req.mailbox.mailbox_id).count
    });
  } catch (e) {
    console.error('Get emails error:', e);
    res.status(500).json({ error: 'Failed to get emails' });
  }
});

// API: 获取单封邮件
app.get('/api/emails/:id', authMiddleware, (req, res) => {
  try {
    const email = db.prepare(`
      SELECT * FROM emails 
      WHERE id = ? AND mailbox_id = ?
    `).get(req.params.id, req.mailbox.mailbox_id);
    
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    
    // 标记为已读
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(req.params.id);
    
    res.json(email);
  } catch (e) {
    console.error('Get email error:', e);
    res.status(500).json({ error: 'Failed to get email' });
  }
});

// API: 删除邮件
app.delete('/api/emails/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare(`
      DELETE FROM emails 
      WHERE id = ? AND mailbox_id = ?
    `).run(req.params.id, req.mailbox.mailbox_id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error('Delete email error:', e);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});


// API: 接收邮件（Webhook - 用于邮件转发服务调用）
app.post('/api/webhook/receive', (req, res) => {
  try {
    const { to, from, from_name, subject, text, html } = req.body;
    
    // 查找目标邮箱
    const mailbox = db.prepare('SELECT id FROM mailboxes WHERE address = ?').get(to);
    
    if (!mailbox) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }
    
    const emailId = uuidv4();
    
    db.prepare(`
      INSERT INTO emails (id, mailbox_id, from_address, from_name, subject, text_content, html_content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(emailId, mailbox.id, from, from_name || '', subject || '(No Subject)', text || '', html || '');
    
    res.json({ success: true, id: emailId });
  } catch (e) {
    console.error('Receive email error:', e);
    res.status(500).json({ error: 'Failed to receive email' });
  }
});

// API: 模拟发送邮件（用于测试）
app.post('/api/test/send', (req, res) => {
  try {
    const { to, from, subject, text, code } = req.body;
    
    const mailbox = db.prepare('SELECT id FROM mailboxes WHERE address = ?').get(to);
    
    if (!mailbox) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }
    
    const emailId = uuidv4();
    const emailText = code ? `Your verification code is: ${code}` : (text || 'Test email');
    
    db.prepare(`
      INSERT INTO emails (id, mailbox_id, from_address, from_name, subject, text_content, html_content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      emailId, 
      mailbox.id, 
      from || 'test@example.com', 
      'Test Sender',
      subject || 'Test Email',
      emailText,
      `<p>${emailText}</p>`
    );
    
    res.json({ success: true, id: emailId });
  } catch (e) {
    console.error('Test send error:', e);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

// 前端页面
app.get('/', (req, res) => {
  const token = req.query.jwt;
  
  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>临时邮箱</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    h1 { color: #333; margin-bottom: 20px; }
    h2 { color: #555; margin-bottom: 16px; font-size: 18px; }
    .mailbox-info {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .mailbox-address {
      font-size: 20px;
      font-weight: bold;
      color: #667eea;
      word-break: break-all;
    }
    .btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      margin-right: 10px;
      margin-bottom: 10px;
    }
    .btn:hover { background: #5a6fd6; }
    .btn-secondary { background: #6c757d; }
    .email-list { list-style: none; }
    .email-item {
      padding: 16px;
      border-bottom: 1px solid #eee;
      cursor: pointer;
      transition: background 0.2s;
    }
    .email-item:hover { background: #f9f9f9; }
    .email-item:last-child { border-bottom: none; }
    .email-from { font-weight: bold; color: #333; }
    .email-subject { color: #666; margin-top: 4px; }
    .email-time { color: #999; font-size: 12px; margin-top: 4px; }
    .email-content {
      background: #f9f9f9;
      padding: 16px;
      border-radius: 8px;
      margin-top: 16px;
      white-space: pre-wrap;
    }
    .empty { color: #999; text-align: center; padding: 40px; }
    .url-box {
      background: #e8f4e8;
      padding: 12px;
      border-radius: 8px;
      margin-top: 16px;
      word-break: break-all;
      font-size: 12px;
    }
    .url-label { font-weight: bold; color: #2e7d32; margin-bottom: 8px; }
    #createForm input {
      width: 100%;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>📧 临时邮箱</h1>
      
      <div id="createSection" class="${token ? 'hidden' : ''}">
        <p style="margin-bottom: 16px; color: #666;">创建一个临时邮箱来接收验证码</p>
        <button class="btn" onclick="createMailbox()">创建新邮箱</button>
      </div>
      
      <div id="mailboxSection" class="${token ? '' : 'hidden'}">
        <div class="mailbox-info">
          <div style="color: #666; margin-bottom: 8px;">当前邮箱地址：</div>
          <div class="mailbox-address" id="mailboxAddress">加载中...</div>
        </div>
        <button class="btn" onclick="refreshEmails()">刷新邮件</button>
        <button class="btn btn-secondary" onclick="copyUrl()">复制 URL</button>
        <button class="btn btn-secondary" onclick="createNew()">创建新邮箱</button>
        
        <div class="url-box">
          <div class="url-label">Business Gemini 临时邮箱 URL：</div>
          <div id="mailboxUrl"></div>
        </div>
      </div>
    </div>
    
    <div id="emailsCard" class="card ${token ? '' : 'hidden'}">
      <h2>📬 收件箱</h2>
      <ul class="email-list" id="emailList">
        <li class="empty">暂无邮件</li>
      </ul>
    </div>
    
    <div id="emailDetail" class="card hidden">
      <h2 id="emailSubject"></h2>
      <div style="color: #666; margin-bottom: 8px;">
        <span id="emailFrom"></span> · <span id="emailTime"></span>
      </div>
      <div class="email-content" id="emailContent"></div>
      <button class="btn btn-secondary" style="margin-top: 16px;" onclick="closeEmail()">返回列表</button>
    </div>
  </div>

  <script>
    let currentToken = '${token || ''}';
    let currentUrl = window.location.href;
    
    async function createMailbox() {
      try {
        const res = await fetch('/api/mailboxes', { method: 'POST' });
        const data = await res.json();
        
        if (data.token) {
          currentToken = data.token;
          currentUrl = data.url;
          window.history.pushState({}, '', '/?jwt=' + data.token);
          
          document.getElementById('createSection').classList.add('hidden');
          document.getElementById('mailboxSection').classList.remove('hidden');
          document.getElementById('emailsCard').classList.remove('hidden');
          document.getElementById('mailboxAddress').textContent = data.address;
          document.getElementById('mailboxUrl').textContent = data.url;
          
          refreshEmails();
        }
      } catch (e) {
        alert('创建失败: ' + e.message);
      }
    }
    
    async function refreshEmails() {
      if (!currentToken) return;
      
      try {
        const res = await fetch('/api/emails?jwt=' + currentToken);
        const data = await res.json();
        
        const list = document.getElementById('emailList');
        
        if (data.emails && data.emails.length > 0) {
          list.innerHTML = data.emails.map(email => \`
            <li class="email-item" onclick="viewEmail('\${email.id}')">
              <div class="email-from">\${email.from_name || email.from_address || '未知发件人'}</div>
              <div class="email-subject">\${email.subject || '(无主题)'}</div>
              <div class="email-time">\${new Date(email.received_at).toLocaleString()}</div>
            </li>
          \`).join('');
        } else {
          list.innerHTML = '<li class="empty">暂无邮件，点击刷新检查新邮件</li>';
        }
      } catch (e) {
        console.error('Refresh error:', e);
      }
    }
    
    async function viewEmail(id) {
      try {
        const res = await fetch('/api/emails/' + id + '?jwt=' + currentToken);
        const email = await res.json();
        
        document.getElementById('emailSubject').textContent = email.subject || '(无主题)';
        document.getElementById('emailFrom').textContent = email.from_name || email.from_address || '未知';
        document.getElementById('emailTime').textContent = new Date(email.received_at).toLocaleString();
        document.getElementById('emailContent').textContent = email.text_content || '(无内容)';
        
        document.getElementById('emailsCard').classList.add('hidden');
        document.getElementById('emailDetail').classList.remove('hidden');
      } catch (e) {
        alert('加载失败');
      }
    }
    
    function closeEmail() {
      document.getElementById('emailDetail').classList.add('hidden');
      document.getElementById('emailsCard').classList.remove('hidden');
    }
    
    function copyUrl() {
      navigator.clipboard.writeText(currentUrl).then(() => {
        alert('URL 已复制！可以粘贴到 Business Gemini 的临时邮箱 URL 字段');
      });
    }
    
    function createNew() {
      if (confirm('确定要创建新邮箱吗？当前邮箱将无法恢复。')) {
        currentToken = '';
        window.history.pushState({}, '', '/');
        document.getElementById('createSection').classList.remove('hidden');
        document.getElementById('mailboxSection').classList.add('hidden');
        document.getElementById('emailsCard').classList.add('hidden');
      }
    }
    
    // 初始化
    if (currentToken) {
      // 验证 token 并获取邮箱信息
      fetch('/api/emails?jwt=' + currentToken + '&limit=1')
        .then(res => {
          if (res.ok) {
            // Token 有效，解析获取地址
            const payload = JSON.parse(atob(currentToken.split('.')[1]));
            document.getElementById('mailboxAddress').textContent = payload.address;
            document.getElementById('mailboxUrl').textContent = currentUrl;
            refreshEmails();
          } else {
            // Token 无效
            currentToken = '';
            window.history.pushState({}, '', '/');
            document.getElementById('createSection').classList.remove('hidden');
            document.getElementById('mailboxSection').classList.add('hidden');
            document.getElementById('emailsCard').classList.add('hidden');
          }
        });
      
      // 自动刷新
      setInterval(refreshEmails, 10000);
    }
  </script>
</body>
</html>
  `);
});

// 启动服务
app.listen(PORT, () => {
  console.log(`临时邮箱服务已启动: http://localhost:${PORT}`);
  console.log(`邮件域名: ${MAIL_DOMAIN}`);
});
