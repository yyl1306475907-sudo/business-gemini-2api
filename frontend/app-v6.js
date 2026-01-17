const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

// CORS 支持 - 解决 iframe 嵌入问题
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ===============================
// 数据持久化目录
// ===============================
const dataDir = process.env.DATA_DIR || '/tmp/data';
const accountsFile = path.join(dataDir, 'accounts.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ===============================
// 配置
// ===============================
const config = {
  port: parseInt(process.env.PORT) || 7860,
  mail: {
    // zeabur-mail 临时邮箱服务地址
    tempMailUrl: process.env.TEMP_MAIL_URL || 'https://your-tempmail-service.com'
  },
  yesCaptcha: {
    apiKey: process.env.YESCAPTCHA_API_KEY || ''
  },
  recaptcha: {
    websiteKey: process.env.RECAPTCHA_WEBSITE_KEY || 'YOUR_RECAPTCHA_WEBSITE_KEY',
    websiteURL: process.env.RECAPTCHA_WEBSITE_URL || 'https://accountverification.business.gemini.google'
  },
  browser: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    timeout: parseInt(process.env.BROWSER_TIMEOUT) || 60000
  },
  polling: {
    interval: parseInt(process.env.MAIL_POLL_INTERVAL) || 3000,
    maxAttempts: parseInt(process.env.MAIL_POLL_MAX_ATTEMPTS) || 25
  },
  businessGemini: {
    url: process.env.BUSINESS_GEMINI_URL || '',
    adminPassword: process.env.BUSINESS_GEMINI_PASSWORD || '',
    accountId: parseInt(process.env.BUSINESS_GEMINI_ACCOUNT_ID) || 0
  },
  schedule: {
    // 定时注册：间隔小时数，0 表示禁用，支持小数（如 0.1 = 6分钟）
    registerIntervalHours: parseFloat(process.env.SCHEDULE_REGISTER_HOURS) || 0,
    // 每次定时注册的账号数量
    registerCount: parseInt(process.env.SCHEDULE_REGISTER_COUNT) || 1,
    // 定时刷新：间隔小时数，0 表示禁用，支持小数
    refreshIntervalHours: parseFloat(process.env.SCHEDULE_REFRESH_HOURS) || 0
  },
  // 账号操作间隔时间（秒）
  interval: {
    register: parseInt(process.env.REGISTER_INTERVAL_SECONDS) || 60,  // 注册间隔，默认60秒
    refresh: parseInt(process.env.REFRESH_INTERVAL_SECONDS) || 30     // 刷新间隔，默认30秒
  }
};

// ===============================
// 运行时配置（可通过前端修改）
// ===============================
const runtimeConfigFile = path.join(dataDir, 'runtime_config.json');
let runtimeConfig = {
  registerIntervalSeconds: config.interval.register,
  refreshIntervalSeconds: config.interval.refresh,
  scheduleRegisterHours: config.schedule.registerIntervalHours,
  scheduleRegisterCount: config.schedule.registerCount,
  scheduleRefreshHours: config.schedule.refreshIntervalHours,
  // 服务配置
  tempMailUrl: config.mail.tempMailUrl,
  businessGeminiUrl: config.businessGemini.url,
  businessGeminiPassword: config.businessGemini.adminPassword,
  yesCaptchaApiKey: config.yesCaptcha.apiKey
};

function loadRuntimeConfig() {
  try {
    if (fs.existsSync(runtimeConfigFile)) {
      const saved = JSON.parse(fs.readFileSync(runtimeConfigFile, 'utf8'));
      runtimeConfig = { ...runtimeConfig, ...saved };
      // 同步到config对象
      config.interval.register = runtimeConfig.registerIntervalSeconds;
      config.interval.refresh = runtimeConfig.refreshIntervalSeconds;
      config.schedule.registerIntervalHours = runtimeConfig.scheduleRegisterHours;
      config.schedule.registerCount = runtimeConfig.scheduleRegisterCount;
      config.schedule.refreshIntervalHours = runtimeConfig.scheduleRefreshHours;
      // 服务配置
      if (runtimeConfig.tempMailUrl) config.mail.tempMailUrl = runtimeConfig.tempMailUrl;
      if (runtimeConfig.businessGeminiUrl) config.businessGemini.url = runtimeConfig.businessGeminiUrl;
      if (runtimeConfig.businessGeminiPassword) config.businessGemini.adminPassword = runtimeConfig.businessGeminiPassword;
      if (runtimeConfig.yesCaptchaApiKey) config.yesCaptcha.apiKey = runtimeConfig.yesCaptchaApiKey;
    }
  } catch (e) {
    console.error('加载运行时配置失败:', e.message);
  }
}

function saveRuntimeConfig() {
  try {
    fs.writeFileSync(runtimeConfigFile, JSON.stringify(runtimeConfig, null, 2));
  } catch (e) {
    console.error('保存运行时配置失败:', e.message);
  }
}

// ===============================
// 账号存储和日志
// ===============================
let runtimeAccounts = [];
let logs = [];
const MAX_LOGS = 1000; // 增加最大日志数量，主要依靠时间清理
const LOG_RETENTION_HOURS = 24; // 日志保留24小时

let registerStatus = { running: false, total: 0, completed: 0, results: [] };
let businessGeminiAccounts = [];
let lastSyncTime = null;
let refreshStatus = { running: false, lastResult: null };
let lastRefreshTime = null;
let lastScheduledRegisterTime = null;
let lastScheduledRefreshTime = null;
let scheduleTimers = { register: null, refresh: null };

function loadAccounts() {
  try {
    if (fs.existsSync(accountsFile)) {
      runtimeAccounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      console.log(`📂 加载了 ${runtimeAccounts.length} 个账号`);
    }
  } catch (e) {
    console.error('加载账号失败:', e.message);
  }
}

function saveAccounts() {
  try {
    fs.writeFileSync(accountsFile, JSON.stringify(runtimeAccounts, null, 2));
  } catch (e) {
    console.error('保存账号失败:', e.message);
  }
}

function addLog(level, message, email = null) {
  const log = { time: new Date().toISOString(), level, message, email };
  logs.unshift(log);
  
  // 清理超过24小时的日志
  cleanupOldLogs();
  
  console.log(`[${level}] ${email ? `[${email}] ` : ''}${message}`);
}

// 清理超过保留时间的日志
function cleanupOldLogs() {
  const cutoffTime = new Date(Date.now() - LOG_RETENTION_HOURS * 60 * 60 * 1000);
  const originalLength = logs.length;
  logs = logs.filter(log => new Date(log.time) > cutoffTime);
  
  // 作为备用，如果日志数量仍然过多，保留最新的
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(0, MAX_LOGS);
  }
  
  // 如果清理了日志，记录清理信息
  if (originalLength > logs.length) {
    console.log(`[SYSTEM] 清理了 ${originalLength - logs.length} 条超过${LOG_RETENTION_HOURS}小时的旧日志，当前保留 ${logs.length} 条`);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function createTempUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pptr-profile-'));
}


// ===============================
// zeabur-mail 临时邮箱 API 集成
// ===============================
async function createTempMailbox() {
  if (!config.mail.tempMailUrl) {
    throw new Error('未配置临时邮箱服务地址 (TEMP_MAIL_URL)');
  }

  try {
    addLog('INFO', `创建临时邮箱: ${config.mail.tempMailUrl}`);
    const response = await axios.post(`${config.mail.tempMailUrl}/api/mailboxes`, {}, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const { address, token, url } = response.data;
    addLog('SUCCESS', `邮箱创建成功: ${address}`);
    
    return {
      email: address,
      jwtUrl: url || `${config.mail.tempMailUrl}/?jwt=${token}`,
      token
    };
  } catch (error) {
    addLog('ERROR', `创建邮箱失败: ${error.message}`);
    throw error;
  }
}

// ===============================
// 邮件获取类 - 适配 zeabur-mail API
// ===============================
class ZeaburMailFetcher {
  constructor(email, mailConfig = null) {
    this.email = email;
    this.jwtUrl = mailConfig?.jwtUrl || '';
  }

  async tryFetchOnce() {
    try {
      if (!this.jwtUrl) {
        addLog('WARN', '未配置邮件 JWT URL', this.email);
        return null;
      }

      const urlObj = new URL(this.jwtUrl);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const jwt = urlObj.searchParams.get('jwt');
      
      if (!jwt) {
        addLog('WARN', 'JWT URL 中未找到 jwt 参数', this.email);
        return null;
      }

      const response = await axios.get(`${baseUrl}/api/emails`, {
        params: { jwt },
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });

      const mails = response.data.emails || [];
      addLog('INFO', `获取到 ${mails.length} 封邮件`, this.email);

      for (const mail of mails) {
        const subject = mail.subject || '';
        addLog('INFO', `检查邮件: subject="${subject.substring(0, 50)}"`, this.email);
        
        // zeabur-mail 使用 text_content 和 html_content 字段
        const contentParts = [];
        if (mail.text_content) contentParts.push(mail.text_content);
        if (mail.html_content) contentParts.push(mail.html_content);
        if (contentParts.length === 0) contentParts.push(JSON.stringify(mail));
        
        const content = contentParts.join(' ');
        
        // 匹配6位验证码
        const codeMatch = content.match(/\b([A-Z0-9]{6})\b/g);
        
        if (codeMatch) {
          addLog('INFO', `找到可能的验证码: ${codeMatch.join(', ')}`, this.email);
          
          const excluded = ['GOOGLE', 'GEMINI', 'VERIFY', 'ACCESS', 'BUSINE', 'SIGNIN'];
          
          // 优先找字母+数字组合
          for (const code of codeMatch) {
            const hasLetter = /[A-Z]/.test(code);
            const hasNumber = /[0-9]/.test(code);
            if (!excluded.includes(code) && hasLetter && hasNumber) {
              addLog('SUCCESS', `验证码: ${code}`, this.email);
              return code;
            }
          }
          
          // 其次找任意非排除的6位码
          for (const code of codeMatch) {
            if (!excluded.includes(code)) {
              addLog('SUCCESS', `验证码: ${code}`, this.email);
              return code;
            }
          }
        }
      }
      
      addLog('WARN', '未找到验证码', this.email);
      return null;
    } catch (error) {
      addLog('ERROR', `获取邮件失败: ${error.message}`, this.email);
      return null;
    }
  }
}

async function startPollingForCode(email, mailConfig = null) {
  const fetcher = new ZeaburMailFetcher(email, mailConfig);
  for (let i = 1; i <= config.polling.maxAttempts; i++) {
    addLog('INFO', `尝试获取验证码 (${i}/${config.polling.maxAttempts})`, email);
    const code = await fetcher.tryFetchOnce();
    if (code) return code;
    await sleep(config.polling.interval);
  }
  return null;
}


// ===============================
// YesCaptcha 验证码处理
// ===============================
async function getCaptchaToken(apiKey) {
  if (!apiKey) return null;
  
  try {
    addLog('INFO', '请求 YesCaptcha Token...');
    const createResp = await axios.post('https://api.yescaptcha.com/createTask', {
      clientKey: apiKey,
      task: {
        websiteURL: config.recaptcha.websiteURL,
        websiteKey: config.recaptcha.websiteKey,
        pageAction: 'verify_oob_code',
        type: 'RecaptchaV3TaskProxylessM1'
      }
    });
    
    addLog('INFO', `YesCaptcha 响应: ${JSON.stringify(createResp.data)}`);
    
    const taskId = createResp.data.taskId;
    if (!taskId) {
      addLog('ERROR', `YesCaptcha 未返回 taskId, 错误: ${createResp.data.errorDescription || createResp.data.errorCode || '未知'}`);
      return null;
    }
    
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const resultResp = await axios.post('https://api.yescaptcha.com/getTaskResult', {
        clientKey: apiKey,
        taskId
      });
      if (resultResp.data.status === 'ready') {
        addLog('SUCCESS', 'YesCaptcha Token 获取成功');
        return resultResp.data.solution.gRecaptchaResponse;
      }
    }
    addLog('ERROR', 'YesCaptcha Token 获取超时');
    return null;
  } catch (error) { 
    addLog('ERROR', `YesCaptcha 错误: ${error.message}`);
    return null; 
  }
}

