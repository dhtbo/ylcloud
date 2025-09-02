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
    headless: 'new', // 非无头模式，可见浏览器窗口
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

  // 更可靠的元素定位方式
  try {
    // 等待页面加载完成后获取cookie
    console.log('获取cookie...');
    const cookies = await page.cookies();
    const webymsAdminCookie = cookies.find(cookie => cookie.name === 'WEBYMSADMIN');
    const languageCookie = cookies.find(cookie => cookie.name === 'language');

    if (!webymsAdminCookie) {
      throw new Error('未在登录页面获取到WEBYMSADMIN cookie');
    }

    // 保存cookie到文件
    const cookieData = {
      WEBYMSADMIN: webymsAdminCookie.value,
      language: languageCookie ? languageCookie.value : 'zh'
    };
    fs.writeFileSync('cookies.json', JSON.stringify(cookieData, null, 2));
    console.log('成功获取并保存cookie:', cookieData);

    // 设置cookie并跳转
    res.cookie('WEBYMSADMIN', webymsAdminCookie.value);
    if (languageCookie) {
      res.cookie('language', languageCookie.value);
    }
    res.redirect('/dashboard');

  } catch (error) {
    console.error('浏览器操作出错:', error);
    res.status(500).send('获取cookie失败: ' + error.message);
  } finally {
    await browser.close();
  }

});

// 路由：仪表盘页面
app.get('/dashboard', (req, res) => {
  // 仅检查WEBYMSADMIN cookie
  if (!req.cookies.WEBYMSADMIN) {
    return res.redirect('/login');
  }

  // 在控制台显示cookie内容
  console.log('当前Cookie内容:', req.cookies);
  res.send(`
      <h1>管理员仪表盘</h1>
      <p>已成功获取WEBYMSADMIN cookie</p>
      <pre>${JSON.stringify(req.cookies, null, 2)}</pre>
  `);
});



// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`请访问 http://localhost:${PORT}/login 进行登录`);
});