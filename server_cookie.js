const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// 创建Cookie存储目录
const COOKIE_STORAGE_PATH = path.join(__dirname, 'cookies.json');

// 保存Cookie到本地文件
const saveCookiesToFile = (cookies) => {
  try {
    fs.writeFileSync(COOKIE_STORAGE_PATH, JSON.stringify(cookies, null, 2));
    console.log('Cookie已保存到本地文件:', COOKIE_STORAGE_PATH);
  } catch (error) {
    console.error('保存Cookie文件失败:', error.message);
  }
};

// 创建Express应用
const app = express();
const PORT = 3000;

// 配置中间件
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 忽略HTTPS证书验证（仅开发环境使用）
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// 在文件顶部或登录函数之前添加
const loginUrl = 'https://111.63.37.92:996/admin/login';
const puppeteer = require('puppeteer');

// 存储从原平台获取的cookies
let originalPlatformCookies = {};

// 路由：提供登录页面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 路由：处理登录请求
app.post('/api/login', async (req, res) => {
  let browser;

  const cookieJar = {};

  // 1. 启动真实浏览器
  console.log('正在启动浏览器...');
  browser = await puppeteer.launch({
    headless: false, // 非无头模式，可见浏览器窗口
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--ignore-certificate-errors', // 忽略证书错误
      '--ignore-certificate-errors-spki-list' // 忽略特定证书错误
    ],
    ignoreHTTPSErrors: true, // 忽略HTTPS错误
  });

  // 2. 创建新页面并导航到登录页
  const page = await browser.newPage();
  console.log('正在访问原平台登录页...');
  
  // 增加导航超时时间并优化等待策略
  await page.goto(loginUrl, {
    waitUntil: ['networkidle0', 'domcontentloaded'],
    timeout: 60000 // 增加到60秒超时
  });
  
  // 3. 等待登录表单加载并填写凭据
  console.log('正在填写登录表单...');
  // 使用更具体的选择器定位账号密码框
  await page.waitForSelector('input[type="text"][placeholder="请输入账号"]', { timeout: 15000 });
  await page.type('input[type="text"][placeholder="请输入账号"]', req.body.username, { delay: 100 });
  
  // 处理密码框可能存在的readonly属性
  await page.$eval('input[type="password"][placeholder="请输入密码"]', el => {
    if (el.hasAttribute('readonly')) {
      el.removeAttribute('readonly');
    }
  });
  await page.type('input[type="password"][placeholder="请输入密码"]', req.body.password, { delay: 100 });
  
  // 4. 提交登录表单
  console.log('正在提交登录请求...');
  const loginButtonSelector = '.el-button--primary.el-button--large';
  await page.waitForSelector(loginButtonSelector, { timeout: 15000 });
  await Promise.all([
    page.click(loginButtonSelector),
    page.waitForNavigation({ waitUntil: ['networkidle0', 'domcontentloaded'], timeout: 60000 })
  ]);
  
  // 5. 等待登录后重定向完成并获取所有cookie
  console.log('登录成功，正在获取cookie...');
  let cookies = await page.cookies();
  
  // 6. 显式等待token cookie出现，最长等待30秒
  let tokenCookie = cookies.find(cookie => cookie.name === 'token');
  const maxWaitTime = 5000;
  const checkInterval = 1000;
  let elapsedTime = 0;
  
  
  // 7. 提取所需的cookie
  const webymsAdminCookie = cookies.find(cookie => cookie.name === 'WEBYMSADMIN');
  const languageCookie = cookies.find(cookie => cookie.name === 'language');

  if (!webymsAdminCookie) {
    throw new Error('未在登录页面获取到WEBYMSADMIN cookie');
  }

  // 保存cookie到文件
  const cookieData = {
    WEBYMSADMIN: webymsAdminCookie.value,
    language: languageCookie ? languageCookie.value : 'zh',
    token: tokenCookie ? tokenCookie.value : null
  };
  fs.writeFileSync('cookies.json', JSON.stringify(cookieData, null, 2));
  console.log('成功获取并保存cookie:', cookieData);
  
  // 设置cookie并跳转
  res.cookie('WEBYMSADMIN', webymsAdminCookie.value);
  if (languageCookie) {
    res.cookie('language', languageCookie.value);
  }
  if (tokenCookie) {
    res.cookie('token', tokenCookie.value);
  }
  res.redirect('/dashboard');

});