function patchPayload(rawBody, newToken) {
  if (!rawBody) return rawBody;
  const params = new URLSearchParams(rawBody);
  let fReq = params.get('f.req');
  if (!fReq) return rawBody;
  const tokenRegex = /0[3c]AFc[a-zA-Z0-9_\-]{50,}/g;
  if (tokenRegex.test(fReq)) {
    fReq = fReq.replace(tokenRegex, newToken);
    params.set('f.req', fReq);
  }
  return params.toString();
}

// ===============================
// 推送到 Business Gemini - 适配 cookie-refresher 格式
// ===============================
async function pushToBusinessGemini(cookieData, geminiConfig = null, email = null, mailConfig = null) {
  const targetConfig = geminiConfig || config.businessGemini;
  
  if (!targetConfig.url || !targetConfig.adminPassword) {
    addLog('WARN', 'Business Gemini 未配置，跳过推送', email);
    return { success: false, error: 'Business Gemini 未配置' };
  }

  try {
    addLog('INFO', `推送到 Business Gemini: ${targetConfig.url}`, email);
    
    // 1. 登录获取 session
    const loginResp = await axios.post(`${targetConfig.url}/api/auth/login`, {
      password: targetConfig.adminPassword
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const setCookie = loginResp.headers['set-cookie'];
    const sessionCookie = setCookie ? setCookie[0].split(';')[0] : '';
    const accountId = targetConfig.accountId || 0;
    
    // 2. 构建推送数据 - 适配 business-gemini 格式
    // business-gemini 需要: secure_c_ses, host_c_oses, csesidx, team_id
    const pushData = {
      secure_c_ses: cookieData.secure_c_ses || '',
      host_c_oses: cookieData.host_c_oses || '',
      csesidx: cookieData.csesidx || '',
      team_id: cookieData.team_id || '',
      tempmail_name: email || '',
      tempmail_url: mailConfig?.jwtUrl || '' // 添加临时邮箱URL
    };
    
    // 添加调试日志
    addLog('INFO', `推送数据: tempmail_name="${pushData.tempmail_name}", tempmail_url="${pushData.tempmail_url}"`, email);
    
    // 3. 尝试更新账号
    try {
      await axios.put(`${targetConfig.url}/api/accounts/${accountId}`, pushData, {
        headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
        timeout: 30000
      });
      addLog('SUCCESS', `推送成功！账号ID: ${accountId}`, email);
      return { success: true, accountId, action: 'update' };
    } catch (e) {
      if (e.response && e.response.status === 404) {
        // 账号不存在，添加新账号
        addLog('INFO', '账号不存在，添加新账号...', email);
        await axios.post(`${targetConfig.url}/api/accounts`, {
          ...pushData,
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }, {
          headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
          timeout: 30000
        });
        addLog('SUCCESS', `新账号添加成功！`, email);
        return { success: true, accountId, action: 'create' };
      }
      throw e;
    }

  } catch (error) {
    addLog('ERROR', `推送失败: ${error.message}`, email);
    return { success: false, error: error.message };
  }
}

// ===============================
// 从 Business Gemini 同步账号
// ===============================
async function syncBusinessGeminiAccounts() {
  if (!config.businessGemini.url || !config.businessGemini.adminPassword) {
    return { success: false, error: 'Business Gemini 未配置' };
  }

  try {
    const loginResp = await axios.post(`${config.businessGemini.url}/api/auth/login`, {
      password: config.businessGemini.adminPassword
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

    const setCookie = loginResp.headers['set-cookie'];
    const sessionCookie = setCookie ? setCookie[0].split(';')[0] : '';

    const accountsResp = await axios.get(`${config.businessGemini.url}/api/accounts`, {
      headers: { 'Cookie': sessionCookie },
      timeout: 30000
    });

    const accounts = accountsResp.data.accounts || [];
    businessGeminiAccounts = accounts;
    lastSyncTime = new Date();

    addLog('INFO', `从 Business Gemini 同步了 ${accounts.length} 个账号`);
    return { 
      success: true, 
      accounts,
      available: accounts.filter(a => a.available !== false).length,
      unavailable: accounts.filter(a => a.available === false).length
    };

  } catch (error) {
    addLog('ERROR', `同步 Business Gemini 账号失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}


// ===============================
// 核心登录任务
// ===============================
async function runLoginTask(email, password, captchaKey, mailConfig = null) {
  const userDataDir = createTempUserDataDir();
  const taskId = Date.now().toString();
  
  addLog('INFO', `开始登录任务`, email);

  let captchaNeeded = false;
  let lastBatchUrl = null;
  let lastBatchBody = null;
  let browser = null;

  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--js-flags=--max-old-space-size=256',
    '--window-size=1280,800'
  ];

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: config.browser.executablePath,
      userDataDir,
      args: browserArgs,
      protocolTimeout: 60000,
      // 添加内存限制
      ignoreDefaultArgs: ['--disable-extensions'],
      defaultViewport: { width: 1280, height: 800 },
      // 限制并发连接
      pipe: true
    });
  } catch (launchError) {
    addLog('ERROR', `浏览器启动失败: ${launchError.message}`, email);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    return { success: false, error: `浏览器启动失败: ${launchError.message}` };
  }

  try {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);

    page.on('request', req => {
      const url = req.url();
      if (url.includes('batchexecute') && req.method() === 'POST') {
        lastBatchUrl = url;
        lastBatchBody = req.postData();
      }
      const blockedTypes = ['image', 'media', 'font', 'stylesheet'];
      if (blockedTypes.includes(req.resourceType())) {
        return req.abort().catch(() => {});
      }
      if (url.includes('google-analytics') || url.includes('googletagmanager') || url.includes('doubleclick')) {
        return req.abort().catch(() => {});
      }
      req.continue().catch(() => {});
    });

    page.on('response', async res => {
      if (res.url().includes('batchexecute')) {
        try {
          const text = await res.text();
          if (text.includes('CAPTCHA_CHECK_FAILED')) {
            captchaNeeded = true;
          }
        } catch (e) {}
      }
    });

    // Step 1: 访问认证首页
    addLog('INFO', 'Step 1: 访问认证首页', email);
    await page.goto('https://auth.business.gemini.google/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);

    // Step 2: 设置 Cookie
    addLog('INFO', 'Step 2: 设置 Cookie', email);
    await page.setCookie({
      name: '__Host-AP_SignInXsrf',
      value: 'KdLRzKwwBTD5wo8nUollAbY6cW0',
      domain: 'auth.business.gemini.google',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict'
    });

    // Step 3: 访问登录页面
    const targetUrl = `https://auth.business.gemini.google/login/email?continueUrl=https%3A%2F%2Fbusiness.gemini.google%2F&loginHint=${encodeURIComponent(email)}&xsrfToken=KdLRzKwwBTD5wo8nUollAbY6cW0`;
    addLog('INFO', 'Step 3: 访问登录页面', email);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(3000);

    // Step 4: 处理 CAPTCHA
    if (captchaNeeded) {
      addLog('INFO', 'Step 4: 处理 CAPTCHA', email);
      const newToken = await getCaptchaToken(captchaKey);
      if (newToken && lastBatchBody) {
        const newPostData = patchPayload(lastBatchBody, newToken);
        await page.evaluate(async (url, body) => {
          await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'include' });
        }, lastBatchUrl, newPostData);
        captchaNeeded = false;
        await sleep(5000);
      }
    }

    // Step 5: 点击 Resend code
    const resendButton = await page.$('button[jsname="WGPTvf"]');
    if (resendButton) {
      addLog('INFO', 'Step 5: 点击 Resend code', email);
      captchaNeeded = false;
      await resendButton.click();
      await sleep(3000);
      if (captchaNeeded && lastBatchBody) {
        const token = await getCaptchaToken(captchaKey);
        if (token) {
          await page.evaluate(async (url, body) => {
            await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'include' });
          }, lastBatchUrl, patchPayload(lastBatchBody, token));
          await sleep(5000);
        }
      }
    }

    // Step 6: 获取验证码 - 等待 20 秒后开始轮询
    addLog('INFO', 'Step 6: 等待验证码邮件 (20秒)...', email);
    await sleep(20000);
    const code = await startPollingForCode(email, mailConfig);
    
    if (!code) {
      throw new Error("获取验证码超时");
    }

    // Step 7: 输入验证码
    addLog('INFO', `Step 7: 输入验证码 ${code}`, email);
    const inputSelectors = ['input[jsname="ovqh0b"]', 'input[type="text"]', 'input[autocomplete="one-time-code"]', 'input:not([type="hidden"])'];
    let inputElement = null;
    for (const sel of inputSelectors) {
      inputElement = await page.$(sel);
      if (inputElement) break;
    }
    if (!inputElement) throw new Error('找不到验证码输入框');
    await inputElement.type(code, { delay: 100 });

    // Step 8: 点击 Verify
    addLog('INFO', 'Step 8: 点击 Verify', email);
    const verifyBtn = await page.$('button[jsname="XooR8e"]') || await page.$('button[type="submit"]');
    if (verifyBtn) await verifyBtn.click();
    
    // 增加等待时间，让账号完成初始化
    addLog('INFO', '等待账号初始化完成 (5秒)...', email);
    await sleep(5000);

    // 检查是否需要同意条款
    const currentUrl = page.url();
    addLog('INFO', `验证后当前 URL: ${currentUrl}`, email);
    
    if (currentUrl.includes('/admin/create') || currentUrl.includes('/agree')) {
      const agreeBtn = await page.$('button.agree-button');
      if (agreeBtn) { 
        addLog('INFO', '点击同意条款按钮...', email);
        await agreeBtn.click(); 
        await sleep(5000); 
      }
    }

    // Step 9: 提取 Cookie
    addLog('INFO', 'Step 9: 提取 Cookie', email);
    let hostCoses = '', secureCSes = '';
    for (let i = 0; i < 15; i++) {
      const client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      await client.detach();
      for (const c of cookies) {
        if (c.name === '__Host-C_OSES') hostCoses = c.value;
        if (c.name === '__Secure-C_SES') secureCSes = c.value;
      }
      if (hostCoses && secureCSes) break;
      await sleep(1000);
      if (i === 5) await page.goto('https://business.gemini.google/', { waitUntil: 'networkidle2' }).catch(() => {});
    }

    if (!hostCoses || !secureCSes) throw new Error('Cookie 提取失败');

    // 提取 csesidx 和 team_id
    let finalUrl = page.url();
    let csesidx = '', team_id = '';
    
    addLog('INFO', `当前页面 URL: ${finalUrl}`, email);
    
    // 尝试从 URL 提取
    try {
      const urlObj = new URL(finalUrl);
      csesidx = urlObj.searchParams.get('csesidx') || '';
      
      // 重要发现：cid 就是 team_id！
      // 从 csesidx 参数可以推断出对应的 cid (team_id)
      if (csesidx) {
        // 先尝试从 URL 路径提取 cid
        const cidMatch = finalUrl.match(/\/cid\/([a-f0-9-]+)(?:\?|$)/);
        if (cidMatch) {
          team_id = cidMatch[1];
          addLog('INFO', `✓ 从URL路径提取到 team_id (cid): ${team_id}`, email);
        }
        
        // 如果URL路径没有cid，csesidx本身可能就包含了team_id信息
        // 或者我们需要通过其他方式获取
        if (!team_id) {
          // 尝试从 URL 参数提取
          team_id = urlObj.searchParams.get('team_id') || urlObj.searchParams.get('teamId') || urlObj.searchParams.get('cid') || '';
        }
      }
    } catch (e) {
      addLog('WARN', `URL解析失败: ${e.message}`, email);
    }
    
    // 如果还没有 team_id，尝试访问主页获取
    if (!team_id) {
      addLog('INFO', '尝试从主页获取 team_id...', email);
      try {
        await page.goto('https://business.gemini.google/', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        finalUrl = page.url();
        addLog('INFO', `主页 URL: ${finalUrl}`, email);
        
        // 从主页 URL 提取 team_id（支持完整的UUID格式）
        const cidMatch = finalUrl.match(/\/cid\/([a-f0-9-]+)(?:\?|$)/);
        if (cidMatch) {
          team_id = cidMatch[1];
          addLog('INFO', `✓ 从主页URL提取到 team_id: ${team_id}`, email);
        }
        
    // 如果还没有 team_id，尝试访问主页获取
    if (!team_id) {
      addLog('INFO', '尝试从主页获取 team_id...', email);
      try {
        await page.goto('https://business.gemini.google/', { waitUntil: 'networkidle2', timeout: 30000 });
        
        // 增加等待时间，让页面完全加载和初始化
        addLog('INFO', '等待主页完全加载 (15秒)...', email);
        await sleep(15000);
        
        finalUrl = page.url();
        addLog('INFO', `主页 URL: ${finalUrl}`, email);
        
        // 从主页 URL 提取 team_id
        const cidMatch = finalUrl.match(/\/cid\/([a-f0-9-]+)(?:\?|$)/);
        if (cidMatch) {
          team_id = cidMatch[1];
          addLog('INFO', `✓ 从主页URL提取到 team_id: ${team_id}`, email);
        }
        
        // 如果主页没有重定向到聊天界面，尝试多种方式进入聊天
        if (!team_id) {
          addLog('INFO', '尝试进入聊天界面获取 team_id...', email);
          
          // 方式1: 尝试直接访问聊天入口
          const chatUrls = [
            'https://business.gemini.google/chat',
            'https://business.gemini.google/app',
            'https://business.gemini.google/workspace'
          ];
          
          for (const chatUrl of chatUrls) {
            try {
              addLog('INFO', `尝试访问: ${chatUrl}`, email);
              await page.goto(chatUrl, { waitUntil: 'networkidle2', timeout: 15000 });
              await sleep(3000);
              
              const newUrl = page.url();
              addLog('INFO', `访问后 URL: ${newUrl}`, email);
              
              const newCidMatch = newUrl.match(/\/cid\/([a-f0-9-]+)(?:\?|$)/);
              if (newCidMatch) {
                team_id = newCidMatch[1];
                addLog('INFO', `✓ 从聊天界面提取到 team_id: ${team_id}`, email);
                break;
              }
            } catch (e) {
              addLog('WARN', `访问 ${chatUrl} 失败: ${e.message}`, email);
            }
          }
          
          // 方式2: 如果还没有，回到主页尝试点击按钮
          if (!team_id) {
            addLog('INFO', '回到主页尝试点击聊天按钮...', email);
            await page.goto('https://business.gemini.google/', { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
            
            // 尝试点击各种可能的按钮
            const buttonSelectors = [
              'button[data-testid="start-chat"]',
              'button:has-text("开始聊天")',
              'button:has-text("Start chat")',
              'button:has-text("Chat")',
              'button:has-text("开始")',
              'a[href*="/cid/"]',
              'a[href*="/chat"]',
              '[data-testid="chat-button"]',
              '.chat-button',
              '[role="button"]:has-text("Chat")',
              'button[aria-label*="chat"]',
              'button[aria-label*="Chat"]'
            ];
            
            for (const selector of buttonSelectors) {
              try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                  addLog('INFO', `找到 ${elements.length} 个匹配元素: ${selector}`, email);
                  
                  for (let i = 0; i < elements.length; i++) {
                    try {
                      const element = elements[i];
                      const text = await element.textContent();
                      addLog('INFO', `尝试点击元素 ${i + 1}: "${text}"`, email);
                      
                      await element.click();
                      await sleep(5000);
                      
                      const newUrl = page.url();
                      addLog('INFO', `点击后 URL: ${newUrl}`, email);
                      
                      const newCidMatch = newUrl.match(/\/cid\/([a-f0-9-]+)(?:\?|$)/);
                      if (newCidMatch) {
                        team_id = newCidMatch[1];
                        addLog('INFO', `✓ 从聊天界面提取到 team_id: ${team_id}`, email);
                        break;
                      }
                    } catch (e) {
                      addLog('WARN', `点击元素失败: ${e.message}`, email);
                    }
                  }
                  
                  if (team_id) break;
                }
              } catch (e) {
                // 继续尝试下一个选择器
              }
            }
          }
        }
        
        // 如果还没有，尝试从页面内容提取
        if (!team_id) {
          const pageContent = await page.content();
          // 尝试多种模式匹配（支持完整UUID格式）
          const patterns = [
            /"teamId"\s*:\s*"?([a-f0-9-]+)"?/i,
            /"team_id"\s*:\s*"?([a-f0-9-]+)"?/i,
            /teamId["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
            /team_id["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
            /\/cid\/([a-f0-9-]+)/i,
            /cid[=:]([a-f0-9-]+)/i,
            /"configId"\s*:\s*"?([a-f0-9-]+)"?/i,
            /"config_id"\s*:\s*"?([a-f0-9-]+)"?/i,
            /data-team-id["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
            /teamid["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i
          ];
          
          for (const pattern of patterns) {
            const match = pageContent.match(pattern);
            if (match) {
              team_id = match[1];
              addLog('INFO', `✓ 从页面内容提取到 team_id: ${team_id} (模式: ${pattern.source})`, email);
              break;
            }
          }
        }
      } catch (e) {
        addLog('WARN', `获取 team_id 失败: ${e.message}`, email);
      }
    }
        
        // 如果还没有，尝试从页面内容提取
        if (!team_id) {
          const pageContent = await page.content();
          // 尝试多种模式匹配
          const patterns = [
            /"teamId"\s*:\s*"?(\d+)"?/,
            /"team_id"\s*:\s*"?(\d+)"?/,
            /teamId["\']?\s*[:=]\s*["\']?(\d+)/,
            /team_id["\']?\s*[:=]\s*["\']?(\d+)/,
            /\/cid\/(\d+)/,
            /cid[=:](\d+)/,
            /"configId"\s*:\s*"?(\d+)"?/,
            /"config_id"\s*:\s*"?(\d+)"?/
          ];
          
          for (const pattern of patterns) {
            const match = pageContent.match(pattern);
            if (match) {
              team_id = match[1];
              addLog('INFO', `✓ 从页面内容提取到 team_id: ${team_id} (模式: ${pattern.source})`, email);
              break;
            }
          }
        }
      } catch (e) {
        addLog('WARN', `获取 team_id 失败: ${e.message}`, email);
      }
    }
    
    // 如果还是没有，尝试从当前页面内容提取
    if (!team_id) {
      try {
        addLog('INFO', '尝试从当前页面内容提取 team_id...', email);
        const currentPageContent = await page.content();
        const patterns = [
          /"teamId"\s*:\s*"?([a-f0-9-]+)"?/i,
          /"team_id"\s*:\s*"?([a-f0-9-]+)"?/i,
          /teamId["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
          /team_id["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
          /team[_-]?id["\']?\s*[:=]\s*["\']?([a-f0-9-]+)/i,
          /"configId"\s*:\s*"?([a-f0-9-]+)"?/i,
          /"config_id"\s*:\s*"?([a-f0-9-]+)"?/i
        ];
        
        for (const pattern of patterns) {
          const match = currentPageContent.match(pattern);
          if (match) {
            team_id = match[1];
            addLog('INFO', `✓ 从当前页面提取到 team_id: ${team_id} (模式: ${pattern.source})`, email);
            break;
          }
        }
      } catch (e) {
        addLog('WARN', `从页面内容提取 team_id 失败: ${e.message}`, email);
      }
    }
    
    addLog('INFO', `提取结果 - csesidx: ${csesidx}, team_id: ${team_id}`, email);

    addLog('SUCCESS', '登录成功！', email);
    
    // 返回 business-gemini 格式的 Cookie 数据
    return {
      success: true,
      email,
      password,
      // 兼容旧格式
      cookies: `${hostCoses.trim()}::${secureCSes.trim()}`,
      // business-gemini 格式
      cookieData: {
        secure_c_ses: secureCSes.trim(),
        host_c_oses: hostCoses.trim(),
        csesidx,
        team_id
      }
    };

  } catch (error) {
    addLog('ERROR', `登录失败: ${error.message}`, email);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}


// ===============================
// 自动注册单个账号
// ===============================
async function registerSingleAccount(accountIndex) {
  try {
    // 1. 创建临时邮箱
    addLog('INFO', `[注册 ${accountIndex + 1}] 创建临时邮箱...`);
    const mailbox = await createTempMailbox();
    
    // 2. 登录获取 Cookie
    addLog('INFO', `[注册 ${accountIndex + 1}] 开始登录: ${mailbox.email}`);
    const loginResult = await runLoginTask(
      mailbox.email,
      '',
      config.yesCaptcha.apiKey,
      { jwtUrl: mailbox.jwtUrl }
    );

    if (!loginResult.success || !loginResult.cookieData) {
      throw new Error(loginResult.error || '登录失败');
    }

    // 3. 推送到 Business Gemini - 获取正确的账号ID
    // 先同步现有账号，获取最新的账号列表
    const syncResult = await syncBusinessGeminiAccounts();
    let pushAccountId;
    
    if (syncResult.success && syncResult.accounts) {
      // 找到最大的账号ID，然后+1
      const maxId = syncResult.accounts.reduce((max, acc, index) => {
        return Math.max(max, index);
      }, -1);
      pushAccountId = maxId + 1;
    } else {
      // 如果同步失败，使用本地账号数量作为ID
      pushAccountId = runtimeAccounts.length;
    }
    
    // ✅ 验证 team_id 是否存在，如果没有则跳过推送
    if (!loginResult.cookieData.team_id || loginResult.cookieData.team_id.trim() === '') {
      addLog('WARN', `[注册 ${accountIndex + 1}] team_id 为空，跳过推送到后台`, mailbox.email);
      addLog('SUCCESS', `[注册 ${accountIndex + 1}] 完成: ${mailbox.email} (未推送，team_id缺失)`, mailbox.email);
      return { success: true, skipped: true, reason: 'team_id_missing' };
    }
    
    addLog('INFO', `[注册 ${accountIndex + 1}] 推送 Cookie 到后台 (ID: ${pushAccountId})`, mailbox.email);
    
    const pushResult = await pushToBusinessGemini(loginResult.cookieData, {
      url: config.businessGemini.url,
      adminPassword: config.businessGemini.adminPassword,
      accountId: pushAccountId
    }, mailbox.email, { jwtUrl: mailbox.jwtUrl });

    // 4. 添加到本地账号列表
    const newAccount = {
      email: mailbox.email,
      mailJwtUrl: mailbox.jwtUrl,
      accountId: pushAccountId,
      captchaKey: '',
      createdAt: new Date().toISOString()
    };
    
    return { success: true, account: newAccount, pushResult };

  } catch (error) {
    addLog('ERROR', `[注册 ${accountIndex + 1}] 失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ===============================
// 批量自动注册
// ===============================
async function runAutoRegister(count) {
  if (registerStatus.running) {
    addLog('WARN', '注册任务正在运行中');
    return;
  }

  registerStatus = { running: true, total: count, completed: 0, results: [] };
  addLog('INFO', `开始批量注册 ${count} 个账号`);

  for (let i = 0; i < count; i++) {
    try {
      const result = await registerSingleAccount(i);
      registerStatus.completed++;
      
      if (result.success) {
        if (result.skipped) {
          // 跳过的账号（team_id缺失）
          registerStatus.results.push({
            index: i + 1,
            success: true,
            skipped: true,
            reason: result.reason,
            message: 'team_id缺失，跳过推送'
          });
          addLog('SUCCESS', `[注册 ${i + 1}/${count}] 完成: ${result.email || '未知邮箱'} (跳过推送)`);
        } else {
          // 正常成功的账号 - 不再添加到本地列表，因为已推送到后台
          registerStatus.results.push({
            index: i + 1,
            success: true,
            skipped: false,
            email: result.account.email,
            accountId: result.account.accountId,
            message: '注册成功'
          });
          addLog('SUCCESS', `[注册 ${i + 1}/${count}] 完成: ${result.account.email}`);
        }
      } else {
        registerStatus.results.push({
          index: i + 1,
          success: false,
          skipped: false,
          message: result.error
        });
      }

      if (i < count - 1) {
        addLog('INFO', `等待 ${config.interval.register} 秒后注册下一个账号...`);
        await sleep(config.interval.register * 1000);
      }

    } catch (error) {
      registerStatus.completed++;
      registerStatus.results.push({
        index: i + 1,
        success: false,
        message: error.message
      });
    }
  }

  const successCount = registerStatus.results.filter(r => r.success && !r.skipped).length;
  const skippedCount = registerStatus.results.filter(r => r.success && r.skipped).length;
  const failedCount = registerStatus.results.filter(r => !r.success).length;
  
  let summaryMsg = `批量注册完成: ${successCount}/${count} 成功`;
  if (skippedCount > 0) {
    summaryMsg += `, ${skippedCount} 跳过(team_id缺失)`;
  }
  if (failedCount > 0) {
    summaryMsg += `, ${failedCount} 失败`;
  }
  
  addLog('INFO', summaryMsg);
  registerStatus.running = false;
}

// ===============================
// 自动刷新任务
// ===============================
async function runAutoRefresh() {
  if (refreshStatus.running) {
    addLog('WARN', '刷新任务正在运行中，跳过');
    return;
  }

  const accounts = runtimeAccounts;
  if (!accounts || accounts.length === 0) {
    addLog('WARN', '未配置自动刷新账号');
    return;
  }

  refreshStatus.running = true;
  refreshStatus.lastResult = [];
  lastRefreshTime = new Date();

  addLog('INFO', `开始自动刷新 Cookie (${accounts.length} 个账号)`);

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    try {
      addLog('INFO', `处理账号 ${i + 1}/${accounts.length}`, account.email);
      
      const result = await runLoginTask(
        account.email,
        account.password || '',
        account.captchaKey || config.yesCaptcha.apiKey,
        { jwtUrl: account.mailJwtUrl }
      );

      if (result.success && result.cookieData) {
        const pushResult = await pushToBusinessGemini(result.cookieData, {
          url: config.businessGemini.url,
          adminPassword: config.businessGemini.adminPassword,
          accountId: account.accountId ?? i
        }, account.email);

        refreshStatus.lastResult.push({
          email: account.email,
          accountId: account.accountId ?? i,
          success: pushResult.success,
          message: pushResult.success ? '刷新并推送成功' : pushResult.error,
          time: new Date().toISOString()
        });
      } else {
        refreshStatus.lastResult.push({
          email: account.email,
          accountId: account.accountId ?? i,
          success: false,
          message: result.error || '登录失败',
          time: new Date().toISOString()
        });
      }
    } catch (error) {
      addLog('ERROR', `处理失败: ${error.message}`, account.email);
      refreshStatus.lastResult.push({
        email: account.email,
        accountId: account.accountId ?? i,
        success: false,
        message: error.message,
        time: new Date().toISOString()
      });
    }

    if (i < accounts.length - 1) {
      addLog('INFO', `等待 ${config.interval.refresh} 秒后处理下一个账号...`);
      await sleep(config.interval.refresh * 1000);
    }
  }

  addLog('INFO', '自动刷新完成');
  refreshStatus.running = false;
}

// 自动刷新后台过期账号
async function runAutoRefreshExpiredAccounts() {
  if (refreshStatus.running) {
    return { success: false, message: '刷新任务正在运行中' };
  }

  addLog('INFO', '开始检测后台过期账号...');
  
  const syncResult = await syncBusinessGeminiAccounts();
  if (!syncResult.success || !syncResult.accounts) {
    addLog('ERROR', '同步后台账号失败');
    return { success: false, message: '同步后台账号失败' };
  }

  const backendAccounts = syncResult.accounts;
  const expiredAccounts = backendAccounts.filter(acc => acc.available === false || acc.cookie_expired === true);

  if (expiredAccounts.length === 0) {
    addLog('INFO', '没有发现过期账号');
    return { success: true, message: '没有过期账号需要刷新', refreshed: 0 };
  }

  addLog('INFO', `发现 ${expiredAccounts.length} 个过期账号，开始刷新...`);

  refreshStatus.running = true;
  refreshStatus.lastResult = [];
  lastRefreshTime = new Date();

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < expiredAccounts.length; i++) {
    const account = expiredAccounts[i];
    const accountIndex = backendAccounts.indexOf(account);
    
    if (!account.tempmail_name || !account.tempmail_url) {
      addLog('WARN', `账号 ${accountIndex} 缺少邮箱信息，跳过`);
      failCount++;
      continue;
    }

    try {
      addLog('INFO', `[${i + 1}/${expiredAccounts.length}] 刷新账号 ${accountIndex}: ${account.tempmail_name}`);
      
      const result = await runLoginTask(account.tempmail_name, '', config.yesCaptcha.apiKey, { jwtUrl: account.tempmail_url });

      if (result.success && result.cookieData) {
        const pushResult = await pushToBusinessGemini(result.cookieData, {
          url: config.businessGemini.url,
          adminPassword: config.businessGemini.adminPassword,
          accountId: accountIndex
        }, account.tempmail_name, { jwtUrl: account.tempmail_url });

        if (pushResult.success) {
          addLog('SUCCESS', `账号 ${accountIndex} 刷新成功`, account.tempmail_name);
          successCount++;
          
          // 从本地管理列表中移除已成功刷新的账号
          const localIndex = runtimeAccounts.findIndex(a => a.email === account.tempmail_name);
          if (localIndex !== -1) {
            runtimeAccounts.splice(localIndex, 1);
            saveAccounts();
            addLog('INFO', `已从本地管理移除: ${account.tempmail_name}`);
          }
        } else {
          addLog('ERROR', `账号 ${accountIndex} 推送失败`, account.tempmail_name);
          failCount++;
        }
      } else {
        addLog('ERROR', `账号 ${accountIndex} 登录失败`, account.tempmail_name);
        failCount++;
      }
    } catch (error) {
      addLog('ERROR', `账号 ${accountIndex} 处理失败: ${error.message}`, account.tempmail_name);
      failCount++;
    }

    if (i < expiredAccounts.length - 1) {
      addLog('INFO', `等待 ${config.interval.refresh} 秒后处理下一个账号...`);
      await sleep(config.interval.refresh * 1000);
    }
  }

  refreshStatus.running = false;
  const summary = `过期账号刷新完成: ${successCount}/${expiredAccounts.length} 成功, ${failCount} 失败`;
  addLog('INFO', summary);
  
  return { success: true, message: summary, total: expiredAccounts.length, refreshed: successCount, failed: failCount };
}


// ===============================
// API 路由
// ===============================

// 账号管理
app.get('/api/accounts', (req, res) => {
  res.json({ accounts: runtimeAccounts });
});

app.post('/api/accounts', (req, res) => {
  const { email, mailJwtUrl, accountId, captchaKey } = req.body;
  if (!email) return res.status(400).json({ error: '邮箱不能为空' });
  
  const exists = runtimeAccounts.find(a => a.email === email);
  if (exists) return res.status(400).json({ error: '账号已存在' });
  
  const newAccount = {
    email,
    mailJwtUrl: mailJwtUrl || '',
    accountId: accountId ?? runtimeAccounts.length,
    captchaKey: captchaKey || '',
    createdAt: new Date().toISOString()
  };
  runtimeAccounts.push(newAccount);
  saveAccounts();
  addLog('INFO', `添加账号: ${email}`);
  res.json({ success: true, account: newAccount });
});

app.put('/api/accounts/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= runtimeAccounts.length) {
    return res.status(404).json({ error: '账号不存在' });
  }
  
  const { email, mailJwtUrl, accountId, captchaKey } = req.body;
  runtimeAccounts[index] = {
    ...runtimeAccounts[index],
    email: email || runtimeAccounts[index].email,
    mailJwtUrl: mailJwtUrl ?? runtimeAccounts[index].mailJwtUrl,
    accountId: accountId ?? runtimeAccounts[index].accountId,
    captchaKey: captchaKey ?? runtimeAccounts[index].captchaKey
  };
  saveAccounts();
  addLog('INFO', `更新账号: ${runtimeAccounts[index].email}`);
  res.json({ success: true, account: runtimeAccounts[index] });
});

app.delete('/api/accounts/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= runtimeAccounts.length) {
    return res.status(404).json({ error: '账号不存在' });
  }
  
  const removed = runtimeAccounts.splice(index, 1)[0];
  saveAccounts();
  addLog('INFO', `删除账号: ${removed.email}`);
  res.json({ success: true, removed });
});

// 注册相关
app.get('/api/register-status', (req, res) => {
  res.json(registerStatus);
});

app.post('/api/register', async (req, res) => {
  const { count } = req.body;
  const registerCount = parseInt(count) || 1;
  
  if (registerCount < 1 || registerCount > 10) {
    return res.status(400).json({ error: '注册数量必须在 1-10 之间' });
  }
  
  if (registerStatus.running) {
    return res.json({ success: false, message: '注册任务正在运行中' });
  }
  
  if (!config.mail.tempMailUrl) {
    return res.status(400).json({ error: '未配置临时邮箱服务地址 (TEMP_MAIL_URL)' });
  }
  
  if (!config.yesCaptcha.apiKey) {
    return res.status(400).json({ error: '未配置 YesCaptcha API Key' });
  }
  
  res.json({ success: true, message: `开始注册 ${registerCount} 个账号` });
  runAutoRegister(registerCount);
});

// Business Gemini 同步
app.get('/api/business-gemini/accounts', async (req, res) => {
  const result = await syncBusinessGeminiAccounts();
  res.json(result);
});

// 从后台同步过期账号到本地（只同步过期的、有邮箱URL的账号）
app.post('/api/sync-expired-accounts', async (req, res) => {
  const syncResult = await syncBusinessGeminiAccounts();
  if (!syncResult.success || !syncResult.accounts) {
    return res.json({ success: false, error: '同步后台账号失败' });
  }

  const backendAccounts = syncResult.accounts;
  let addedCount = 0;
  let noUrlCount = 0;
  let alreadyExistsCount = 0;

  // 只同步过期的账号
  for (let i = 0; i < backendAccounts.length; i++) {
    const acc = backendAccounts[i];
    
    // 只处理过期账号
    if (acc.available !== false && acc.cookie_expired !== true) {
      continue;
    }
    
    // 必须有邮箱信息
    if (!acc.tempmail_name || !acc.tempmail_url) {
      noUrlCount++;
      continue;
    }

    // 检查是否已存在
    const exists = runtimeAccounts.find(a => a.email === acc.tempmail_name);
    if (exists) {
      alreadyExistsCount++;
      continue;
    }

    runtimeAccounts.push({
      email: acc.tempmail_name,
      mailJwtUrl: acc.tempmail_url,
      accountId: i,
      captchaKey: ''
    });
    addedCount++;
  }

  saveAccounts();
  addLog('INFO', `同步过期账号: 新增 ${addedCount} 个, 缺少邮箱URL ${noUrlCount} 个, 已存在 ${alreadyExistsCount} 个`);
  res.json({ success: true, added: addedCount, noUrl: noUrlCount, alreadyExists: alreadyExistsCount });
});

// 日志
app.get('/api/logs', (req, res) => {
  // 在返回日志前先清理旧日志
  cleanupOldLogs();
  
  const limit = parseInt(req.query.limit) || 50;
  res.json({ 
    logs: logs.slice(0, limit),
    total: logs.length,
    retention_hours: LOG_RETENTION_HOURS
  });
});

app.delete('/api/logs', (req, res) => {
  logs = [];
  res.json({ success: true });
});

// 刷新状态
app.get('/api/refresh-status', (req, res) => {
  res.json({
    running: refreshStatus.running,
    lastRefreshTime: lastRefreshTime ? lastRefreshTime.toISOString() : null,
    lastResult: refreshStatus.lastResult,
    accountCount: runtimeAccounts.length
  });
});

// 定时任务状态
app.get('/api/schedule-status', (req, res) => {
  res.json({
    register: {
      enabled: config.schedule.registerIntervalHours > 0,
      intervalHours: config.schedule.registerIntervalHours,
      count: config.schedule.registerCount,
      lastRun: lastScheduledRegisterTime ? lastScheduledRegisterTime.toISOString() : null
    },
    refresh: {
      enabled: config.schedule.refreshIntervalHours > 0,
      intervalHours: config.schedule.refreshIntervalHours,
      lastRun: lastScheduledRefreshTime ? lastScheduledRefreshTime.toISOString() : null
    }
  });
});

app.post('/api/trigger-refresh', async (req, res) => {
  if (refreshStatus.running) {
    return res.json({ success: false, message: '刷新任务正在运行中' });
  }
  res.json({ success: true, message: '刷新任务已触发' });
  runAutoRefresh();
});

// 触发刷新后台过期账号
app.post('/api/trigger-refresh-expired', async (req, res) => {
  if (refreshStatus.running) {
    return res.json({ success: false, message: '刷新任务正在运行中' });
  }
  res.json({ success: true, message: '过期账号刷新任务已触发' });
  runAutoRefreshExpiredAccounts().catch(err => {
    addLog('ERROR', `自动刷新过期账号失败: ${err.message}`);
  });
});

// 单个账号刷新
app.post('/api/refresh/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= runtimeAccounts.length) {
    return res.status(404).json({ error: '账号不存在' });
  }
  
  const account = runtimeAccounts[index];
  addLog('INFO', `手动刷新账号`, account.email);
  
  try {
    const result = await runLoginTask(
      account.email,
      account.password || '',
      account.captchaKey || config.yesCaptcha.apiKey,
      { jwtUrl: account.mailJwtUrl }
    );

    if (result.success && result.cookieData) {
      const pushResult = await pushToBusinessGemini(result.cookieData, {
        url: config.businessGemini.url,
        adminPassword: config.businessGemini.adminPassword,
        accountId: account.accountId ?? index
      }, account.email);
      
      res.json({ success: true, result, pushResult });
    } else {
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 手动登录
app.post('/api/login', async (req, res) => {
  const { email, password = '', captchaKey, mailJwtUrl, autoPush, accountId } = req.body;
  
  if (!email) return res.status(400).json({ success: false, error: '请提供邮箱' });
  
  const finalCaptchaKey = captchaKey || config.yesCaptcha.apiKey;
  if (!finalCaptchaKey) return res.status(400).json({ success: false, error: '请提供 YesCaptcha API Key' });

  const mailConfig = mailJwtUrl ? { jwtUrl: mailJwtUrl } : null;
  if (!mailConfig) {
    return res.status(400).json({ success: false, error: '请提供邮件 JWT URL' });
  }
  
  try {
    const result = await runLoginTask(email, password, finalCaptchaKey, mailConfig);
    
    if (result.success && result.cookieData && autoPush !== false) {
      result.pushResult = await pushToBusinessGemini(result.cookieData, {
        url: config.businessGemini.url,
        adminPassword: config.businessGemini.adminPassword,
        accountId: accountId ?? config.businessGemini.accountId
      }, email);
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    accounts: runtimeAccounts.length,
    config: {
      tempMailUrl: !!config.mail.tempMailUrl,
      businessGeminiUrl: !!config.businessGemini.url,
      yesCaptchaKey: !!config.yesCaptcha.apiKey
    }
  });
});

// ===============================
// 运行时配置 API
// ===============================
app.get('/api/runtime-config', (req, res) => {
  res.json({
    success: true,
    config: {
      registerIntervalSeconds: runtimeConfig.registerIntervalSeconds,
      refreshIntervalSeconds: runtimeConfig.refreshIntervalSeconds,
      scheduleRegisterHours: runtimeConfig.scheduleRegisterHours,
      scheduleRegisterCount: runtimeConfig.scheduleRegisterCount,
      scheduleRefreshHours: runtimeConfig.scheduleRefreshHours,
      // 服务配置
      tempMailUrl: config.mail.tempMailUrl || '',
      businessGeminiUrl: config.businessGemini.url || '',
      businessGeminiPassword: config.businessGemini.adminPassword ? '******' : '',
      yesCaptchaApiKey: config.yesCaptcha.apiKey ? '******' : ''
    }
  });
});

app.put('/api/runtime-config', (req, res) => {
  const { registerIntervalSeconds, refreshIntervalSeconds, scheduleRegisterHours, scheduleRegisterCount, scheduleRefreshHours, tempMailUrl, businessGeminiUrl, businessGeminiPassword, yesCaptchaApiKey } = req.body;
  
  // 更新运行时配置
  if (registerIntervalSeconds !== undefined) {
    runtimeConfig.registerIntervalSeconds = Math.max(10, parseInt(registerIntervalSeconds) || 60);
    config.interval.register = runtimeConfig.registerIntervalSeconds;
  }
  if (refreshIntervalSeconds !== undefined) {
    runtimeConfig.refreshIntervalSeconds = Math.max(10, parseInt(refreshIntervalSeconds) || 30);
    config.interval.refresh = runtimeConfig.refreshIntervalSeconds;
  }
  if (scheduleRegisterHours !== undefined) {
    runtimeConfig.scheduleRegisterHours = Math.max(0, parseFloat(scheduleRegisterHours) || 0);
    config.schedule.registerIntervalHours = runtimeConfig.scheduleRegisterHours;
  }
  if (scheduleRegisterCount !== undefined) {
    runtimeConfig.scheduleRegisterCount = Math.max(1, Math.min(10, parseInt(scheduleRegisterCount) || 1));
    config.schedule.registerCount = runtimeConfig.scheduleRegisterCount;
  }
  if (scheduleRefreshHours !== undefined) {
    runtimeConfig.scheduleRefreshHours = Math.max(0, parseFloat(scheduleRefreshHours) || 0);
    config.schedule.refreshIntervalHours = runtimeConfig.scheduleRefreshHours;
  }
  
  // 服务配置（只有非空且非占位符时才更新）
  if (tempMailUrl !== undefined && tempMailUrl !== '') {
    runtimeConfig.tempMailUrl = tempMailUrl;
    config.mail.tempMailUrl = tempMailUrl;
  }
  if (businessGeminiUrl !== undefined && businessGeminiUrl !== '') {
    runtimeConfig.businessGeminiUrl = businessGeminiUrl;
    config.businessGemini.url = businessGeminiUrl;
  }
  if (businessGeminiPassword !== undefined && businessGeminiPassword !== '' && businessGeminiPassword !== '******') {
    runtimeConfig.businessGeminiPassword = businessGeminiPassword;
    config.businessGemini.adminPassword = businessGeminiPassword;
  }
  if (yesCaptchaApiKey !== undefined && yesCaptchaApiKey !== '' && yesCaptchaApiKey !== '******') {
    runtimeConfig.yesCaptchaApiKey = yesCaptchaApiKey;
    config.yesCaptcha.apiKey = yesCaptchaApiKey;
  }
  
  // 保存到文件
  saveRuntimeConfig();
  
  // 重启定时任务
  restartScheduledTasks();
  
  addLog('INFO', `运行时配置已更新`);
  
  res.json({
    success: true,
    config: runtimeConfig
  });
});

// 重启定时任务
function restartScheduledTasks() {
  // 清除现有定时器
  if (scheduleTimers.register) {
    clearInterval(scheduleTimers.register);
    scheduleTimers.register = null;
  }
  if (scheduleTimers.refresh) {
    clearInterval(scheduleTimers.refresh);
    scheduleTimers.refresh = null;
  }
  
  // 重新启动定时任务
  startScheduledTasks();
}


// ===============================
// 前端页面
// ===============================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Auto v6.3</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); word-wrap: break-word; overflow-wrap: break-word; }
    h1 { color: #333; margin-bottom: 8px; font-size: 24px; }
    h2 { color: #555; margin-bottom: 15px; font-size: 18px; }
    .subtitle { color: #666; margin-bottom: 20px; font-size: 14px; }
    .form-group { margin-bottom: 12px; }
    label { display: block; margin-bottom: 4px; font-weight: 600; color: #444; font-size: 13px; }
    input, select, textarea { width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #667eea; }
    button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; margin-right: 8px; margin-bottom: 8px; }
    button:hover { transform: translateY(-1px); }
    button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    button.danger { background: #dc3545; }
    button.success { background: #28a745; }
    button.secondary { background: #6c757d; }
    .status { padding: 6px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; display: inline-block; margin-right: 6px; margin-bottom: 6px; }
    .status-ok { background: #d4edda; color: #155724; }
    .status-warn { background: #fff3cd; color: #856404; }
    .account-list { max-height: 300px; overflow-y: auto; }
    .account-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 8px; }
    .account-item:hover { background: #f8f9fa; }
    .account-info { flex: 1; }
    .account-email { font-weight: 600; color: #333; }
    .account-meta { font-size: 12px; color: #666; margin-top: 4px; }
    .account-actions button { padding: 6px 12px; font-size: 12px; margin: 0 2px; }
    .log-container { max-height: 400px; overflow-y: auto; background: #1e1e1e; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; word-break: break-all; overflow-wrap: break-word; }
    .log-item { padding: 4px 0; border-bottom: 1px solid #333; word-break: break-word; }
    .log-time { color: #888; }
    .log-level { padding: 2px 6px; border-radius: 4px; font-size: 10px; margin: 0 6px; }
    .log-level.INFO { background: #17a2b8; color: white; }
    .log-level.SUCCESS { background: #28a745; color: white; }
    .log-level.WARN { background: #ffc107; color: black; }
    .log-level.ERROR { background: #dc3545; color: white; }
    .log-message { color: #ddd; word-break: break-word; }
    .log-email { color: #667eea; word-break: break-word; }
    .result { background: #f8f9fa; border-radius: 8px; padding: 12px; margin-top: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
    .result.success { border-left: 4px solid #28a745; }
    .result.error { border-left: 4px solid #dc3545; }
    .refresh-result { margin-top: 12px; }
    .refresh-item { padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 13px; }
    .refresh-item.success { background: #d4edda; }
    .refresh-item.error { background: #f8d7da; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🤖 Gemini Business 自动化 v6</h1>
      <p class="subtitle">整合 zeabur-mail + business-gemini + cookie-refresher</p>
      <div>
        <span class="status ${config.yesCaptcha.apiKey ? 'status-ok' : 'status-warn'}">YesCaptcha: ${config.yesCaptcha.apiKey ? '✓' : '○'}</span>
        <span class="status ${config.businessGemini.url ? 'status-ok' : 'status-warn'}">Business Gemini: ${config.businessGemini.url ? '✓' : '○'}</span>
        <span class="status ${config.mail.tempMailUrl ? 'status-ok' : 'status-warn'}">临时邮箱: ${config.mail.tempMailUrl ? '✓' : '○'}</span>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="card">
          <h2>🏢 Business Gemini 后台账号</h2>
          <div id="bgAccountList" style="margin-bottom: 12px;">加载中...</div>
          <button class="secondary" onclick="syncBGAccounts()">🔄 同步账号</button>
          <button class="success" onclick="importFromBackend()" style="margin-left: 8px;">📥 导入到本地</button>
        </div>

        <div class="card">
          <h2>🔴 过期Cookie管理</h2>
          <p style="font-size: 11px; color: #666; margin-bottom: 8px;">自动从后台同步过期账号，刷新成功后自动移除</p>
          <div id="accountList" class="account-list">加载中...</div>
          <button onclick="syncExpiredAccounts()" class="secondary" style="margin-top: 8px;">🔄 同步过期账号</button>
          
          <hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">
          <h3 style="font-size: 14px; margin-bottom: 10px;">🤖 自动注册账号</h3>
          <div class="form-group">
            <label>注册数量 (1-10)</label>
            <input type="number" id="registerCount" value="1" min="1" max="10">
          </div>
          <button onclick="startRegister()" id="registerBtn">🚀 开始自动注册</button>
          <div id="registerStatus" style="margin-top: 12px;"></div>
        </div>

        <div class="card">
          <h2>🔄 刷新状态</h2>
          <div id="refreshStatus">加载中...</div>
          <button onclick="triggerRefresh()" style="margin-top: 12px;">🔄 立即刷新全部过期</button>
        </div>

        <div class="card">
          <h2>⚙️ 系统设置</h2>
          
          <h3 style="font-size: 14px; margin-bottom: 10px;">🔗 服务配置</h3>
          
          <div class="form-group">
            <label>临时邮箱服务地址</label>
            <input type="text" id="cfgTempMailUrl" placeholder="https://zeabur-mail.zeabur.app">
          </div>
          
          <div class="form-group">
            <label>Business Gemini 后台地址</label>
            <input type="text" id="cfgBusinessGeminiUrl" placeholder="https://business-gemini.zeabur.app">
          </div>
          
          <div class="form-group">
            <label>Business Gemini 密码</label>
            <input type="password" id="cfgBusinessGeminiPassword" placeholder="******">
          </div>
          
          <div class="form-group">
            <label>YesCaptcha API Key</label>
            <input type="password" id="cfgYesCaptchaApiKey" placeholder="******">
          </div>
          
          <hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">
          <h3 style="font-size: 14px; margin-bottom: 10px;">⏱️ 操作间隔</h3>
          <p style="font-size: 11px; color: #666; margin-bottom: 10px;">设置各操作之间的间隔时间，避免频繁操作被检测</p>
          
          <div class="form-group">
            <label>注册间隔（秒）</label>
            <input type="number" id="cfgRegisterInterval" min="10" placeholder="60">
          </div>
          
          <div class="form-group">
            <label>刷新间隔（秒）</label>
            <input type="number" id="cfgRefreshInterval" min="10" placeholder="30">
          </div>
          
          <hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">
          <h3 style="font-size: 14px; margin-bottom: 10px;">⏰ 定时任务</h3>
          
          <div class="form-group">
            <label>定时注册间隔（小时）</label>
            <input type="number" id="cfgScheduleRegisterHours" min="0" step="0.1" placeholder="0">
            <small style="color: #888; font-size: 11px;">0 = 禁用，0.5 = 30分钟</small>
          </div>
          
          <div class="form-group">
            <label>每次定时注册数量</label>
            <input type="number" id="cfgScheduleRegisterCount" min="1" max="10" placeholder="1">
          </div>
          
          <div class="form-group">
            <label>定时刷新间隔（小时）</label>
            <input type="number" id="cfgScheduleRefreshHours" min="0" step="0.1" placeholder="0">
            <small style="color: #888; font-size: 11px;">0 = 禁用，0.5 = 30分钟</small>
          </div>
          
          <button onclick="saveSettings()" class="success">💾 保存设置</button>
          <button onclick="loadSettings()" class="secondary">🔄 重新加载</button>
          <div id="settingsStatus" style="margin-top: 8px; font-size: 12px;"></div>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>📧 手动登录</h2>
          <div class="form-group">
            <label>选择账号</label>
            <select id="loginAccountSelect" onchange="onAccountSelect()">
              <option value="">-- 手动输入 --</option>
            </select>
          </div>
          <div class="form-group">
            <label>邮箱地址</label>
            <input type="email" id="loginEmail" placeholder="xxx@example.com">
          </div>
          <div class="form-group">
            <label>邮件 JWT URL (zeabur-mail)</label>
            <input type="text" id="loginMailJwt" placeholder="https://zeabur-mail.../?jwt=...">
          </div>
          <div class="form-group">
            <label>YesCaptcha API Key</label>
            <input type="text" id="loginCaptchaKey" value="${config.yesCaptcha.apiKey}">
          </div>
          <div class="form-group">
            <label>推送账号ID</label>
            <input type="number" id="loginAccountId" value="0">
          </div>
          <button onclick="doLogin()" id="loginBtn">🚀 开始登录</button>
          <div id="loginResult" class="result" style="display:none;"></div>
        </div>

        <div class="card">
          <h2>📜 实时日志</h2>
          <button class="secondary" onclick="loadLogs()">刷新</button>
          <button class="danger" onclick="clearLogs()">清空</button>
          <div id="logContainer" class="log-container" style="margin-top: 12px;">加载中...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let accountsData = [];
    
    // 安全的 fetch 包装，处理可能返回 HTML 的情况
    async function safeFetch(url, options = {}) {
      const resp = await fetch(url, options);
      const text = await resp.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('API 返回非 JSON:', text.substring(0, 100));
        throw new Error('服务暂时不可用，请稍后重试');
      }
    }
    
    async function loadAccounts() {
      try {
        const data = await safeFetch('/api/accounts');
        accountsData = data.accounts || [];
        
        const list = document.getElementById('accountList');
        if (data.accounts.length === 0) {
          list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">暂无过期账号</p>';
        } else {
          list.innerHTML = data.accounts.map((acc, i) => \`
            <div class="account-item">
              <div class="account-info">
                <div class="account-email">\${acc.email}</div>
                <div class="account-meta">ID: \${acc.accountId ?? i} | JWT: \${acc.mailJwtUrl ? '✓' : '✗'}</div>
              </div>
              <div class="account-actions">
                <button class="success" onclick="refreshAccount(\${i})">刷新</button>
                <button class="danger" onclick="deleteAccount(\${i})">移除</button>
              </div>
            </div>
          \`).join('');
        }
        
        const select = document.getElementById('loginAccountSelect');
        select.innerHTML = '<option value="">-- 手动输入 --</option>' + 
          data.accounts.map((acc, i) => \`<option value="\${i}">\${acc.email} (ID: \${acc.accountId ?? i})</option>\`).join('');
          
      } catch (e) {
        document.getElementById('accountList').innerHTML = '<p style="color:red;">加载失败</p>';
      }
    }

    // 从后台同步过期账号到本地列表
    async function syncExpiredAccounts() {
      try {
        const data = await safeFetch('/api/sync-expired-accounts', { method: 'POST' });
        if (data.success) {
          let msg = \`同步完成: 新增 \${data.added} 个过期账号\`;
          if (data.noUrl > 0) {
            msg += \`\\n⚠️ \${data.noUrl} 个账号缺少邮箱URL，无法自动刷新\`;
          }
          if (data.alreadyExists > 0) {
            msg += \`\\n已存在 \${data.alreadyExists} 个\`;
          }
          alert(msg);
          loadAccounts();
          loadLogs();
        } else {
          alert('同步失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        alert('同步失败: ' + e.message);
      }
    }
    
    function onAccountSelect() {
      const select = document.getElementById('loginAccountSelect');
      const index = select.value;
      
      if (index === '' || !accountsData[index]) {
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginMailJwt').value = '';
        document.getElementById('loginAccountId').value = '0';
        return;
      }
      
      const acc = accountsData[index];
      document.getElementById('loginEmail').value = acc.email || '';
      document.getElementById('loginMailJwt').value = acc.mailJwtUrl || '';
      document.getElementById('loginAccountId').value = acc.accountId ?? index;
    }

    async function startRegister() {
      const count = parseInt(document.getElementById('registerCount').value) || 1;
      if (count < 1 || count > 10) return alert('注册数量必须在 1-10 之间');
      if (!confirm(\`确定要自动注册 \${count} 个账号吗？\`)) return;
      
      const btn = document.getElementById('registerBtn');
      btn.disabled = true;
      btn.textContent = '⏳ 注册中...';
      
      try {
        const data = await safeFetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count })
        });
        if (!data.success) {
          alert(data.error || data.message);
          btn.disabled = false;
          btn.textContent = '🚀 开始自动注册';
        }
      } catch (e) {
        alert('启动失败: ' + e.message);
        btn.disabled = false;
        btn.textContent = '🚀 开始自动注册';
      }
    }

    async function loadRegisterStatus() {
      try {
        const data = await safeFetch('/api/register-status');
        const container = document.getElementById('registerStatus');
        const btn = document.getElementById('registerBtn');
        
        if (data.running) {
          btn.disabled = true;
          btn.textContent = \`⏳ 注册中 (\${data.completed}/\${data.total})\`;
          let html = \`<p>进度: \${data.completed}/\${data.total}</p>\`;
          if (data.results.length > 0) {
            html += '<div class="refresh-result">';
            data.results.forEach(r => {
              html += \`<div class="refresh-item \${r.success ? 'success' : 'error'}">\${r.success ? '✅' : '❌'} #\${r.index} \${r.email || ''} - \${r.message}</div>\`;
            });
            html += '</div>';
          }
          container.innerHTML = html;
        } else {
          btn.disabled = false;
          btn.textContent = '🚀 开始自动注册';
          if (data.results && data.results.length > 0) {
            let html = '<div class="refresh-result">';
            data.results.forEach(r => {
              html += \`<div class="refresh-item \${r.success ? 'success' : 'error'}">\${r.success ? '✅' : '❌'} #\${r.index} \${r.email || ''} - \${r.message}</div>\`;
            });
            html += '</div>';
            container.innerHTML = html;
          } else {
            container.innerHTML = '';
          }
        }
      } catch (e) {}
    }

    async function syncBGAccounts() {
      const container = document.getElementById('bgAccountList');
      container.innerHTML = '同步中...';
      try {
        const data = await safeFetch('/api/business-gemini/accounts');
        if (data.success) {
          let html = \`<p><strong>总账号:</strong> \${data.accounts.length} | <strong>可用:</strong> <span style="color:green">\${data.available}</span> | <strong>不可用:</strong> <span style="color:red">\${data.unavailable}</span></p>\`;
          if (data.accounts.length > 0) {
            html += '<div style="max-height: 200px; overflow-y: auto; margin-top: 8px;">';
            data.accounts.forEach((acc, i) => {
              const status = acc.available !== false ? '✅' : '❌';
              const email = acc.tempmail_name || '-';
              html += \`<div style="padding: 4px 0; border-bottom: 1px solid #eee; font-size: 12px;">\${status} #\${i} \${email}</div>\`;
            });
            html += '</div>';
          }
          container.innerHTML = html;
        } else {
          container.innerHTML = \`<p style="color:red;">同步失败: \${data.error}</p>\`;
        }
      } catch (e) {
        container.innerHTML = \`<p style="color:red;">同步失败: \${e.message}</p>\`;
      }
    }

    async function importFromBackend() {
      if (!confirm('从后台导入账号到本地？')) return;
      try {
        const data = await safeFetch('/api/import-from-backend', { method: 'POST' });
        if (data.success) {
          alert('导入成功: ' + data.imported + ' 个账号');
          loadAccounts();
          loadLogs();
        } else {
          alert('导入失败: ' + data.error);
        }
      } catch (e) {
        alert('导入失败');
      }
    }

    async function deleteAccount(index) {
      if (!confirm('确定删除此账号？')) return;
      try {
        await fetch('/api/accounts/' + index, { method: 'DELETE' });
        loadAccounts();
        loadLogs();
      } catch (e) {
        alert('删除失败');
      }
    }

    async function refreshAccount(index) {
      if (!confirm('确定刷新此账号？')) return;
      try {
        const data = await safeFetch('/api/refresh/' + index, { method: 'POST' });
        alert(data.success ? '刷新成功！' : '刷新失败: ' + data.error);
        loadLogs();
      } catch (e) {
        alert('刷新失败: ' + e.message);
      }
    }

    async function loadRefreshStatus() {
      try {
        const data = await safeFetch('/api/refresh-status');
        let html = '<p><strong>状态:</strong> ' + (data.running ? '🔄 运行中' : '⏸️ 空闲') + '</p>';
        html += '<p><strong>账号数:</strong> ' + data.accountCount + '</p>';
        html += '<p><strong>上次刷新:</strong> ' + (data.lastRefreshTime ? new Date(data.lastRefreshTime).toLocaleString() : '从未') + '</p>';
        if (data.lastResult && data.lastResult.length > 0) {
          html += '<div class="refresh-result">';
          data.lastResult.forEach(r => {
            html += '<div class="refresh-item ' + (r.success ? 'success' : 'error') + '">' + 
              (r.success ? '✅' : '❌') + ' ' + r.email + ' - ' + r.message + '</div>';
          });
          html += '</div>';
        }
        document.getElementById('refreshStatus').innerHTML = html;
      } catch (e) {
        document.getElementById('refreshStatus').innerHTML = '<p>加载失败</p>';
      }
    }

    async function triggerRefresh() {
      if (!confirm('确定刷新全部过期账号？')) return;
      try {
        const data = await safeFetch('/api/trigger-refresh-expired', { method: 'POST' });
        alert(data.message);
        loadRefreshStatus();
        loadLogs();
        loadAccounts();
      } catch (e) {
        alert('触发失败');
      }
    }

    async function loadLogs() {
      try {
        const data = await safeFetch('/api/logs?limit=100');
        const container = document.getElementById('logContainer');
        
        // 显示日志统计信息
        const statsHtml = \`
          <div style="margin-bottom: 12px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 12px; color: #666;">
            📊 当前日志: \${data.total || data.logs.length} 条 | 
            ⏰ 保留策略: \${data.retention_hours || 24} 小时 | 
            🔄 自动清理: 每小时执行
          </div>
        \`;
        
        if (data.logs.length === 0) {
          container.innerHTML = statsHtml + '<p style="color:#888;text-align:center;">暂无日志</p>';
          return;
        }
        
        const logsHtml = data.logs.map(log => \`
          <div class="log-item">
            <span class="log-time">\${new Date(log.time).toLocaleTimeString()}</span>
            <span class="log-level \${log.level}">\${log.level}</span>
            \${log.email ? '<span class="log-email">[' + log.email + ']</span>' : ''}
            <span class="log-message">\${log.message}</span>
          </div>
        \`).join('');
        
        container.innerHTML = statsHtml + logsHtml;
      } catch (e) {
        document.getElementById('logContainer').innerHTML = '<p style="color:red;">加载失败</p>';
      }
    }

    async function clearLogs() {
      if (!confirm('确定清空日志？')) return;
      await fetch('/api/logs', { method: 'DELETE' });
      loadLogs();
    }

    async function doLogin() {
      const btn = document.getElementById('loginBtn');
      const result = document.getElementById('loginResult');
      btn.disabled = true;
      btn.textContent = '⏳ 处理中...';
      result.style.display = 'block';
      result.className = 'result';
      result.textContent = '启动中...';

      try {
        const data = await safeFetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('loginEmail').value,
            captchaKey: document.getElementById('loginCaptchaKey').value,
            mailJwtUrl: document.getElementById('loginMailJwt').value,
            accountId: parseInt(document.getElementById('loginAccountId').value) || 0,
            autoPush: true
          })
        });
        result.className = 'result ' + (data.success ? 'success' : 'error');
        result.textContent = JSON.stringify(data, null, 2);
        loadLogs();
      } catch (e) {
        result.className = 'result error';
        result.textContent = 'Error: ' + e.message;
      }
      btn.disabled = false;
      btn.textContent = '🚀 开始登录';
    }

    // 设置相关函数
    async function loadSettings() {
      try {
        const data = await safeFetch('/api/runtime-config');
        if (data.success && data.config) {
          // 服务配置
          document.getElementById('cfgTempMailUrl').value = data.config.tempMailUrl || '';
          document.getElementById('cfgBusinessGeminiUrl').value = data.config.businessGeminiUrl || '';
          document.getElementById('cfgBusinessGeminiPassword').value = data.config.businessGeminiPassword || '';
          document.getElementById('cfgYesCaptchaApiKey').value = data.config.yesCaptchaApiKey || '';
          // 间隔配置
          document.getElementById('cfgRegisterInterval').value = data.config.registerIntervalSeconds || 60;
          document.getElementById('cfgRefreshInterval').value = data.config.refreshIntervalSeconds || 30;
          document.getElementById('cfgScheduleRegisterHours').value = data.config.scheduleRegisterHours || 0;
          document.getElementById('cfgScheduleRegisterCount').value = data.config.scheduleRegisterCount || 1;
          document.getElementById('cfgScheduleRefreshHours').value = data.config.scheduleRefreshHours || 0;
          document.getElementById('settingsStatus').innerHTML = '<span style="color: green;">✓ 设置已加载</span>';
        }
      } catch (e) {
        document.getElementById('settingsStatus').innerHTML = '<span style="color: red;">加载失败: ' + e.message + '</span>';
      }
    }

    async function saveSettings() {
      const statusEl = document.getElementById('settingsStatus');
      statusEl.innerHTML = '<span style="color: #666;">保存中...</span>';
      
      try {
        const data = await safeFetch('/api/runtime-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 服务配置
            tempMailUrl: document.getElementById('cfgTempMailUrl').value,
            businessGeminiUrl: document.getElementById('cfgBusinessGeminiUrl').value,
            businessGeminiPassword: document.getElementById('cfgBusinessGeminiPassword').value,
            yesCaptchaApiKey: document.getElementById('cfgYesCaptchaApiKey').value,
            // 间隔配置
            registerIntervalSeconds: parseInt(document.getElementById('cfgRegisterInterval').value) || 60,
            refreshIntervalSeconds: parseInt(document.getElementById('cfgRefreshInterval').value) || 30,
            scheduleRegisterHours: parseFloat(document.getElementById('cfgScheduleRegisterHours').value) || 0,
            scheduleRegisterCount: parseInt(document.getElementById('cfgScheduleRegisterCount').value) || 1,
            scheduleRefreshHours: parseFloat(document.getElementById('cfgScheduleRefreshHours').value) || 0
          })
        });
        
        if (data.success) {
          statusEl.innerHTML = '<span style="color: green;">✓ 设置已保存</span>';
          loadLogs();
        } else {
          statusEl.innerHTML = '<span style="color: red;">保存失败</span>';
        }
      } catch (e) {
        statusEl.innerHTML = '<span style="color: red;">保存失败: ' + e.message + '</span>';
      }
    }

    // 初始化
    loadAccounts();
    loadRefreshStatus();
    loadRegisterStatus();
    syncBGAccounts();
    loadLogs();
    loadSettings();
    
    // 定时刷新
    setInterval(loadRefreshStatus, 5000);
    setInterval(loadRegisterStatus, 3000);
    setInterval(loadLogs, 10000);
    setInterval(loadAccounts, 15000);
    setInterval(syncBGAccounts, 60000);
  </script>
</body>
</html>
  `);
});

// ===============================
// 定时任务
// ===============================
function startScheduledTasks() {
  // 定时注册
  if (config.schedule.registerIntervalHours > 0) {
    const intervalMs = config.schedule.registerIntervalHours * 60 * 60 * 1000;
    
    // 格式化时间显示
    let timeDisplay;
    if (config.schedule.registerIntervalHours >= 1) {
      timeDisplay = `${config.schedule.registerIntervalHours} 小时`;
    } else {
      const minutes = Math.round(config.schedule.registerIntervalHours * 60);
      timeDisplay = `${minutes} 分钟`;
    }
    
    addLog('INFO', `定时注册已启用: 每 ${timeDisplay} 注册 ${config.schedule.registerCount} 个账号`);
    
    scheduleTimers.register = setInterval(async () => {
      if (registerStatus.running) {
        addLog('WARN', '定时注册: 上一次任务仍在运行，跳过');
        return;
      }
      addLog('INFO', `定时注册: 开始注册 ${config.schedule.registerCount} 个账号`);
      lastScheduledRegisterTime = new Date();
      await runAutoRegister(config.schedule.registerCount);
    }, intervalMs);
  }

  // 定时刷新 - 改为刷新后台过期账号
  if (config.schedule.refreshIntervalHours > 0) {
    const intervalMs = config.schedule.refreshIntervalHours * 60 * 60 * 1000;
    
    // 格式化时间显示
    let timeDisplay;
    if (config.schedule.refreshIntervalHours >= 1) {
      timeDisplay = `${config.schedule.refreshIntervalHours} 小时`;
    } else {
      const minutes = Math.round(config.schedule.refreshIntervalHours * 60);
      timeDisplay = `${minutes} 分钟`;
    }
    
    addLog('INFO', `定时刷新已启用: 每 ${timeDisplay} 刷新后台过期账号`);
    
    scheduleTimers.refresh = setInterval(async () => {
      if (refreshStatus.running) {
        addLog('WARN', '定时刷新: 上一次任务仍在运行，跳过');
        return;
      }
      addLog('INFO', '定时刷新: 开始刷新后台过期账号');
      lastScheduledRefreshTime = new Date();
      // 改为刷新后台过期账号，而不是本地账号
      await runAutoRefreshExpiredAccounts();
    }, intervalMs);
  }
}

// ===============================
// 启动服务
// ===============================
loadAccounts();
loadRuntimeConfig();

app.listen(config.port, '0.0.0.0', () => {
  addLog('INFO', '服务启动');
  addLog('INFO', '端口: ' + config.port);
  addLog('INFO', 'Business Gemini: ' + (config.businessGemini.url || '未配置'));
  addLog('INFO', '临时邮箱服务: ' + (config.mail.tempMailUrl || '未配置'));
  addLog('INFO', '已加载账号: ' + runtimeAccounts.length + ' 个');
  
  // 格式化定时注册时间显示
  let registerTimeDisplay = '禁用';
  if (config.schedule.registerIntervalHours > 0) {
    if (config.schedule.registerIntervalHours >= 1) {
      registerTimeDisplay = `${config.schedule.registerIntervalHours}小时`;
    } else {
      const minutes = Math.round(config.schedule.registerIntervalHours * 60);
      registerTimeDisplay = `${minutes}分钟`;
    }
  }
  
  // 格式化定时刷新时间显示
  let refreshTimeDisplay = '禁用';
  if (config.schedule.refreshIntervalHours > 0) {
    if (config.schedule.refreshIntervalHours >= 1) {
      refreshTimeDisplay = `${config.schedule.refreshIntervalHours}小时`;
    } else {
      const minutes = Math.round(config.schedule.refreshIntervalHours * 60);
      refreshTimeDisplay = `${minutes}分钟`;
    }
  }
  
  addLog('INFO', `定时注册: ${registerTimeDisplay}`);
  addLog('INFO', `定时刷新: ${refreshTimeDisplay}`);
  
  // 启动定时任务
  startScheduledTasks();
  
  // 启动定期日志清理任务（每小时清理一次）
  setInterval(() => {
    cleanupOldLogs();
  }, 60 * 60 * 1000); // 每小时执行一次
  
  addLog('INFO', `日志保留策略: ${LOG_RETENTION_HOURS}小时，每小时自动清理`);
  addLog('INFO', `操作间隔: 注册${config.interval.register}秒, 刷新${config.interval.refresh}秒`);
});