// 路由：仪表盘页面 - 合并Cookie显示和企业列表功能
app.get('/dashboard', async (req, res) => {
  // 仅检查WEBYMSADMIN cookie
  if (!req.cookies.WEBYMSADMIN) {
    return res.redirect('/login');
  }

  // 在控制台显示cookie内容
  console.log('当前Cookie内容:', req.cookies);

  try {
    // 调用企业列表API
    console.log('正在获取企业列表...');
    const response = await axios.post(
      'https://111.63.37.92:996/admin/user-manager/api/v1/admin/enterprise/pagedList',
      {
        skip: 0,
        limit: 10,
        autoCount: true,
        serviceOwnership: 1
      },
      {
        headers: {
          'Cookie': `WEBYMSADMIN=${req.cookies.WEBYMSADMIN}; language=${req.cookies.language || 'zh'}`
        },
        httpsAgent: httpsAgent // 使用之前创建的HTTPS代理
      }
    );

    // 格式化企业数据
    const enterprises = response.data.data.data.map(enterprise => ({
      ...enterprise,
      createTime: new Date(enterprise.createTime).toLocaleString(),
      // 状态码转换为可读文本
      status: enterprise.status === 20 ? '正常' : '未知状态'
    }));

    // 生成HTML表格
    const tableHtml = `
      <h1>管理员仪表盘</h1>
      <h2>Cookie信息</h2>
      <pre>${JSON.stringify(req.cookies, null, 2)}</pre>
      
      <h2>企业列表</h2>
      <table border="1" style="border-collapse: collapse; width: 100%; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th style="padding: 12px; text-align: left;">企业号</th>
            <th style="padding: 12px; text-align: left;">企业名称</th>
            <th style="padding: 12px; text-align: left;">国家及地区</th>
            <th style="padding: 12px; text-align: left;">企业管理员</th>
            <th style="padding: 12px; text-align: left;">企业状态</th>
            <th style="padding: 12px; text-align: left;">创建时间</th>
            <th style="padding: 12px; text-align: left;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${enterprises.map(ent => `
            <tr>
              <td style="padding: 12px;">${ent.number}</td>
              <td style="padding: 12px;">${ent.name}</td>
              <td style="padding: 12px;">${ent.area}</td>
              <td style="padding: 12px;">${ent.managerName}</td>
              <td style="padding: 12px;">${ent.status}</td>
              <td style="padding: 12px;">${ent.createTime}</td>
              <td style="padding: 12px;">
                <a href="/proxy-enterprise-list" target="_blank" 
                   style="color: #409EFF; text-decoration: none; padding: 4px 8px; border: 1px solid #409EFF; border-radius: 4px; font-size: 12px;">
                  访问原平台
                </a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
    `;

    res.send(tableHtml);

  } catch (error) {
    console.error('获取企业列表失败:', error);
    res.status(500).send(`
      <h1>管理员仪表盘</h1>
      <h2>Cookie信息</h2>
      <pre>${JSON.stringify(req.cookies, null, 2)}</pre>
      <h2>错误信息</h2>
      <p>获取企业列表失败: ${error.message}</p>
    `);
  }
});

// 路由：代理访问原平台企业列表
app.get('/proxy-enterprise-list', async (req, res) => {
  try {
    // 读取本地保存的cookie
    let cookieData = {};
    if (fs.existsSync(COOKIE_STORAGE_PATH)) {
      cookieData = JSON.parse(fs.readFileSync(COOKIE_STORAGE_PATH, 'utf8'));
    } else {
      // 如果没有本地cookie文件，尝试使用请求中的cookie
      cookieData = {
        WEBYMSADMIN: req.cookies.WEBYMSADMIN,
        language: req.cookies.language || 'zh'
      };
    }

    if (!cookieData.WEBYMSADMIN) {
      return res.status(401).send('未找到有效的认证信息，请先登录');
    }

    // 构建cookie字符串
    const cookieString = `WEBYMSADMIN=${cookieData.WEBYMSADMIN}; language=${cookieData.language || 'zh'}`;
    
    console.log('正在使用cookie代理访问原平台企业列表:', cookieString);
    
    // 代理访问原平台企业列表页面
    const response = await axios.get('https://111.63.37.92:996/admin/enterprise/list', {
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      httpsAgent: httpsAgent
    });

    // 修改HTML内容，将所有资源路径代理到本地服务器
     let htmlContent = response.data;
     
     // 首先清理可能存在的双重代理路径
     htmlContent = htmlContent.replace(/\/proxy-static\/proxy-static\//g, '/proxy-static/');
     
     // 统一的路径替换逻辑，避免重复替换
     // 使用单一的全局替换，处理所有以 / 开头且不包含 proxy-static 的路径
     htmlContent = htmlContent.replace(/(["\'`=])\/(?!proxy-static)([^"\'`\s>]*)/g, '$1/proxy-static/$2');
     
     // 处理可能遗漏的相对路径（以字母开头的文件路径）
     htmlContent = htmlContent.replace(/(["\'`])([a-zA-Z][^"\'`\s\/]*\.(js|css|json|png|jpg|gif|svg|ico|woff|woff2|ttf|eot|html))(?![^"\'`]*proxy-static)/g, '$1/proxy-static/$2');
     
     // 最后再次清理可能产生的双重代理路径
     htmlContent = htmlContent.replace(/\/proxy-static\/proxy-static\//g, '/proxy-static/');
     

     
     // 返回修改后的页面内容
     res.send(htmlContent);
    
  } catch (error) {
    console.error('代理访问原平台失败:', error.message);
    res.status(500).send(`
      <h1>访问失败</h1>
      <p>无法访问原平台企业列表页面</p>
      <p>错误信息: ${error.message}</p>
      <p><a href="/dashboard">返回仪表盘</a></p>
    `);
  }
});

// 路由：代理静态资源（同时处理 /proxy-static 和 /admin 前缀）
app.use([ '/proxy-static', '/admin' ], async (req, res) => {
  try {
    // 读取本地保存的cookie
    let cookieData = {};
    if (fs.existsSync(COOKIE_STORAGE_PATH)) {
      cookieData = JSON.parse(fs.readFileSync(COOKIE_STORAGE_PATH, 'utf8'));
    }

    const cookieString = cookieData.WEBYMSADMIN ? 
      `WEBYMSADMIN=${cookieData.WEBYMSADMIN}; language=${cookieData.language || 'zh'}` : '';

    // 计算要代理到源站的原始路径
    // - 当挂载在 /proxy-static 时：req.path 已经是以 /admin/... 开头
    // - 当挂载在 /admin 时：需要把基路径和 path 连接回 /admin/...
    const originalPath = req.baseUrl === '/proxy-static' ? req.path : `${req.baseUrl}${req.path}`;
    const targetUrl = `https://111.63.37.92:996${originalPath}`;

    console.log('代理静态资源:', targetUrl);

    const response = await axios.get(targetUrl, {
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      httpsAgent: httpsAgent,
      responseType: 'arraybuffer'
    });

    // 设置正确的Content-Type
    if (response.headers['content-type']) {
      res.set('Content-Type', response.headers['content-type']);
    }

    res.send(response.data);

  } catch (error) {
    console.error('代理静态资源失败:', error.message);
    res.status(404).send('Resource not found');
  }
});



// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`请访问 http://localhost:${PORT}/login 进行登录`);
});